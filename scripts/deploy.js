const path = require('path');
const { logDeployStep } = require('./lib/logger');
const {
  printHeader,
  printDeploymentPreview,
  askConfirmation,
  printDeploymentCancelled,
  printDeploymentSuccess
} = require('./lib/ui');
const {
  getLocalGCPDefaults,
  loadConfig,
  saveConfig,
  isConfigComplete,
  decideUseSavedConfig,
  getSavedConnectionConfig,
  getSavedGCPConfig,
  getSavedServiceAccountConfig,
  promptLookerConnection,
  promptGCPConfig,
  promptLookerServiceAccount
} = require('./lib/config');
const {
  validateLocalTooling,
  checkGCPAuth,
  ensureLookerLoggedIn
} = require('./lib/prereqs');
const {
  resolveGcfUrl,
  checkSecretsExistInGCP,
  scanExistingResources,
  deployGCF,
  deployExtensionToGCS
} = require('./lib/gcp');
const {
  getLookerCredentials,
  updateLocalConfigs,
  configureLookerAttribute,
  getLookerSaById
} = require('./lib/looker');
const {
  runPostDeploymentVerification
} = require('./lib/verification');

const CONFIG_PATH = path.join(__dirname, '..', 'deploy-config.json');

async function runDeployment() {
  const isValidateOnly = process.argv.includes('--validate-only') || process.argv.includes('--validate');
  if (isValidateOnly) {
    await runValidationModePipeline();
    return;
  }

  await runFullDeploymentPipeline();
}

async function runValidationModePipeline() {
  logDeployStep('Validation Mode', 'Starting validate-only check');
  validateLocalTooling();
  await checkGCPAuth();

  const config = loadConfig(CONFIG_PATH);
  ensureConfigCompleteness(config);

  for (const inst of config.instances || []) {
    await ensureLookerLoggedIn(inst);
  }

  const gcfUrl = resolveGcfUrl(config);
  const results = await runPostDeploymentVerification(config, gcfUrl);

  evaluateValidationResults(results);
}

async function runFullDeploymentPipeline() {
  printHeader();
  logDeployStep('Initialization', 'Starting deployment run');

  // Step 1: Validate local tooling (fast, no network, fail fast)
  validateLocalTooling();

  // Step 2: Collect local settings for defaults or full re-use
  const localDefaults = getLocalGCPDefaults();
  const config = loadConfig(CONFIG_PATH);

  // Step 3: If complete, offer to re-use saved config
  const skipPrompts = await decideUseSavedConfig(config);

  // Step 4: Prompt & validate target environments & deployment accounts
  await checkGCPAuth();
  const gcpConfig = skipPrompts ? getSavedGCPConfig(config) : await promptGCPConfig(config, localDefaults);

  const targetConnections = skipPrompts ? getSavedConnectionConfig(config) : await resolveInstanceConnections(config);
  const lookerUsers = [];
  for (const conn of targetConnections) {
    const user = await ensureLookerLoggedIn(conn);
    lookerUsers.push({ host: conn.looker_host, user });
  }

  // Step 5: Service Configuration & Service Accounts (In-Memory Only, Non-Mutating)
  const saConfigs = [];
  for (const conn of targetConnections) {
    const existingInst = (config.instances || []).find(i => i.looker_host === conn.looker_host) || {};
    const saCfg = skipPrompts
      ? {
          looker_host: conn.looker_host,
          looker_service_account: existingInst.looker_service_account || '',
          looker_credential_method: checkSecretsExistInGCP(gcpConfig.gcp_project_id) ? 'reuse' : 'generate',
          manual_client_id: '',
          manual_client_secret: ''
        }
      : await promptLookerServiceAccount(conn, gcpConfig, existingInst, checkSecretsExistInGCP);
    saConfigs.push(saCfg);
  }

  const mergedConfig = assembleMergedConfig(targetConnections, saConfigs, gcpConfig);

  // Step 6: Review & Confirm
  const resourceStatus = await scanExistingResources(mergedConfig, getLookerSaById);
  printDeploymentPreview(mergedConfig, lookerUsers, resourceStatus);

  const confirmed = await askConfirmation();
  if (!confirmed) {
    handleCancelledDeployment();
    return;
  }

  // Step 7: Execute (Mutations)
  logDeployStep('Operations Started');

  saveConfig(CONFIG_PATH, mergedConfig);
  logDeployStep('Configuration Saved', extractSanitizedConfigSummary(mergedConfig));

  const multiInstanceCreds = {};
  for (let i = 0; i < mergedConfig.instances.length; i++) {
    const inst = mergedConfig.instances[i];
    const saCfg = saConfigs[i];
    const creds = await getLookerCredentials(inst, saCfg);
    multiInstanceCreds[inst.looker_host] = {
      base_url: `https://${inst.looker_host}:${inst.looker_port}`,
      port: inst.looker_port,
      verify_ssl: inst.looker_ssl,
      client_id: creds?.clientId || '',
      client_secret: creds?.clientSecret || ''
    };
    // Mark credential method as 'reuse' for subsequent deployment runs
    mergedConfig.instances[i].looker_credential_method = 'reuse';
    if (creds?.serviceAccountId) {
      mergedConfig.instances[i].looker_service_account = String(creds.serviceAccountId);
    }
  }

  const { gcfUrl, secretManagerError } = await deployGCF(mergedConfig, { instances: multiInstanceCreds });
  logDeployStep('GCF Deployed', { gcfUrl, secretManagerError });

  // Update deploy-config.json on disk with credential method set to 'reuse' for future runs
  saveConfig(CONFIG_PATH, mergedConfig);
  logDeployStep('Configuration Saved', extractSanitizedConfigSummary(mergedConfig));

  const publicUrl = `https://storage.googleapis.com/${mergedConfig.gcs_bucket_name}/`;
  const manifestContent = updateLocalConfigs(gcfUrl, publicUrl);
  logDeployStep('Configs Updated & Bundle Built', { gcfUrl, publicUrl });

  await deployExtensionToGCS(mergedConfig);
  logDeployStep('Extension Uploaded to GCS', { gcs_bucket_name: mergedConfig.gcs_bucket_name });

  for (const inst of mergedConfig.instances) {
    await configureLookerAttribute(inst, gcfUrl);
  }
  logDeployStep('Looker User Attributes Configured', { count: mergedConfig.instances.length });

  const verificationResult = await runPostDeploymentVerification(mergedConfig, gcfUrl);
  logDeployStep('Post-Deployment Verification Completed', verificationResult);

  printDeploymentSuccess(mergedConfig, manifestContent, gcfUrl, verificationResult?.manifestPass);
  if (secretManagerError) {
    reportSecretManagerWarning(secretManagerError);
  }
  logDeployStep('Deployment Completed Successfully', { gcfUrl, publicUrl });
}

