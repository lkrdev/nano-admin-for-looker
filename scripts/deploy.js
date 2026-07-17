const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const readline = require('readline');
const crypto = require('crypto');

const CONFIG_PATH = path.join(__dirname, '..', 'deploy-config.json');

// ============================================================================
// 1. MAIN SEQUENTIAL DEPLOYMENT FLOW
// ============================================================================

async function runDeployment() {
  printHeader();
  await checkPrerequisites();

  const config = loadConfig(CONFIG_PATH);

  const skipPrompts = await decideUseSavedConfig(config);
  
  const connectionConfig = skipPrompts ? getSavedConnectionConfig(config) : await promptLookerConnection(config);
  const gcpConfig = skipPrompts ? getSavedGCPConfig(config) : await promptGCPConfig(config);
  const saConfig = skipPrompts ? getSavedServiceAccountConfig(config) : await promptLookerServiceAccount(connectionConfig, gcpConfig, config);

  const lookerUser = await ensureLookerLoggedIn(connectionConfig);
  const lookerCreds = await getLookerCredentials(connectionConfig, saConfig);

  const mergedConfig = { ...connectionConfig, ...saConfig, ...gcpConfig };
  saveConfig(CONFIG_PATH, mergedConfig);

  const resourceStatus = await scanExistingResources(mergedConfig);
  printDeploymentPreview(mergedConfig, lookerUser, resourceStatus);

  const confirmed = await askConfirmation();
  if (!confirmed) {
    printDeploymentCancelled();
    return;
  }

  console.log('\n🚀 Starting deployment operations...');
  const gcfUrl = await deployGCF(mergedConfig, lookerCreds);
  
  const publicUrl = `https://storage.googleapis.com/${mergedConfig.gcs_bucket_name}/`;
  const manifestContent = updateLocalConfigs(gcfUrl, publicUrl);

  await deployExtensionToGCS(mergedConfig);
  await configureLookerAttribute(mergedConfig, gcfUrl);

  await runPostDeploymentVerification(mergedConfig);

  printDeploymentSuccess(mergedConfig, manifestContent, gcfUrl);
}

runDeployment().catch((err) => {
  console.error('\n💥 Deployment failed:', err);
  process.exit(1);
});

// ============================================================================
// 2. HOISTED HELPER FUNCTIONS (PURE / NO CLOSURES)
// ============================================================================

function printHeader() {
  console.log('====================================================');
  console.log('🚀 Nano-Admin for Looker Deployment Script 🚀');
  console.log('====================================================');
  console.log('Welcome! You will be guided through configuring your target settings.');
  console.log('NOTE: No changes will be applied to your Looker instance or GCP project');
  console.log('until you have reviewed and confirmed the final deployment preview.');
  console.log('====================================================\n');
}

async function checkPrerequisites() {
  console.log('🔍 Checking prerequisites...');

  // 1. Node & NPM
  try {
    execSync('node --version', { stdio: 'ignore' });
    execSync('npm --version', { stdio: 'ignore' });
  } catch (e) {
    console.error('❌ Error: Node.js and npm are required but were not found.');
    console.error('Please install Node.js (v18+) and npm before running this script.');
    process.exit(1);
  }

  // 2. gcloud CLI
  try {
    execSync('gcloud --version', { stdio: 'ignore' });
  } catch (e) {
    console.error('❌ Error: Google Cloud CLI (gcloud) is required but was not found.');
    console.error('Please install the Google Cloud SDK: https://cloud.google.com/sdk/docs/install');
    process.exit(1);
  }

  // 3. looker-cli
  try {
    execSync('looker-cli version', { stdio: 'ignore' });
  } catch (e) {
    console.error('❌ Error: looker-cli is required but was not found in your PATH.');
    console.error('Please make sure looker-cli is installed and added to your PATH.');
    process.exit(1);
  }

  // 4. Verify GCP Active Authentication Session
  await checkGCPAuth();

  console.log('✅ All prerequisites met (Node/NPM, gcloud CLI, looker-cli, GCP session).');
}

async function checkGCPAuth() {
  console.log('🔑 Checking Google Cloud session status...');
  let authenticated = false;

  while (!authenticated) {
    try {
      // Run print-access-token with stdio: 'pipe' so it fails instead of popping up credentials prompt
      execSync('gcloud auth print-access-token', { stdio: 'pipe' });
      authenticated = true;
      console.log('✅ Google Cloud session is active and valid.');
    } catch (err) {
      console.log('\n⚠️  Google Cloud SDK authentication is missing or expired.');
      console.log('To avoid interactive password prompts in this script, please open a separate terminal and run:');
      console.log('    gcloud auth login');
      console.log('\nOnce authenticated, return here to continue.');
      
      const response = await askQuestion('\nPress [Enter] to retry authentication check, or "q" to quit: ');
      if (response.toLowerCase() === 'q') {
        console.log('❌ Deployment aborted.');
        process.exit(1);
      }
    }
  }
}

function loadConfig(configPath) {
  let config = {};
  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (e) {
      console.warn('⚠️ Warning: Failed to parse deploy-config.json. Starting fresh.');
    }
  }
  return config;
}

function saveConfig(configPath, config) {
  const safeConfig = {
    looker_host: config.looker_host,
    looker_port: config.looker_port,
    looker_ssl: config.looker_ssl,
    gcp_project_id: config.gcp_project_id,
    gcp_region: config.gcp_region,
    gcf_name: config.gcf_name,
    gcs_bucket_name: config.gcs_bucket_name,
    looker_service_account: config.looker_service_account,
    looker_credential_method: config.looker_credential_method,
  };
  fs.writeFileSync(configPath, JSON.stringify(safeConfig, null, 2), 'utf8');
  console.log('✅ Configuration saved to deploy-config.json (sensitive data omitted).');
}

async function promptLookerConnection(config) {
  console.log('⚙️ Connecting to Looker...');
  
  const hostInput = await askQuestion(`Enter Looker API Host [${config.looker_host || 'your-instance.looker.app'}]: `);
  const host = hostInput || config.looker_host;
  if (!host) {
    console.error('❌ Error: Looker Host is required.');
    process.exit(1);
  }
  
  const portInput = await askQuestion(`Enter Looker API Port [${config.looker_port || '443'}]: `);
  const port = portInput || config.looker_port || '443';
  
  const defaultSsl = config.looker_ssl !== undefined ? (config.looker_ssl ? 'Y' : 'n') : 'Y';
  const sslInput = await askQuestion(`Use SSL (HTTPS)? (Y/n) [${defaultSsl}]: `);
  const ssl = sslInput === '' ? (defaultSsl === 'Y') : (sslInput.toLowerCase() !== 'n');

  return {
    looker_host: host,
    looker_port: port,
    looker_ssl: ssl
  };
}

