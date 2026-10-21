const path = require('path');
const { logDeployStep } = require('./lib/logger');
const {
  askQuestion,
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
  getSavedGitConfig,
  promptLookerConnection,
  promptGCPConfig,
  promptLookerServiceAccount,
  promptModelConfig,
  promptGitConfig
} = require('./lib/config');
const {
  validateLocalTooling,
  checkGCPAuth,
  ensureLookerLoggedIn
} = require('./lib/prereqs');
const {
  resolveCanonicalGcfUrl,
  resolveGcfUrl,
  checkSecretsExistInGCP,
  scanExistingResources,
  deployGCF,
  deployExtensionToGCS
} = require('./lib/gcp');
const {
  getLookerCredentials,
  updateLocalConfigs,
  configureLookerInstanceAuth,
  getLookerSaById,
  discoverLookerProjectState,
  ensureLookerProject,
  ensureLookerModel,
  configureLookerProjectGit,
  inspectLookerProjectFiles
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

  // Fast Local Validation
  validateLocalTooling();

  // Local Defaults & Saved Configuration Evaluation
  const localDefaults = getLocalGCPDefaults();
  const config = loadConfig(CONFIG_PATH);
  const skipPrompts = await decideUseSavedConfig(config);

  // Discovery and Prompting: Target Environments, Accounts & Resources
  await checkGCPAuth();
  const gcpConfig = skipPrompts ? getSavedGCPConfig(config) : await promptGCPConfig(config, localDefaults);

  const targetConnections = skipPrompts ? getSavedConnectionConfig(config) : await resolveInstanceConnections(config);
  const lookerUsers = [];
  for (const conn of targetConnections) {
    const user = await ensureLookerLoggedIn(conn);
    lookerUsers.push({ host: conn.looker_host, user });
  }

  const projectStates = [];
  for (const conn of targetConnections) {
    const state = await discoverLookerProjectState(conn, 'nano_admin', 'nano_admin');
    projectStates.push(state);
  }

  const saConfigs = [];
  for (const conn of targetConnections) {
    const existingInst = (config.instances || []).find(i => i.looker_host === conn.looker_host) || {};
    const saCfg = skipPrompts
      ? {
          looker_host: conn.looker_host,
          looker_service_account: existingInst.looker_service_account || '',
          looker_credential_method: existingInst.looker_credential_method === 'reuse' || checkSecretsExistInGCP(gcpConfig.gcp_project_id, [conn]) ? 'reuse' : 'generate',
          manual_client_id: '',
          manual_client_secret: ''
        }
      : await promptLookerServiceAccount(conn, gcpConfig, existingInst, checkSecretsExistInGCP);
    saConfigs.push(saCfg);
  }

  const modelConfigs = [];
  for (let i = 0; i < targetConnections.length; i++) {
    const conn = targetConnections[i];
    const projectState = projectStates[i];
    const existingInst = (config.instances || []).find(inst => inst.looker_host === conn.looker_host) || {};
    const defaultFromPrevious = i > 0
      ? (modelConfigs.find(m => m && (m.selected_connection || m.allowed_connections?.length > 0)) || modelConfigs[0])
      : null;
    const modelCfg = skipPrompts
      ? {
          action: projectState.modelExists ? 'reuse' : 'create',
          unlimited: existingInst.model_unlimited_db_connections !== false,
          allowed_connections: existingInst.model_allowed_db_connection_names || [],
          selected_connection: (existingInst.model_allowed_db_connection_names || [])[0] || projectState.model?.allowed_db_connection_names?.[0] || projectState.availableConnections?.[0] || ''
        }
      : await promptModelConfig(conn, projectState, defaultFromPrevious);
    modelConfigs.push(modelCfg);
  }

  const gitConfigs = [];
  for (let i = 0; i < targetConnections.length; i++) {
    const conn = targetConnections[i];
    const projectState = projectStates[i];
    const existingInst = (config.instances || []).find(inst => inst.looker_host === conn.looker_host) || {};
    const defaultFromPrevious = i > 0 ? gitConfigs[0] : null;
    const gitCfg = skipPrompts
      ? {
          action: projectState.gitType !== 'none' ? 'reuse' : 'create',
          git_type: existingInst.git_type || (projectState.gitType !== 'none' ? projectState.gitType : 'bare'),
          git_remote_url: existingInst.git_remote_url || projectState.gitRemoteUrl || '',
          deploy_key: projectState.deployKey || null
        }
      : await promptGitConfig(conn, projectState, existingInst, defaultFromPrevious);
    gitConfigs.push(gitCfg);
  }

  const mergedConfig = assembleMergedConfig(targetConnections, saConfigs, gcpConfig, gitConfigs, modelConfigs, projectStates);

  // Confirmation Preview
  const resourceStatus = await scanExistingResources(mergedConfig, getLookerSaById);
  printDeploymentPreview(mergedConfig, lookerUsers, resourceStatus);

  const confirmed = await askConfirmation();
  if (!confirmed) {
    handleCancelledDeployment();
    return;
  }

  // Execution / Mutations (Strictly Confirmed Values)
  const multiInstanceCreds = {};
  for (let i = 0; i < mergedConfig.instances.length; i++) {
    const inst = mergedConfig.instances[i];
    const saCfg = saConfigs[i];
    const creds = await getLookerCredentials(inst, saCfg);
    multiInstanceCreds[inst.looker_host] = {
      base_url: `https://${inst.looker_host}:${inst.looker_port}`,
      port: inst.looker_port,
      verify_ssl: true,
      client_id: creds?.clientId || '',
      client_secret: creds?.clientSecret || ''
    };
    if (creds?.serviceAccountId) {
      mergedConfig.instances[i].looker_service_account = String(creds.serviceAccountId);
    }
  }

  const { gcfUrl, secretManagerError } = await deployGCF(mergedConfig, { instances: multiInstanceCreds });
  logDeployStep('GCF Deployed', { gcfUrl, secretManagerError });

  const publicUrl = `https://storage.googleapis.com/${mergedConfig.gcs_bucket_name}/`;
  const canonicalGcfUrl = resolveCanonicalGcfUrl(mergedConfig);
  const manifestContent = updateLocalConfigs(gcfUrl, publicUrl, mergedConfig.instances, canonicalGcfUrl);
  logDeployStep('Configs Updated & Bundle Built', { gcfUrl, publicUrl });

  await deployExtensionToGCS(mergedConfig);
  logDeployStep('Extension Uploaded to GCS', { gcs_bucket_name: mergedConfig.gcs_bucket_name });

  for (const inst of mergedConfig.instances) {
    await configureLookerInstanceAuth(inst, gcfUrl);
  }
  logDeployStep('Looker Instance Authentication Configured', { count: mergedConfig.instances.length });

  const projectSetupResults = [];
  for (const inst of mergedConfig.instances) {
    const result = await setupLookerProjectAndGit(inst);
    projectSetupResults.push(result);
  }
  logDeployStep('Looker Projects & Git Configured', { count: projectSetupResults.length });

  // Mark credential method as 'reuse' and persist configuration to disk only after all mutations complete successfully
  for (let i = 0; i < mergedConfig.instances.length; i++) {
    mergedConfig.instances[i].looker_credential_method = 'reuse';
  }
  saveConfig(CONFIG_PATH, mergedConfig);
  logDeployStep('Configuration Saved Post-Deployment', extractSanitizedConfigSummary(mergedConfig));

  // Post-Deployment Verification
  const verificationResult = await runPostDeploymentVerification(mergedConfig, gcfUrl);
  logDeployStep('Post-Deployment Verification Completed', verificationResult);

  // Final Instructions
  printDeploymentSuccess(mergedConfig, manifestContent, gcfUrl, verificationResult?.manifestPass, projectSetupResults);
  if (secretManagerError) {
    reportSecretManagerWarning(secretManagerError);
  }
  logDeployStep('Deployment Completed Successfully', { gcfUrl, publicUrl });
}