runDeployment().catch(handleDeploymentFailure);

// ============================================================================
// HOISTED PURE HELPERS
// ============================================================================

function ensureConfigCompleteness(config) {
  if (!isConfigComplete(config)) {
    console.error('\n❌ Saved configuration in deploy-config.json is incomplete. Run npm run deploy first.');
    process.exit(1);
  }
}

function evaluateValidationResults(results) {
  const allPassed = results.modelPass && results.functionPass && results.gcsPass && results.attrPass && results.manifestPass;
  if (allPassed) {
    console.log('🎉 All deployment verification checks PASSED!');
    logDeployStep('Validate Only Passed');
    process.exit(0);
  } else {
    console.error('💥 One or more post-deployment verification checks FAILED.');
    logDeployStep('Validate Only Failed', results);
    process.exit(1);
  }
}

async function resolveInstanceConnections(config) {
  const instances = [];
  let addMore = true;
  const existingInstances = config.instances || [];

  if (existingInstances.length > 0) {
    for (const inst of existingInstances) {
      instances.push(await promptLookerConnection(inst));
    }
  } else {
    instances.push(await promptLookerConnection({}));
  }

  return instances;
}

function assembleMergedConfig(targetConnections, saConfigs, gcpConfig) {
  const instances = targetConnections.map((conn, idx) => ({
    ...conn,
    ...(saConfigs[idx] || {})
  }));

  return {
    ...gcpConfig,
    instances,
    // Top level fields for backwards compatibility
    looker_host: instances[0]?.looker_host || '',
    looker_port: instances[0]?.looker_port || '443',
    looker_ssl: instances[0]?.looker_ssl !== undefined ? instances[0].looker_ssl : true,
    looker_service_account: instances[0]?.looker_service_account || '',
    looker_credential_method: instances[0]?.looker_credential_method || 'generate'
  };
}

function extractSanitizedConfigSummary(mergedConfig) {
  return {
    gcp_project_id: mergedConfig.gcp_project_id,
    gcp_region: mergedConfig.gcp_region,
    gcf_name: mergedConfig.gcf_name,
    gcs_bucket_name: mergedConfig.gcs_bucket_name,
    instanceCount: mergedConfig.instances.length
  };
}

function handleCancelledDeployment() {
  printDeploymentCancelled();
  logDeployStep('Cancelled', 'User cancelled deployment at confirmation prompt');
}

function handleDeploymentFailure(err) {
  console.error('\n💥 Deployment failed:', err);
  logDeployStep('Deployment Failed', { message: err.message, stack: err.stack });
  process.exit(1);
}

function reportSecretManagerWarning(errorMessage) {
  console.warn('\n⚠️  SECRET MANAGER NOTICE:');
  console.warn(`    Automatic Secret Manager provisioning encountered an issue: ${errorMessage}`);
  console.warn('    Note: Credentials were NOT uploaded to environment variables to preserve security.');
  console.warn('    Please ensure LOOKERSDK_CLIENT_ID, LOOKERSDK_CLIENT_SECRET, and GCF_HMAC_SECRET are manually created/configured in Secret Manager.');
}