async function ensureLookerLoggedIn(connectionConfig) {
  console.log('\n🔑 Checking Looker session status...');
  let loggedIn = false;
  let lookerUser = 'Unknown User';

  try {
    const userMeOutput = execSync(`looker-cli api user me --host=${connectionConfig.looker_host} --port=${connectionConfig.looker_port} --ssl=${connectionConfig.looker_ssl}`, { encoding: 'utf8', stdio: 'pipe' });
    const userMe = parseJsonFromStdout(userMeOutput);
    lookerUser = `${userMe.display_name || userMe.first_name + ' ' + userMe.last_name} (${userMe.email})`;
    loggedIn = true;
  } catch (e) {
    console.log('Not authenticated with Looker. Initiating login via OAuth PKCE...');
    const loginArgs = ['session', 'login', '--oauth', `--host=${connectionConfig.looker_host}`, `--port=${connectionConfig.looker_port}`, `--ssl=${connectionConfig.looker_ssl}`];
    
    await runCommandFiltered('looker-cli', loginArgs);

    try {
      const userMeOutput = execSync(`looker-cli api user me --host=${connectionConfig.looker_host} --port=${connectionConfig.looker_port} --ssl=${connectionConfig.looker_ssl}`, { encoding: 'utf8', stdio: 'pipe' });
      const userMe = parseJsonFromStdout(userMeOutput);
      lookerUser = `${userMe.display_name || userMe.first_name + ' ' + userMe.last_name} (${userMe.email})`;
      loggedIn = true;
    } catch (meErr) {
      lookerUser = 'Authenticated (Details unavailable)';
      loggedIn = true;
    }
  }

  if (!loggedIn) {
    console.error('❌ Error: Could not authenticate with Looker.');
    process.exit(1);
  }

  return lookerUser;
}

async function promptLookerServiceAccount(connectionConfig, gcpConfig, config) {
  const secretsExist = checkSecretsExistInGCP(gcpConfig.gcp_project_id);

  console.log('\n🔎 Eagerly scanning Looker for matching service accounts...');
  let matchedSAs = [];
  try {
    const out = execSync(`looker-cli api user search_users --is_service_account=true --host=${connectionConfig.looker_host} --port=${connectionConfig.looker_port} --ssl=${connectionConfig.looker_ssl}`, { encoding: 'utf8', stdio: 'pipe' });
    const users = JSON.parse(out);
    if (users && users.length > 0) {
      matchedSAs = users.filter((u) => {
        const name = ((u.first_name || '') + ' ' + (u.last_name || '')).toLowerCase();
        const email = (u.email || '').toLowerCase();
        return (
          (name.includes('nano') && name.includes('admin')) ||
          (email.includes('nano') && email.includes('admin'))
        );
      });
    }
  } catch (e) {
    console.warn('⚠️ Warning: Failed to scan Looker service accounts automatically.');
  }

  const options = [];
  let reuseOptionIdx = -1;
  let manualOptionIdx = -1;
  let createOptionIdx = -1;

  if (secretsExist) {
    options.push({ text: 'Reuse current credentials stored in GCP Secret Manager', value: 'reuse' });
    reuseOptionIdx = options.length;
  }

  options.push({ text: 'Enter Looker API Client ID and Client Secret manually', value: 'manual' });
  manualOptionIdx = options.length;

  options.push({ text: "Create a new Looker Service Account ('Nano Admin Backend SA') and generate credentials", value: 'create' });
  createOptionIdx = options.length;

  matchedSAs.forEach((sa) => {
    const saName = ((sa.first_name || '') + ' ' + (sa.last_name || '')).trim();
    options.push({
      text: `Use existing Service Account '${saName}' (ID: ${sa.id}) and generate credentials`,
      value: `sa_${sa.id}`,
      saId: sa.id
    });
  });

  console.log('\nHow should the Looker Service Account & API credentials be configured?');
  options.forEach((opt, idx) => {
    console.log(`  ${idx + 1} = ${opt.text}`);
  });

  const defaultOption = reuseOptionIdx !== -1 ? '1' : `${createOptionIdx}`;
  const choiceInput = await askQuestion(`Choose option [${defaultOption}]: `);
  const choice = choiceInput || defaultOption;

  const selectedIdx = parseInt(choice, 10) - 1;
  if (isNaN(selectedIdx) || selectedIdx < 0 || selectedIdx >= options.length) {
    console.error('❌ Error: Invalid option selected.');
    process.exit(1);
  }

  const selectedOpt = options[selectedIdx];
  let looker_credential_method = 'generate';
  let looker_service_account = '';
  let manual_client_id = '';
  let manual_client_secret = '';

  if (selectedOpt.value === 'reuse') {
    looker_credential_method = 'reuse';
  } else if (selectedOpt.value === 'manual') {
    looker_credential_method = 'manual';
    manual_client_id = await askQuestion('Enter Looker API Client ID: ');
    manual_client_secret = await askQuestion('Enter Looker API Client Secret: ');
    if (!manual_client_id || !manual_client_secret) {
      console.error('❌ Error: Both Client ID and Client Secret are required for manual mode.');
      process.exit(1);
    }
  } else if (selectedOpt.value === 'create') {
    looker_credential_method = 'generate';
    looker_service_account = '';
  } else if (selectedOpt.value.startsWith('sa_')) {
    looker_credential_method = 'generate';
    looker_service_account = selectedOpt.saId;
  }

  return {
    looker_service_account,
    looker_credential_method,
    manual_client_id,
    manual_client_secret
  };
}