if (require.main === module) {
  runDeployment().catch(handleDeploymentFailure);
}

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
  const allPassed = results.projectPass && results.modelPass && results.functionPass && results.gcsPass && results.attrPass && results.manifestPass;
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
  const existingInstances = Array.isArray(config.instances) && config.instances.length > 0 ? config.instances : [];

  if (existingInstances.length > 0) {
    for (const inst of existingInstances) {
      instances.push(await promptLookerConnection(inst));
    }
  } else {
    instances.push(await promptLookerConnection({}));
  }

  let addMore = true;
  while (addMore) {
    const answer = await askQuestion('\nWould you like to add another target Looker instance to this deployment? (y/N): ');
    if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
      const nextInst = await promptLookerConnection({});
      if (instances.some(i => i.looker_host === nextInst.looker_host)) {
        console.warn(`⚠️  Warning: Instance host '${nextInst.looker_host}' is already in the target instances list.`);
      } else {
        instances.push(nextInst);
      }
    } else {
      addMore = false;
    }
  }

  return instances;
}

function assembleMergedConfig(targetConnections, saConfigs, gcpConfig, gitConfigs = [], modelConfigs = [], projectStates = []) {
  const instances = targetConnections.map((conn, idx) => ({
    ...conn,
    auth_mode: conn.auth_mode === 'oauth' ? 'oauth' : 'server_proxy',
    ...(saConfigs[idx] || {}),
    ...(gitConfigs[idx] || {}),
    gitAction: gitConfigs[idx]?.action || 'create',
    modelAction: modelConfigs[idx]?.action || (projectStates[idx]?.modelExists ? 'reuse' : 'create'),
    modelSelection: modelConfigs[idx] || { unlimited: true, allowed_connections: [] },
    projectAction: projectStates[idx]?.projectExists ? 'reuse' : 'create',
    projectState: projectStates[idx] || null,
    model_unlimited_db_connections: modelConfigs[idx]?.unlimited !== false,
    model_allowed_db_connection_names: modelConfigs[idx]?.allowed_connections || []
  }));

  return {
    ...gcpConfig,
    instances,
    // Top level fields for backwards compatibility
    looker_host: instances[0]?.looker_host || '',
    looker_port: instances[0]?.looker_port || '443',
    looker_ssl: instances[0]?.looker_ssl !== undefined ? instances[0].looker_ssl : true,
    auth_mode: instances[0]?.auth_mode || 'server_proxy',
    looker_service_account: instances[0]?.looker_service_account || '',
    looker_credential_method: instances[0]?.looker_credential_method || 'generate',
    git_type: instances[0]?.git_type || 'bare',
    git_remote_url: instances[0]?.git_remote_url || '',
    model_unlimited_db_connections: instances[0]?.model_unlimited_db_connections !== false,
    model_allowed_db_connection_names: instances[0]?.model_allowed_db_connection_names || []
  };
}

