const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { askQuestion } = require('./ui');

function loadEnvFile() {
  const rootDir = path.join(__dirname, '..', '..');
  const envFiles = [path.join(rootDir, '.env'), path.join(rootDir, '.env.local')];

  for (const envPath of envFiles) {
    if (fs.existsSync(envPath)) {
      try {
        const content = fs.readFileSync(envPath, 'utf8');
        content.split('\n').forEach(line => {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('#')) {
            const eqIdx = trimmed.indexOf('=');
            if (eqIdx > 0) {
              const key = trimmed.slice(0, eqIdx).trim();
              let val = trimmed.slice(eqIdx + 1).trim();
              if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                val = val.slice(1, -1);
              }
              if (!process.env[key]) {
                process.env[key] = val;
              }
            }
          }
        });
      } catch (e) {}
    }
  }
}

function loadConfig(configPath) {
  loadEnvFile();
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

function getSavedServiceAccountConfig(config, checkSecretsFn) {
  return {
    looker_service_account: config.looker_service_account || '',
    looker_credential_method: checkSecretsFn && checkSecretsFn(config.gcp_project_id) ? 'reuse' : 'generate',
    manual_client_id: '',
    manual_client_secret: ''
  };
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

async function promptLookerServiceAccount(connectionConfig, gcpConfig, config, checkSecretsFn) {
  const secretsExist = checkSecretsFn && checkSecretsFn(gcpConfig.gcp_project_id);

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

module.exports = {
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
};