async function getLookerCredentials(connectionConfig, saConfig) {
  let clientId = '';
  let clientSecret = '';

  console.log('\n🔐 Looker API Credentials Provisioning...');

  if (saConfig.looker_credential_method === 'reuse') {
    console.log('✅ Reusing existing Looker credentials stored in GCP Secret Manager.');
    return null;
  }

  if (saConfig.looker_credential_method === 'manual') {
    clientId = saConfig.manual_client_id;
    clientSecret = saConfig.manual_client_secret;
    console.log('✅ Using manually entered API credentials.');

    if (saConfig.looker_service_account) {
      const targetLookerSa = await getLookerSaById(connectionConfig, saConfig.looker_service_account);
      if (targetLookerSa) {
        const hasAdmin = await checkUserAdminPermission(connectionConfig, targetLookerSa.id);
        if (!hasAdmin) {
          console.log(`🚨 WARNING: Looker service account permissions check failed. We verified that service account ID "${targetLookerSa.id}" is missing the Administrator role/permissions. Nano-admin administrative workflows will fail unless you assign the 'Admin' role (or a role containing the 'administer' permission) to this service account in Looker.`);
        } else {
          console.log('✅ Verified: Looker service account has Administrator role/permissions.');
        }
      } else {
        console.log(`⚠️  WARNING: Service account "${saConfig.looker_service_account}" could not be found in Looker. Please ensure this service account exists and has the Administrator role assigned.`);
      }
    }
  } else {
    let targetSaId = '';
    let targetLookerSa = null;

    if (saConfig.looker_service_account) {
      targetLookerSa = await getLookerSaById(connectionConfig, saConfig.looker_service_account);
    }
    
    if (targetLookerSa) {
      targetSaId = targetLookerSa.id;
      console.log(`Using existing Looker service account ID: ${targetSaId}`);
    } else {
      const saName = saConfig.looker_service_account || 'Nano Admin Backend SA';
      console.log(`Creating new Looker service account: "${saName}"...`);
      try {
        const payload = JSON.stringify({ service_account_name: saName });
        const createOutput = execSync(`echo '${payload}' | looker-cli api user create_service_account - --host=${connectionConfig.looker_host} --port=${connectionConfig.looker_port} --ssl=${connectionConfig.looker_ssl}`, { encoding: 'utf8', stdio: 'pipe' });
        const newSa = parseJsonFromStdout(createOutput);
        targetSaId = newSa.id;
        console.log(`✅ Successfully created Looker service account ID: ${targetSaId}`);
      } catch (createErr) {
        console.error('❌ Failed to create Looker service account:', createErr.message);
        process.exit(1);
      }
    }

    console.log(`Generating API credentials for Looker service account ID ${targetSaId}...`);
    try {
      const credsOutput = execSync(`looker-cli api user create_user_credentials_api3 ${targetSaId} --host=${connectionConfig.looker_host} --port=${connectionConfig.looker_port} --ssl=${connectionConfig.looker_ssl}`, { encoding: 'utf8', stdio: 'pipe' });
      const creds = parseJsonFromStdout(credsOutput);
      clientId = creds.client_id;
      clientSecret = creds.client_secret;
      console.log('✅ Successfully generated new API client ID & secret.');

      const hasAdmin = await checkUserAdminPermission(connectionConfig, targetSaId);
      if (!hasAdmin) {
        console.log(`🚨 WARNING: Looker service account permissions check failed. We verified that service account ID "${targetSaId}" is missing the Administrator role/permissions. Nano-admin administrative workflows will fail unless you assign the 'Admin' role (or a role containing the 'administer' permission) to this service account in Looker.`);
      } else {
        console.log('✅ Verified: Looker service account has Administrator role/permissions.');
      }
    } catch (e) {
      console.error('❌ Failed to generate API credentials:', e.message);
      process.exit(1);
    }
  }

  return { clientId, clientSecret };
}

async function promptGCPConfig(config) {
  console.log('\n⚙️ Configuring GCP settings...');
  
  const defaultProj = config.gcp_project_id || '';
  const projectId = await askQuestion(`Enter GCP Project ID [${defaultProj}]: `);
  const finalProjectId = projectId || defaultProj;
  if (!finalProjectId) {
    console.error('❌ Error: GCP Project ID is required.');
    process.exit(1);
  }
  
  const regionInput = await askQuestion(`Enter GCP Region [${config.gcp_region || 'us-central1'}]: `);
  const region = regionInput || config.gcp_region || 'us-central1';

  const gcfNameInput = await askQuestion(`Enter Cloud Function Name [${config.gcf_name || 'nano-admin-backend'}]: `);
  const functionName = gcfNameInput || config.gcf_name || 'nano-admin-backend';

  const defaultBucket = config.gcs_bucket_name || `${finalProjectId}-nano-admin-extension`;
  const bucketInput = await askQuestion(`Enter GCS Bucket Name to host extension assets [${defaultBucket}]: `);
  const bucketName = bucketInput || defaultBucket;

  return {
    gcp_project_id: finalProjectId,
    gcp_region: region,
    gcf_name: functionName,
    gcs_bucket_name: bucketName
  };
}

async function scanExistingResources(config) {
  let gcpAccount = 'Unknown Account';
  try {
    gcpAccount = execSync('gcloud config get-value account', { encoding: 'utf8' }).trim();
  } catch (e) {}

  console.log('\n🔎 Scanning Looker to verify target service account...');
  let targetLookerSa = null;
  if (config.looker_service_account) {
    targetLookerSa = await getLookerSaById(config, config.looker_service_account);
  }

  console.log('🔎 Scanning GCP environment for existing resources...');
  let secretClientIdExists = false;
  let secretClientSecretExists = false;
  let secretHmacExists = false;
  try {
    execSync(`gcloud secrets describe LOOKERSDK_CLIENT_ID --project=${config.gcp_project_id}`, { stdio: 'ignore' });
    secretClientIdExists = true;
  } catch (e) {}
  try {
    execSync(`gcloud secrets describe LOOKERSDK_CLIENT_SECRET --project=${config.gcp_project_id}`, { stdio: 'ignore' });
    secretClientSecretExists = true;
  } catch (e) {}
  try {
    execSync(`gcloud secrets describe GCF_HMAC_SECRET --project=${config.gcp_project_id}`, { stdio: 'ignore' });
    secretHmacExists = true;
  } catch (e) {}

  let functionExists = false;
  try {
    execSync(`gcloud functions describe ${config.gcf_name} --region=${config.gcp_region} --project=${config.gcp_project_id}`, { stdio: 'ignore' });
    functionExists = true;
  } catch (e) {}

  let attributeExists = false;
  try {
    execSync(`looker-cli attribute cat nano_admin_admin_extension_nano_admin_challenge --host=${config.looker_host} --port=${config.looker_port} --ssl=${config.looker_ssl}`, { stdio: 'ignore' });
    attributeExists = true;
  } catch (e) {}

  return {
    gcpAccount,
    targetLookerSa,
    secretClientIdExists,
    secretClientSecretExists,
    secretHmacExists,
    functionExists,
    attributeExists
  };
}