async function setupLookerProjectAndGit(inst) {
  const projectRes = await ensureLookerProject(inst, 'nano_admin', inst.projectState);
  const modelRes = await ensureLookerModel(inst, 'nano_admin', 'nano_admin', inst.modelSelection, inst.projectState);
  const gitRes = await configureLookerProjectGit(inst, 'nano_admin', {
    action: inst.gitAction,
    git_type: inst.git_type,
    git_remote_url: inst.git_remote_url,
    deploy_key: inst.deploy_key
  });
  const filesRes = await inspectLookerProjectFiles(inst, 'nano_admin');

  return {
    host: inst.looker_host,
    project: projectRes,
    model: modelRes,
    git: gitRes,
    files: filesRes
  };
}

function extractSanitizedConfigSummary(mergedConfig) {
  return {
    gcp_project_id: mergedConfig.gcp_project_id,
    gcp_region: mergedConfig.gcp_region,
    gcf_name: mergedConfig.gcf_name,
    gcf_ingress_settings: mergedConfig.gcf_ingress_settings || 'all',
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
  console.warn('    Please ensure NANO_ADMIN_LOOKERSDK_CLIENT_ID_<sanitized_host>, NANO_ADMIN_LOOKERSDK_CLIENT_SECRET_<sanitized_host>, and GCF_HMAC_SECRET are manually created/configured in Secret Manager.');
}

module.exports = {
  runDeployment,
  assembleMergedConfig,
  setupLookerProjectAndGit
};
