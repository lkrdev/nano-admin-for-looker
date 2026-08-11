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
  checkPrerequisites,
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
  await checkPrerequisites();

  const config = loadConfig(CONFIG_PATH);
  ensureConfigCompleteness(config);

  await ensureLookerLoggedIn(config);
  const gcfUrl = resolveGcfUrl(config);
  const results = await runPostDeploymentVerification(config, gcfUrl);

  evaluateValidationResults(results);
}

async function runFullDeploymentPipeline() {
  printHeader();
  logDeployStep('Initialization', 'Starting deployment run');
  await checkPrerequisites();

  const config = loadConfig(CONFIG_PATH);
  const skipPrompts = await decideUseSavedConfig(config);

  const connectionConfig = await resolveConnectionConfig(config, skipPrompts);
  const gcpConfig = await resolveGCPConfig(config, skipPrompts);
  const saConfig = await resolveServiceAccountConfig(connectionConfig, gcpConfig, config, skipPrompts);

  const lookerUser = await ensureLookerLoggedIn(connectionConfig);
  const lookerCreds = await getLookerCredentials(connectionConfig, saConfig);

  const mergedConfig = assembleMergedConfig(connectionConfig, saConfig, gcpConfig);
  saveConfig(CONFIG_PATH, mergedConfig);
  logDeployStep('Configuration Saved', extractSanitizedConfigSummary(mergedConfig));

  const resourceStatus = await scanExistingResources(mergedConfig, getLookerSaById);
  printDeploymentPreview(mergedConfig, lookerUser, resourceStatus);

  const confirmed = await askConfirmation();
  if (!confirmed) {
    handleCancelledDeployment();
    return;
  }

  logDeployStep('Operations Started');

  const { gcfUrl, secretManagerError } = await deployGCF(mergedConfig, lookerCreds);
  logDeployStep('GCF Deployed', { gcfUrl, secretManagerError });

  const publicUrl = `https://storage.googleapis.com/${mergedConfig.gcs_bucket_name}/`;
  const manifestContent = updateLocalConfigs(gcfUrl, publicUrl);
  logDeployStep('Configs Updated & Bundle Built', { gcfUrl, publicUrl });

  await deployExtensionToGCS(mergedConfig);
  logDeployStep('Extension Uploaded to GCS', { gcs_bucket_name: mergedConfig.gcs_bucket_name });

  await configureLookerAttribute(mergedConfig, gcfUrl);
  logDeployStep('Looker User Attribute Configured', { gcfUrl });

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

async function resolveConnectionConfig(config, skipPrompts) {
  return skipPrompts ? getSavedConnectionConfig(config) : await promptLookerConnection(config);
}

async function resolveGCPConfig(config, skipPrompts) {
  return skipPrompts ? getSavedGCPConfig(config) : await promptGCPConfig(config);
}

async function resolveServiceAccountConfig(connectionConfig, gcpConfig, config, skipPrompts) {
  return skipPrompts
    ? getSavedServiceAccountConfig(config, checkSecretsExistInGCP)
    : await promptLookerServiceAccount(connectionConfig, gcpConfig, config, checkSecretsExistInGCP);
}

function assembleMergedConfig(connectionConfig, saConfig, gcpConfig) {
  return { ...connectionConfig, ...saConfig, ...gcpConfig };
}

function extractSanitizedConfigSummary(mergedConfig) {
  return {
    looker_host: mergedConfig.looker_host,
    gcp_project_id: mergedConfig.gcp_project_id,
    gcp_region: mergedConfig.gcp_region,
    gcf_name: mergedConfig.gcf_name,
    gcs_bucket_name: mergedConfig.gcs_bucket_name
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