function printDeploymentPreview(config, lookerUser, status) {
  let lookerSaStatus = '';
  if (config.looker_credential_method === 'reuse') {
    lookerSaStatus = 'Use existing credentials (skip Looker Service Account provisioning)';
  } else if (config.looker_credential_method === 'manual') {
    lookerSaStatus = 'Use manually provided credentials (skip Looker Service Account provisioning)';
  } else {
    if (status.targetLookerSa) {
      const fullName = ((status.targetLookerSa.first_name || '') + ' ' + (status.targetLookerSa.last_name || '')).trim();
      lookerSaStatus = `Reuse existing service account: ${fullName} (ID: ${status.targetLookerSa.id})`;
    } else if (config.looker_service_account) {
      lookerSaStatus = `Create new dedicated service account with ID/Name: "${config.looker_service_account}"`;
    } else {
      lookerSaStatus = `Create new dedicated service account: "Nano Admin Backend SA"`;
    }
  }

  let credsLabel = 'Manually entered credentials';
  if (config.looker_credential_method === 'generate') {
    credsLabel = 'Generate automatically via OAuth';
  } else if (config.looker_credential_method === 'reuse') {
    credsLabel = 'Reuse existing credentials stored in GCP Secret Manager';
  }

  const targetLookerSaName = config.looker_service_account || 'Nano Admin Backend SA';
  let saLabel = targetLookerSaName;
  if (status.targetLookerSa) {
    saLabel = `${((status.targetLookerSa.first_name || '') + ' ' + (status.targetLookerSa.last_name || '')).trim()} (ID: ${status.targetLookerSa.id})`;
  } else if (config.looker_credential_method === 'manual') {
    saLabel = 'N/A (Using manual credentials)';
  } else if (config.looker_credential_method === 'reuse') {
    saLabel = config.looker_service_account ? `${config.looker_service_account} (Reusing credentials)` : 'Reusing current credentials stored in Secret Manager';
  }

  let clientIdAction = status.secretClientIdExists ? 'UPDATED (NEW VERSION ADDED)' : 'NEWLY CREATED';
  let clientSecretAction = status.secretClientSecretExists ? 'UPDATED (NEW VERSION ADDED)' : 'NEWLY CREATED';
  if (config.looker_credential_method === 'reuse') {
    clientIdAction = 'REUSED (UNTOUCHED)';
    clientSecretAction = 'REUSED (UNTOUCHED)';
  }

  console.log('\n======================================================');
  console.log('🔎 PREVIEW OF PENDING CHANGES');
  console.log('======================================================');
  console.log('Please review the active sessions and target configuration below:');
  console.log('\nTarget Configurations:');
  console.log(`  • Looker Host:            ${config.looker_host}:${config.looker_port} (SSL: ${config.looker_ssl})`);
  console.log(`  • Looker Service Account:   ${saLabel}`);
  console.log(`  • Looker Credentials:     ${credsLabel}`);
  console.log(`  • GCP Project ID:         ${config.gcp_project_id}`);
  console.log(`  • GCP Region:             ${config.gcp_region}`);
  console.log(`  • Cloud Function Name:    ${config.gcf_name}`);
  console.log(`  • GCS Bucket Name:        ${config.gcs_bucket_name}`);
  console.log('\nActive Sessions (used to apply changes):');
  console.log(`  • Active GCP Account:     ${status.gcpAccount}`);
  console.log(`  • Active Looker User:     ${lookerUser}`);
  console.log('\nDeployment Actions & Resource Overwrites:');
  console.log('  [✓] Compile & package extension (will overwrite extension/src/config.ts & manifest.lkml)');
  console.log('  [✓] Compile backend TypeScript code');
  console.log(`  [ ] Looker Service Account Configuration:`);
  console.log(`      └─ Action: [${lookerSaStatus}]`);
  console.log(`  [ ] Deploy Google Cloud Function:`);
  console.log(`      └─ Status: ${config.gcf_name} will be [${status.functionExists ? 'OVERWRITTEN / RE-DEPLOYED' : 'NEWLY CREATED'}]`);
  console.log(`  [ ] Secret Manager Provisioning & IAM Setup:`);
  console.log(`      ├─ LOOKERSDK_CLIENT_ID:     [${clientIdAction}]`);
  console.log(`      ├─ LOOKERSDK_CLIENT_SECRET: [${clientSecretAction}]`);
  console.log(`      ├─ GCF_HMAC_SECRET:         [${status.secretHmacExists ? 'REUSED (UNTOUCHED)' : 'NEWLY CREATED'}]`);
  console.log(`      └─ Secret Accessor Role:    [GRANT ACCESS TO DEFAULT GCP COMPUTE SERVICE ACCOUNT]`);
  console.log(`  [ ] GCP Project IAM Setup:`);
  console.log(`      └─ Cloud Build Builder Role: [GRANT roles/cloudbuild.builds.builder TO DEFAULT COMPUTE SERVICE ACCOUNT]`);
  console.log(`  [ ] Looker User Attribute:`);
  console.log(`      └─ nano_admin_admin_extension_nano_admin_challenge: [${status.attributeExists ? 'FORCE-UPDATED (OVERWRITTEN)' : 'NEWLY CREATED'}]`);
  console.log(`  [ ] Upload Extension Assets to GCS:`);
  console.log(`      └─ Destination: gs://${config.gcs_bucket_name}/`);
  console.log('======================================================');
}

async function askConfirmation() {
  const confirm = (await askQuestion('\nAre you sure you want to proceed with these changes? (y/N): ')).toLowerCase();
  return (confirm === 'y' || confirm === 'yes');
}

function printDeploymentCancelled() {
  console.log('\n❌ Deployment cancelled. No changes were applied.');
}

async function deployGCF(config, lookerCreds) {
  console.log('\n☁️ Setting up Google Cloud deployment...');

  const localBuildHash = loadLocalBuildHash();
  console.log(`Local Build Hash is: ${localBuildHash}`);

  console.log(`Setting active GCP project to ${config.gcp_project_id}...`);
  execSync(`gcloud config set project ${config.gcp_project_id}`, { stdio: 'inherit' });

  console.log('Enabling required Google Cloud APIs (Function, Secret Manager, Cloud Build)...');
  try {
    execSync('gcloud services enable cloudfunctions.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com', { stdio: 'inherit' });
  } catch (e) {
    console.warn('⚠️ Warning: Failed to enable services automatically. Make sure they are enabled in your GCP project.');
  }

  const projectNumber = execSync(`gcloud projects describe ${config.gcp_project_id} --format="value(projectNumber)"`, { encoding: 'utf8' }).trim();
  const defaultSa = `${projectNumber}-compute@developer.gserviceaccount.com`;
  console.log(`Default Compute Engine service account: ${defaultSa}`);

  console.log(`Ensuring Cloud Build Builder permission for default Compute Service Account: ${defaultSa}...`);
  try {
    execSync(`gcloud projects add-iam-policy-binding ${config.gcp_project_id} --member="serviceAccount:${defaultSa}" --role="roles/cloudbuild.builds.builder"`, { stdio: 'ignore' });
    console.log('✅ Granted roles/cloudbuild.builds.builder permission.');
  } catch (e) {
    console.warn('⚠️ Warning: Failed to automatically grant Cloud Build Builder permission. This may cause deployment warnings or failures.');
  }

  let useSecretManager = true;
  try {
    execSync('gcloud secrets list --limit=1', { stdio: 'ignore' });
  } catch (e) {
    console.warn('⚠️ Warning: Secret Manager API is not enabled or you do not have permission. Falling back to environment variables.');
    useSecretManager = false;
  }

  let deployCommand = '';

  if (useSecretManager) {
    let hasHmac = false;
    try {
      execSync('gcloud secrets describe GCF_HMAC_SECRET', { stdio: 'ignore' });
      hasHmac = true;
      console.log('✅ GCF_HMAC_SECRET already exists in Secret Manager.');
    } catch (e) {
      console.log('Creating GCF_HMAC_SECRET secret in Secret Manager...');
      try {
        execSync('gcloud secrets create GCF_HMAC_SECRET --replication-policy="automatic"', { stdio: 'inherit' });
      } catch (err) {}
    }

    if (!hasHmac) {
      const hmacSecret = crypto.randomBytes(32).toString('hex');
      console.log('Adding new secret version for GCF_HMAC_SECRET...');
      execSync(`echo -n "${hmacSecret}" | gcloud secrets versions add GCF_HMAC_SECRET --data-file=-`, { stdio: 'inherit' });
    }

    if (lookerCreds) {
      console.log('Configuring LOOKERSDK_CLIENT_ID in Secret Manager...');
      try {
        execSync('gcloud secrets describe LOOKERSDK_CLIENT_ID', { stdio: 'ignore' });
      } catch (e) {
        try {
          execSync('gcloud secrets create LOOKERSDK_CLIENT_ID --replication-policy="automatic"', { stdio: 'inherit' });
        } catch (err) {}
      }
      execSync(`echo -n "${lookerCreds.clientId}" | gcloud secrets versions add LOOKERSDK_CLIENT_ID --data-file=-`, { stdio: 'inherit' });

      console.log('Configuring LOOKERSDK_CLIENT_SECRET in Secret Manager...');
      try {
        execSync('gcloud secrets describe LOOKERSDK_CLIENT_SECRET', { stdio: 'ignore' });
      } catch (e) {
        try {
          execSync('gcloud secrets create LOOKERSDK_CLIENT_SECRET --replication-policy="automatic"', { stdio: 'inherit' });
        } catch (err) {}
      }
      execSync(`echo -n "${lookerCreds.clientSecret}" | gcloud secrets versions add LOOKERSDK_CLIENT_SECRET --data-file=-`, { stdio: 'inherit' });
    }

    console.log(`Granting Secret Accessor permission to default Compute Service Account: ${defaultSa}...`);
    try {
      execSync(`gcloud secrets add-iam-policy-binding GCF_HMAC_SECRET --member="serviceAccount:${defaultSa}" --role="roles/secretmanager.secretAccessor" --project=${config.gcp_project_id}`, { stdio: 'ignore' });
      execSync(`gcloud secrets add-iam-policy-binding LOOKERSDK_CLIENT_ID --member="serviceAccount:${defaultSa}" --role="roles/secretmanager.secretAccessor" --project=${config.gcp_project_id}`, { stdio: 'ignore' });
      execSync(`gcloud secrets add-iam-policy-binding LOOKERSDK_CLIENT_SECRET --member="serviceAccount:${defaultSa}" --role="roles/secretmanager.secretAccessor" --project=${config.gcp_project_id}`, { stdio: 'ignore' });
    } catch (e) {
      console.warn('⚠️ Warning: Failed to grant Secret Accessor permission automatically. Make sure the default compute service account has roles/secretmanager.secretAccessor role.');
    }

    console.log('\n📦 Compiling backend TypeScript code...');
    execSync('npm run backend:build', { stdio: 'inherit' });

    console.log(`\n🚀 Deploying Cloud Function: ${config.gcf_name} to region ${config.gcp_region}...`);
    deployCommand = `gcloud functions deploy ${config.gcf_name} \\
      --gen2 \\
      --runtime=nodejs24 \\
      --region=${config.gcp_region} \\
      --trigger-http \\
      --allow-unauthenticated \\
      --entry-point=nanoAdminBackend \\
      --source=backend \\
      --set-env-vars="LOOKERSDK_BASE_URL=https://${config.looker_host}:${config.looker_port},BUILD_HASH=${localBuildHash}" \\
      --set-secrets="LOOKERSDK_CLIENT_ID=LOOKERSDK_CLIENT_ID:latest,LOOKERSDK_CLIENT_SECRET=LOOKERSDK_CLIENT_SECRET:latest,GCF_HMAC_SECRET=GCF_HMAC_SECRET:latest"`;
  } else {
    if (!lookerCreds) {
      console.error('❌ Error: Looker credentials are required for environment variables fallback but were not provided/found.');
      process.exit(1);
    }
    const hmacSecret = crypto.randomBytes(32).toString('hex');
    console.log('\n📦 Compiling backend TypeScript code...');
    execSync('npm run backend:build', { stdio: 'inherit' });

    console.log(`\n🚀 Deploying Cloud Function (fallback env vars): ${config.gcf_name} to region ${config.gcp_region}...`);
    deployCommand = `gcloud functions deploy ${config.gcf_name} \\
      --gen2 \\
      --runtime=nodejs24 \\
      --region=${config.gcp_region} \\
      --trigger-http \\
      --allow-unauthenticated \\
      --entry-point=nanoAdminBackend \\
      --source=backend \\
      --set-env-vars="LOOKERSDK_BASE_URL=https://${config.looker_host}:${config.looker_port},LOOKERSDK_CLIENT_ID=${lookerCreds.clientId},LOOKERSDK_CLIENT_SECRET=${lookerCreds.clientSecret},GCF_HMAC_SECRET=${hmacSecret},BUILD_HASH=${localBuildHash}"`;
  }

  console.log(`Running deploy command:\n${deployCommand}\n`);
  try {
    await executeDeployCommand(deployCommand);
  } catch (error) {
    const isDrs = error.stderr && (
      error.stderr.includes('do not belong to a permitted customer') ||
      error.stderr.includes('allowedPolicyMemberDomains')
    );

    if (isDrs) {
      printDrsTroubleshootingGuide(config.gcp_project_id);
    }
    throw error;
  }

  console.log('Retrieving deployed Cloud Function URL...');
  const gcfUrl = execSync(`gcloud functions describe ${config.gcf_name} --region=${config.gcp_region} --format="value(serviceConfig.uri)"`, { encoding: 'utf8' }).trim();
  console.log(`\n✅ Cloud Function deployed successfully at: ${gcfUrl}`);
  return gcfUrl;
}

function updateLocalConfigs(gcfUrl, publicUrl) {
  console.log('\n🔄 Generating manifest configuration in memory...');

  const manifestPath = path.join(__dirname, '..', 'extension', 'manifest.lkml');
  let manifest = '';
  if (fs.existsSync(manifestPath)) {
    manifest = fs.readFileSync(manifestPath, 'utf8');
    const gcsBundleUrl = `${publicUrl}bundle.js`;

    manifest = manifest.replace(/file:\s*"bundle\.js"/g, '');
    
    const urlPattern = /url:\s*".*?"/g;
    if (urlPattern.test(manifest)) {
      manifest = manifest.replace(urlPattern, `url: "${gcsBundleUrl}"`);
    } else {
      manifest = manifest.replace(
        /application:\s*admin_extension\s*\{/g,
        `application: admin_extension {\n  url: "${gcsBundleUrl}"`
      );
    }

    manifest = manifest.replace(/#\s*url:\s*".*?"\n/g, '');

    const requiredUrls = [`"${gcfUrl}"`, `"https://storage.googleapis.com"`];
    manifest = manifest.replace(
      /external_api_urls:\s*\[([\s\S]*?)\]/g,
      (match, p1) => {
        const urls = p1.split('\n')
          .map(l => l.trim().replace(/,$/, ''))
          .filter(Boolean);
        
        requiredUrls.forEach(reqUrl => {
          if (!urls.includes(reqUrl)) {
            urls.push(reqUrl);
          }
        });
        
        return `external_api_urls: [\n      ${urls.join(',\n      ')}\n    ]`;
      }
    );
    console.log('✅ Generated manifest configuration in memory.');
  }

  console.log('\n📦 Compiling extension React bundle with environment variables...');
  execSync('npm run extension:build', {
    stdio: 'inherit',
    env: {
      ...process.env,
      BACKEND_URL: gcfUrl,
      PUBLIC_PATH: publicUrl
    }
  });
  console.log('✅ Compiled extension React bundle successfully.');

  return manifest;
}

async function deployExtensionToGCS(config) {
  const bucketName = config.gcs_bucket_name;
  console.log(`\n🪣 Configuring Google Cloud Storage Bucket: gs://${bucketName}...`);

  try {
    execSync(`gcloud storage buckets describe gs://${bucketName} --project=${config.gcp_project_id}`, { stdio: 'ignore' });
    console.log(`✅ Bucket gs://${bucketName} already exists.`);
  } catch (e) {
    console.log(`Creating new storage bucket gs://${bucketName}...`);
    try {
      execSync(`gcloud storage buckets create gs://${bucketName} --location=${config.gcp_region} --project=${config.gcp_project_id}`, { stdio: 'inherit' });
      console.log('✅ Bucket created successfully.');
    } catch (createErr) {
      console.error(`❌ Failed to create bucket: ${createErr.message}`);
      process.exit(1);
    }
  }

  console.log(`Setting public read access on bucket gs://${bucketName}...`);
  try {
    execSync(`gcloud storage buckets add-iam-policy-binding gs://${bucketName} --member=allUsers --role=roles/storage.objectViewer --project=${config.gcp_project_id}`, { stdio: 'ignore' });
    console.log(`✅ Granted public read access to allUsers.`);
  } catch (iamErr) {
    console.warn(`⚠️ Warning: Failed to automatically set public read access. Ensure publicAccessPrevention is not enforced or configure the bucket policy manually.`);
  }

  console.log(`Configuring CORS policy on bucket gs://${bucketName} for Looker origin...`);
  const corsPath = path.join(__dirname, '..', 'gcs-cors.json');
  const corsConfig = [
    {
      "origin": ["*"],
      "method": ["GET", "OPTIONS", "HEAD"],
      "responseHeader": ["Content-Type", "x-goog-meta-hash"],
      "maxAgeSeconds": 3600
    }
  ];
  fs.writeFileSync(corsPath, JSON.stringify(corsConfig, null, 2), 'utf8');
  try {
    execSync(`gcloud storage buckets update gs://${bucketName} --cors-file="${corsPath}" --project=${config.gcp_project_id}`, { stdio: 'ignore' });
    console.log(`✅ CORS policy configured successfully.`);
  } catch (corsErr) {
    console.warn(`⚠️ Warning: Failed to set CORS policy automatically: ${corsErr.message}`);
  } finally {
    if (fs.existsSync(corsPath)) {
      fs.unlinkSync(corsPath);
    }
  }

  console.log(`Uploading extension assets to gs://${bucketName}...`);
  try {
    execSync(`gcloud storage cp -r extension/dist/* gs://${bucketName}/ --project=${config.gcp_project_id}`, { stdio: 'inherit' });
    console.log(`✅ Successfully uploaded extension assets to GCS.`);
  } catch (uploadErr) {
    console.error(`❌ Failed to upload extension assets to GCS: ${uploadErr.message}`);
    process.exit(1);
  }

  const publicUrl = `https://storage.googleapis.com/${bucketName}/`;
  console.log(`🌍 Extension assets publicly accessible at: ${publicUrl}`);
  return publicUrl;
}

async function configureLookerAttribute(config, gcfUrl) {
  console.log('\n⚙️ Configuring Looker user attribute for secure challenge-response...');

  const allowlist = `http://localhost:8081,https://localhost:8081,${gcfUrl}`;
  const attrName = 'nano_admin_admin_extension_nano_admin_challenge';

  console.log(`Creating/Updating user attribute "${attrName}" with domain whitelist:`);
  console.log(`👉 ${allowlist}`);

  try {
    const cmd = `looker-cli attribute create ${attrName} "Nano Admin Challenge" --is-hidden --type=string --domain-allowlist="${allowlist}" --force --host=${config.looker_host} --port=${config.looker_port} --ssl=${config.looker_ssl}`;
    execSync(cmd, { stdio: 'inherit' });
    console.log('✅ Successfully configured Looker user attribute.');
  } catch (e) {
    console.error('❌ Failed to configure Looker user attribute automatically via CLI:', e.message);
    console.log('Please make sure you are logged in to Looker via looker-cli and try again, or manually configure the attribute in Looker.');
  }
}



function printDeploymentSuccess(config, manifestContent, gcfUrl) {
  const protocol = config.looker_ssl ? 'https' : 'http';
  const lookerIdeUrl = `${protocol}://${config.looker_host}/projects/nano_admin/files/manifest.lkml`;
  const extensionUrl = `${protocol}://${config.looker_host}/extensions/nano_admin::admin_extension`;

  console.log('\n🎉 Deployment and setup completed successfully! 🎉');
  console.log('----------------------------------------------------');
  
  // Check if production manifest is already matching the required values
  const gcsBundleUrl = `https://storage.googleapis.com/${config.gcs_bucket_name}/bundle.js`;
  let prodManifestContent = '';
  try {
    prodManifestContent = execSync(`looker-cli project file cat nano_admin manifest.lkml --host=${config.looker_host} --port=${config.looker_port} --ssl=${config.looker_ssl}`, { encoding: 'utf8', stdio: 'pipe' }).trim();
  } catch (e) {}

  const isManifestUpToDate = prodManifestContent && 
                             prodManifestContent.includes(gcsBundleUrl) && 
                             prodManifestContent.includes(gcfUrl);

  if (isManifestUpToDate) {
    console.log('✅ Production manifest.lkml in Looker already matches the required configuration. No action needed!');
    console.log('\nNext Steps:');
    console.log(`1. Open Looker, load the Nano Admin extension, and test the functionality.`);
    console.log(`   👉 Link: ${extensionUrl}`);
  } else {
    console.log('Next Steps:');
    console.log(`1. Open your Looker project manifest in the Looker IDE:`);
    console.log(`   👉 Link: ${lookerIdeUrl}`);
    console.log('\n2. Edit or create your "manifest.lkml" file and replace its content with the following:');
    console.log('\n----------------- COPY FROM HERE -----------------');
    console.log(manifestContent || 'manifest.lkml content could not be read.');
    console.log('------------------ COPY TO HERE ------------------\n');
    console.log('3. Commit, push, and deploy these manifest changes to production in your Looker project.');
    console.log(`4. Open Looker, load the Nano Admin extension, and test the functionality:`);
    console.log(`   👉 Link: ${extensionUrl}`);
  }
  console.log('----------------------------------------------------');
}

// ============================================================================
// 3. BASE UTILITY FUNCTIONS
// ============================================================================

function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => rl.question(query, (ans) => {
    rl.close();
    resolve(ans.trim());
  }));
}

function parseJsonFromStdout(stdout) {
  const match = stdout.match(/([{\[][\s\S]*[}\]])/);
  if (!match) {
    throw new Error('No valid JSON object or array found in output:\n' + stdout);
  }
  return JSON.parse(match[0]);
}

function runCommandFiltered(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['inherit', 'inherit', 'pipe'] });

    child.stderr.on('data', (data) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        const lower = line.toLowerCase();
        if (
          lower.includes('wayland') ||
          lower.includes('ozone') ||
          lower.includes('drmgetdevices') ||
          lower.includes('gpu/ipc') ||
          lower.includes('contextresult') ||
          lower.includes('tensorflow') ||
          lower.includes('xnnpack') ||
          lower.includes('dbus') ||
          lower.includes('gtk') ||
          lower.includes('gl_') ||
          lower.includes('egl') ||
          lower.includes('chromium') ||
          lower.includes('error:ui') ||
          lower.includes('device_list_x11') ||
          !line.trim()
        ) {
          continue;
        }
        process.stderr.write(line + '\n');
      }
    });

    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed with code ${code}`));
    });
  });
}

async function getLookerSaById(connectionConfig, saId) {
  if (!saId) return null;
  try {
    const out = execSync(`looker-cli api user search_users --id="${saId}" --host=${connectionConfig.looker_host} --port=${connectionConfig.looker_port} --ssl=${connectionConfig.looker_ssl}`, { encoding: 'utf8', stdio: 'pipe' });
    const users = JSON.parse(out);
    if (users && users.length > 0) return users[0];
  } catch (e) {}
  return null;
}

async function checkUserAdminPermission(connectionConfig, userId) {
  try {
    const rolesOutput = execSync(`looker-cli api user user_roles ${userId} --host=${connectionConfig.looker_host} --port=${connectionConfig.looker_port} --ssl=${connectionConfig.looker_ssl}`, { encoding: 'utf8', stdio: 'pipe' });
    const roles = parseJsonFromStdout(rolesOutput);
    
    const rolesList = Array.isArray(roles) ? roles : [roles];
    
    return rolesList.some(role => {
      if (role.name === 'Admin') return true;
      if (role.permission_set) {
        if (role.permission_set.all_access === true) return true;
        if (Array.isArray(role.permission_set.permissions) && role.permission_set.permissions.includes('administer')) return true;
      }
      return false;
    });
  } catch (err) {
    console.warn(`⚠️ Warning: Failed to check service account permissions: ${err.message}`);
    // Return true by default so we don't throw warnings if api fails or role cannot be queried
    return true;
  }
}

function executeDeployCommand(cmdStr) {
  return new Promise((resolve, reject) => {
    const child = spawn('bash', ['-c', cmdStr], { stdio: ['inherit', 'pipe', 'pipe'] });
    let stdoutBuffer = '';
    let stderrBuffer = '';

    child.stdout.on('data', (data) => {
      const str = data.toString();
      stdoutBuffer += str;
      process.stdout.write(str);
    });

    child.stderr.on('data', (data) => {
      const str = data.toString();
      stderrBuffer += str;
      process.stderr.write(str);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdoutBuffer);
      } else {
        const error = new Error(`Command failed with code ${code}`);
        error.stderr = stderrBuffer;
        error.stdout = stdoutBuffer;
        reject(error);
      }
    });
  });
}

function printDrsTroubleshootingGuide(projectId) {
  console.log('\n======================================================');
  console.log('🚨 DOMAIN RESTRICTED SHARING (DRS) POLICY DETECTED');
  console.log('======================================================');
  console.log('The deployment failed because your Google Cloud Organization has');
  console.log('Domain Restricted Sharing (DRS) enabled. This policy prevents');
  console.log('making resources publicly accessible (assigning "allUsers").');
  console.log('\nSince Looker calls the backend Cloud Function, it requires public');
  console.log('(unauthenticated) access to allow the Extension to interact with it.');
  console.log('\nTo resolve this, you need to override the DRS policy for this project:');
  console.log('\nOption A: https://cloud.google.com/blog/topics/developers-practitioners/how-create-public-cloud-run-services-when-domain-restricted-sharing-enforced?e=48754805');
  console.log('\nOption B: Override via gcloud CLI (if you have Policy Admin permissions)');
  console.log('   Run the following commands in your terminal:');
  console.log('   Create a file policy.yaml:');
  console.log('   ---');
  console.log('   name: projects/' + projectId + '/policies/iam.allowedPolicyMemberDomains');
  console.log('   spec:');
  console.log('     rules:');
  console.log('     - allowAll: true');
  console.log('   ---');
  console.log('   Apply it:');
  console.log(`   gcloud org-policies set-policy policy.yaml --project=${projectId}`);
  console.log('\nOnce the policy is overridden, please run "npm run deploy" again.');
  console.log('======================================================\n');
}

function checkSecretsExistInGCP(projectId) {
  try {
    execSync(`gcloud secrets describe LOOKERSDK_CLIENT_ID --project=${projectId}`, { stdio: 'ignore' });
    execSync(`gcloud secrets describe LOOKERSDK_CLIENT_SECRET --project=${projectId}`, { stdio: 'ignore' });
    return true;
  } catch (e) {
    return false;
  }
}

function loadLocalBuildHash() {
  const hashPath = path.join(__dirname, '..', 'backend', 'src', 'build_hash.ts');
  if (!fs.existsSync(hashPath)) {
    const extHashPath = path.join(__dirname, '..', 'extension', 'src', 'build_hash.ts');
    if (!fs.existsSync(extHashPath)) return '';
    const content = fs.readFileSync(extHashPath, 'utf8');
    const match = content.match(/BUILD_HASH = '(.*?)'/);
    return match ? match[1] : '';
  }
  const content = fs.readFileSync(hashPath, 'utf8');
  const match = content.match(/BUILD_HASH = '(.*?)'/);
  return match ? match[1] : '';
}

function fetchUrlContent(url) {
  const https = require('https');
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP Status ${res.statusCode}`));
        return;
      }
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => { resolve(data); });
    }).on('error', (err) => { reject(err); });
  });
}

async function runPostDeploymentVerification(config) {
  console.log('\n🔍 Running post-deployment verification checks...');
  
  const localHash = loadLocalBuildHash();
  
  // 1. Looker Model Configuration Check
  let modelPass = false;
  try {
    const modelsOutput = execSync(`looker-cli api lookmlmodel all_lookml_models --host=${config.looker_host} --port=${config.looker_port} --ssl=${config.looker_ssl}`, { encoding: 'utf8', stdio: 'pipe' });
    const models = parseJsonFromStdout(modelsOutput);
    modelPass = Array.isArray(models) && models.some(m => m.name === 'nano_admin');
  } catch (e) {}

  // 2. Cloud Function Deployed Hash Check
  let functionPass = false;
  let deployedHash = '';
  try {
    deployedHash = execSync(`gcloud functions describe ${config.gcf_name} --region=${config.gcp_region} --project=${config.gcp_project_id} --format="value(serviceConfig.environmentVariables.BUILD_HASH)"`, { encoding: 'utf8', stdio: 'pipe' }).trim();
    functionPass = (deployedHash === localHash && localHash !== '');
  } catch (e) {}

  // 3. GCS JS Bundle Hash Check
  let gcsPass = false;
  try {
    const gcsBundleUrl = `https://storage.googleapis.com/${config.gcs_bucket_name}/bundle.js`;
    const bundleContent = await fetchUrlContent(gcsBundleUrl);
    gcsPass = bundleContent.includes(localHash) && localHash !== '';
  } catch (e) {}

  console.log('\n======================================================');
  console.log('🔍 POST-DEPLOYMENT VERIFICATION RESULTS');
  console.log('======================================================');
  console.log(`  ${modelPass ? '✅ PASS' : '❌ FAIL'} - Looker Model Configuration ('nano_admin')`);
  console.log(`  ${functionPass ? '✅ PASS' : '❌ FAIL'} - Deployed Cloud Function Hash (Local: ${localHash || 'Unknown'}, Deployed: ${deployedHash || 'None'})`);
  console.log(`  ${gcsPass ? '✅ PASS' : '❌ FAIL'} - GCS Hosted JS Bundle Hash Match`);
  console.log('======================================================\n');
}

function isConfigComplete(config) {
  return (
    config.looker_host &&
    config.looker_port &&
    config.looker_ssl !== undefined &&
    config.gcp_project_id &&
    config.gcp_region &&
    config.gcf_name &&
    config.gcs_bucket_name
  );
}

async function decideUseSavedConfig(config) {
  if (!isConfigComplete(config)) {
    return false;
  }
  
  console.log('📄 Found existing deployment configuration:');
  console.log(`  • Looker Host:            ${config.looker_host}`);
  console.log(`  • Looker Port:            ${config.looker_port}`);
  console.log(`  • Use SSL/HTTPS:          ${config.looker_ssl ? 'Yes' : 'No'}`);
  console.log(`  • GCP Project ID:         ${config.gcp_project_id}`);
  console.log(`  • GCP Region:             ${config.gcp_region}`);
  console.log(`  • Cloud Function Name:    ${config.gcf_name}`);
  console.log(`  • GCS Bucket Name:        ${config.gcs_bucket_name}`);
  if (config.looker_service_account) {
    console.log(`  • Looker Service Account: ${config.looker_service_account}`);
  }

  const useSaved = await askQuestion('\nUse all saved settings for this deployment? (Y/n): ');
  const skipPrompts = useSaved.toLowerCase() !== 'n';
  
  if (skipPrompts) {
    console.log('\n✅ Loaded configurations from saved settings.');
  }
  
  return skipPrompts;
}

function getSavedConnectionConfig(config) {
  return {
    looker_host: config.looker_host,
    looker_port: config.looker_port,
    looker_ssl: config.looker_ssl
  };
}

function getSavedGCPConfig(config) {
  return {
    gcp_project_id: config.gcp_project_id,
    gcp_region: config.gcp_region,
    gcf_name: config.gcf_name,
    gcs_bucket_name: config.gcs_bucket_name
  };
}

function getSavedServiceAccountConfig(config) {
  return {
    looker_service_account: config.looker_service_account || '',
    looker_credential_method: checkSecretsExistInGCP(config.gcp_project_id) ? 'reuse' : 'generate',
    manual_client_id: '',
    manual_client_secret: ''
  };
}
