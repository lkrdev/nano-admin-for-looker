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

function getLocalGCPDefaults() {
  let defaultProject = '';
  let defaultAccount = '';
  try {
    defaultProject = execSync('gcloud config get-value project', { encoding: 'utf8', stdio: 'pipe' }).trim();
    if (defaultProject.includes('(unset)')) defaultProject = '';
  } catch (e) {}
  try {
    defaultAccount = execSync('gcloud config get-value account', { encoding: 'utf8', stdio: 'pipe' }).trim();
    if (defaultAccount.includes('(unset)')) defaultAccount = '';
  } catch (e) {}
  return { defaultProject, defaultAccount };
}

function loadConfig(configPath) {
  loadEnvFile();
  let config = {};
  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      // Normalize legacy single-instance config to multi-instance structure
      if (config.looker_host && !Array.isArray(config.instances)) {
        config.instances = [
          {
            looker_host: config.looker_host,
            looker_port: config.looker_port || '443',
            looker_ssl: config.looker_ssl !== undefined ? config.looker_ssl : true,
            auth_mode: config.auth_mode || 'server_proxy',
            looker_service_account: config.looker_service_account || '',
            looker_credential_method: config.looker_credential_method || 'generate'
          }
        ];
      }
    } catch (e) {
      console.warn('⚠️ Warning: Failed to parse deploy-config.json. Starting fresh.');
    }
  }
  if (!Array.isArray(config.instances)) {
    config.instances = [];
  }
  return config;
}

function saveConfig(configPath, config) {
  const safeInstances = (config.instances || []).map(inst => ({
    looker_host: inst.looker_host,
    looker_port: inst.looker_port || '443',
    looker_ssl: inst.looker_ssl !== undefined ? inst.looker_ssl : true,
    auth_mode: inst.auth_mode === 'oauth' ? 'oauth' : 'server_proxy',
    git_type: inst.git_type || 'bare',
    git_remote_url: inst.git_remote_url || '',
    model_unlimited_db_connections: inst.model_unlimited_db_connections !== false,
    model_allowed_db_connection_names: inst.model_allowed_db_connection_names || []
  }));

  const safeConfig = {
    gcp_project_id: config.gcp_project_id,
    gcp_region: config.gcp_region,
    gcf_name: config.gcf_name,
    gcf_ingress_settings: normalizeIngressSettings(config.gcf_ingress_settings),
    gcs_bucket_name: config.gcs_bucket_name,
    instances: safeInstances
  };

  // Backwards compatibility top-level fields for single instance
  if (safeInstances.length > 0) {
    safeConfig.looker_host = safeInstances[0].looker_host;
    safeConfig.looker_port = safeInstances[0].looker_port;
    safeConfig.looker_ssl = safeInstances[0].looker_ssl;
    safeConfig.auth_mode = safeInstances[0].auth_mode;
    safeConfig.git_type = safeInstances[0].git_type;
    safeConfig.git_remote_url = safeInstances[0].git_remote_url;
    safeConfig.model_unlimited_db_connections = safeInstances[0].model_unlimited_db_connections;
    safeConfig.model_allowed_db_connection_names = safeInstances[0].model_allowed_db_connection_names;
  }

  fs.writeFileSync(configPath, JSON.stringify(safeConfig, null, 2), 'utf8');
  console.log('✅ Configuration saved to deploy-config.json (sensitive data omitted).');
}

function isConfigComplete(config) {
  return (
    config.gcp_project_id &&
    config.gcp_region &&
    config.gcf_name &&
    config.gcs_bucket_name &&
    Array.isArray(config.instances) &&
    config.instances.length > 0 &&
    config.instances.every(i => i.looker_host && i.looker_port && i.looker_ssl !== undefined)
  );
}

async function decideUseSavedConfig(config) {
  if (!isConfigComplete(config)) {
    return false;
  }
  
  console.log('\n📄 Found existing deployment configuration:');
  console.log(`  • GCP Project ID:         ${config.gcp_project_id}`);
  console.log(`  • GCP Region:             ${config.gcp_region}`);
  console.log(`  • Cloud Function Name:    ${config.gcf_name}`);
  console.log(`  • Cloud Function Ingress: ${normalizeIngressSettings(config.gcf_ingress_settings)}`);
  console.log(`  • GCS Bucket Name:        ${config.gcs_bucket_name}`);
  console.log(`  • Target Looker Instances (${config.instances.length}):`);
  config.instances.forEach((inst, idx) => {
    const gitDesc = (inst.git_type === 'private' || inst.git_type === 'public')
      ? `${inst.git_type} (${inst.git_remote_url || 'no url'})`
      : (inst.git_type || 'bare');
    const authDesc = inst.auth_mode === 'oauth' ? 'OAuth 2.0 (PKCE)' : 'Server Proxy (Challenge)';
    console.log(`      [${idx + 1}] Host: ${inst.looker_host}:${inst.looker_port} (SSL: ${inst.looker_ssl ? 'Yes' : 'No'}) | Auth: ${authDesc} | Git: ${gitDesc}`);
  });

  const useSaved = await askQuestion('\nUse saved settings for this deployment? (Y/n): ');
  const skipPrompts = useSaved.toLowerCase() !== 'n';
  
  if (skipPrompts) {
    console.log('\n✅ Loaded configurations from saved settings.');
  }
  
  return skipPrompts;
}

function getSavedConnectionConfig(config) {
  return config.instances || [];
}

function getSavedGCPConfig(config) {
  const gcp = {
    gcp_project_id: config.gcp_project_id,
    gcp_region: config.gcp_region,
    gcf_name: config.gcf_name,
    gcf_ingress_settings: normalizeIngressSettings(config.gcf_ingress_settings),
    gcs_bucket_name: config.gcs_bucket_name
  };
  if (config.gcf_url) {
    gcp.gcf_url = config.gcf_url;
  }
  return gcp;
}

function getSavedServiceAccountConfig(config, checkSecretsFn) {
  return (config.instances || []).map(inst => ({
    looker_host: inst.looker_host,
    looker_service_account: inst.looker_service_account || '',
    looker_credential_method: inst.looker_credential_method === 'reuse' || (checkSecretsFn && checkSecretsFn(config.gcp_project_id, [inst])) ? 'reuse' : 'generate',
    manual_client_id: '',
    manual_client_secret: ''
  }));
}

function getSavedGitConfig(config) {
  return (config.instances || []).map(inst => ({
    git_type: inst.git_type || 'bare',
    git_remote_url: inst.git_remote_url || ''
  }));
}

function getLookerCliProfiles() {
  const profiles = [];
  try {
    const output = execSync('looker-cli profile ls', { encoding: 'utf8', stdio: 'pipe' });
    const lines = output.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const isDefault = trimmed.startsWith('*');
      const cleanLine = trimmed.replace(/^\*\s*/, '');
      const match = cleanLine.match(/^([^\s]+)\s+\(([^:]+)(?::(\d+))?\)/);
      if (match) {
        const name = match[1];
        const host = match[2];
        const port = match[3] || '443';
        const ssl = true;
        profiles.push({ name, host, port, ssl, isDefault });
      }
      if (profiles.length >= 10) break;
    }
  } catch (e) {}
  return profiles;
}

async function promptInstanceAuthMode(host, existingAuthMode = 'server_proxy') {
  console.log(`\n🔒 Authentication Mode for ${host}:`);
  console.log('  1 = Server Proxy (User attribute HMAC challenge)');
  console.log('  2 = OAuth 2.0 (PKCE user token flow)');

  const defaultChoice = existingAuthMode === 'oauth' ? '2' : '1';
  const choiceInput = await askQuestion(`Select authentication mode [${defaultChoice}]: `);
  const choice = (choiceInput || defaultChoice).trim();
  const authMode = (choice === '2' || choice.toLowerCase() === 'oauth')
    ? 'oauth'
    : 'server_proxy';

  console.log(`✅ Selected auth mode: ${authMode === 'oauth' ? 'OAuth 2.0 (PKCE)' : 'Server Proxy (Challenge)'}`);
  return authMode;
}

async function promptLookerConnection(existingInstance = {}) {
  console.log('\n⚙️ Configuring Looker target instance connection...');
  
  const profiles = getLookerCliProfiles();

  if (profiles.length > 0) {
    console.log('\nFound Looker profile(s) from looker-cli:');
    profiles.forEach((p, idx) => {
      console.log(`  ${idx + 1} = ${p.name} (${p.host}:${p.port})${p.isDefault ? ' [default]' : ''}`);
    });
    console.log(`  ${profiles.length + 1} = Enter a custom Looker host manually`);

    const defaultChoice = '1';
    const choiceInput = await askQuestion(`\nSelect a Looker profile or custom [${defaultChoice}]: `);
    const choiceStr = choiceInput || defaultChoice;
    const choiceNum = parseInt(choiceStr, 10);

    if (!isNaN(choiceNum) && choiceNum >= 1 && choiceNum <= profiles.length) {
      const selected = profiles[choiceNum - 1];
      console.log(`✅ Selected profile '${selected.name}' (${selected.host}:${selected.port})`);
      const authMode = await promptInstanceAuthMode(selected.host, existingInstance.auth_mode);
      return {
        looker_host: selected.host,
        looker_port: selected.port,
        looker_ssl: selected.ssl,
        auth_mode: authMode
      };
    } else if (choiceStr && !choiceStr.match(/^\d+$/)) {
      const host = choiceStr.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      const portInput = await askQuestion(`Enter Looker API Port [${existingInstance.looker_port || '443'}]: `);
      const port = portInput || existingInstance.looker_port || '443';
      const authMode = await promptInstanceAuthMode(host, existingInstance.auth_mode);
      return { looker_host: host, looker_port: port, looker_ssl: true, auth_mode: authMode };
    }
  }

  const hostInput = await askQuestion(`Enter Looker API Host [${existingInstance.looker_host || 'your-instance.looker.app'}]: `);
  const host = (hostInput || existingInstance.looker_host || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!host) {
    console.error('❌ Error: Looker Host is required.');
    process.exit(1);
  }
  
  const portInput = await askQuestion(`Enter Looker API Port [${existingInstance.looker_port || '443'}]: `);
  const port = portInput || existingInstance.looker_port || '443';
  const authMode = await promptInstanceAuthMode(host, existingInstance.auth_mode);

  return {
    looker_host: host,
    looker_port: port,
    looker_ssl: true,
    auth_mode: authMode
  };
}

async function promptGCPConfig(config, localDefaults = {}) {
  console.log('\n⚙️ Configuring GCP settings...');
  
  const defaultProj = config.gcp_project_id || localDefaults.defaultProject || '';
  const projectId = await askQuestion(`Enter GCP Project ID [${defaultProj}]: `);
  const finalProjectId = projectId || defaultProj;
  if (!finalProjectId) {
    console.error('❌ Error: GCP Project ID is required.');
    process.exit(1);
  }
  
  const regionInput = await askQuestion(`Enter GCP Region [${config.gcp_region || 'northamerica-northeast1'}]: `);
  const region = regionInput || config.gcp_region || 'northamerica-northeast1';

  const gcfNameInput = await askQuestion(`Enter Cloud Function Name [${config.gcf_name || 'nano-admin-backend'}]: `);
  const functionName = gcfNameInput || config.gcf_name || 'nano-admin-backend';

  const gcfIngressSettings = await promptGCFIngressSettings(config.gcf_ingress_settings);

  const defaultBucket = config.gcs_bucket_name || `${finalProjectId}-nano-admin-extension`;
  const bucketInput = await askQuestion(`Enter GCS Bucket Name to host extension assets [${defaultBucket}]: `);
  const bucketName = bucketInput || defaultBucket;

  const res = {
    gcp_project_id: finalProjectId,
    gcp_region: region,
    gcf_name: functionName,
    gcf_ingress_settings: gcfIngressSettings,
    gcs_bucket_name: bucketName
  };
  if (config.gcf_url) {
    res.gcf_url = config.gcf_url;
  }
  return res;
}

function normalizeIngressSettings(val) {
  const clean = String(val || '').trim().toLowerCase();
  if (clean === 'internal-and-gclb' || clean === 'allow_internal_and_gclb') return 'internal-and-gclb';
  if (clean === 'internal-only' || clean === 'allow_internal_only') return 'internal-only';
  return 'all';
}

async function promptGCFIngressSettings(existingIngress = 'all') {
  const normalizedExisting = normalizeIngressSettings(existingIngress);
  console.log('\n🌐 Cloud Function Ingress Settings:');
  console.log('  1 = all (Allow all traffic)');
  console.log('  2 = internal-and-gclb (Allow traffic only from internal VPC sources or Cloud Load Balancing)');
  console.log('  3 = internal-only (Allow traffic only from within the same project or VPC Service Controls perimeter)');

  let defaultChoice = '1';
  if (normalizedExisting === 'internal-and-gclb') defaultChoice = '2';
  else if (normalizedExisting === 'internal-only') defaultChoice = '3';

  const choiceInput = await askQuestion(`Select Cloud Function ingress setting [${defaultChoice}]: `);
  const choice = (choiceInput || defaultChoice).trim().toLowerCase();

  let selected = 'all';
  if (choice === '2' || choice === 'internal-and-gclb') {
    selected = 'internal-and-gclb';
  } else if (choice === '3' || choice === 'internal-only') {
    selected = 'internal-only';
  }
  console.log(`✅ Selected Cloud Function ingress: ${selected}`);
  return selected;
}

async function promptLookerServiceAccount(connectionConfig, gcpConfig, existingConfig = {}, checkSecretsFn) {
  const secretsExist = checkSecretsFn && checkSecretsFn(gcpConfig.gcp_project_id, [connectionConfig]);

  console.log(`\n🔎 Inspecting Looker host ${connectionConfig.looker_host} for existing service accounts...`);
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

  console.log(`\nHow should credentials be configured for Looker host ${connectionConfig.looker_host}?`);
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
  let looker_service_account = existingConfig.looker_service_account || '';
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
    looker_host: connectionConfig.looker_host,
    looker_service_account,
    looker_credential_method,
    manual_client_id,
    manual_client_secret
  };
}

async function promptModelConfig(connectionConfig, projectState = {}, defaultFromPrevious = null) {
  if (projectState.modelExists) {
    return {
      action: 'reuse',
      unlimited: projectState.model?.unlimited_db_connections !== false,
      allowed_connections: projectState.model?.allowed_db_connection_names || []
    };
  }

  console.log(`\n📊 LookML Model Configuration for "nano_admin" on ${connectionConfig.looker_host}:`);
  console.log('LookML models require a database connection setting in Looker.');

  const available = projectState.availableConnections || [];
  console.log('  1 = Unlimited database connections (access to all database connections, recommended for admin extensions)');
  for (let i = 0; i < available.length; i++) {
    console.log(`  ${i + 2} = Specific connection: "${available[i]}"`);
  }

  let defaultChoice = '1';
  if (defaultFromPrevious && !defaultFromPrevious.unlimited && defaultFromPrevious.allowed_connections?.length > 0) {
    const prevName = defaultFromPrevious.allowed_connections[0];
    const foundIdx = available.indexOf(prevName);
    if (foundIdx !== -1) {
      defaultChoice = String(foundIdx + 2);
    }
  }

  const defaultHint = defaultFromPrevious
    ? ` [default: ${defaultChoice} (${defaultFromPrevious.unlimited ? 'unlimited' : defaultFromPrevious.allowed_connections?.[0]})]`
    : ` [${defaultChoice}]`;

  const answer = await askQuestion(`Select option${defaultHint}: `);
  const choice = answer.trim() || defaultChoice;

  if (choice === '1') {
    return { action: 'create', unlimited: true, allowed_connections: [] };
  }

  const num = parseInt(choice, 10);
  if (!isNaN(num) && num >= 2 && num <= available.length + 1) {
    const selectedConn = available[num - 2];
    return { action: 'create', unlimited: false, allowed_connections: [selectedConn] };
  }

  return { action: 'create', unlimited: true, allowed_connections: [] };
}

async function promptGitConfig(connectionConfig, projectState = {}, existingSavedConfig = {}, defaultFromPrevious = null) {
  if (projectState.gitType && projectState.gitType !== 'none') {
    console.log(`\n📦 Git Repository on ${connectionConfig.looker_host}:`);
    console.log(`  Project "nano_admin" already has Git configured as [${projectState.gitType}]${projectState.gitRemoteUrl ? ` (${projectState.gitRemoteUrl})` : ''}.`);
    const keepAnswer = await askQuestion('Keep existing Git configuration? (Y/n): ');
    if (keepAnswer.trim().toLowerCase() !== 'n') {
      return {
        action: 'reuse',
        git_type: projectState.gitType,
        git_remote_url: projectState.gitRemoteUrl,
        deploy_key: projectState.deployKey || null
      };
    }
  }

  console.log(`\n📦 Git Repository Configuration for Looker project "nano_admin" on ${connectionConfig.looker_host}:`);
  console.log('  1 = Bare repository (hosted internally on Looker server)');
  console.log('  2 = Private repository (external Git via SSH, e.g. git@github.com:org/repo.git)');
  console.log('  3 = Public repository (external Git via HTTPS read-only, e.g. https://github.com/org/repo.git)');

  let defaultChoice = '1';
  let defaultUrl = '';

  if (defaultFromPrevious && defaultFromPrevious.git_type) {
    if (defaultFromPrevious.git_type === 'private') defaultChoice = '2';
    else if (defaultFromPrevious.git_type === 'public') defaultChoice = '3';
    else defaultChoice = '1';
    defaultUrl = defaultFromPrevious.git_remote_url || '';
  } else if (existingSavedConfig.git_type) {
    if (existingSavedConfig.git_type === 'private') defaultChoice = '2';
    else if (existingSavedConfig.git_type === 'public') defaultChoice = '3';
    else defaultChoice = '1';
    defaultUrl = existingSavedConfig.git_remote_url || '';
  }

  const defaultHint = defaultFromPrevious
    ? ` [default: ${defaultChoice} (${defaultFromPrevious.git_type}${defaultUrl ? ` - ${defaultUrl}` : ''})]`
    : ` [${defaultChoice}]`;

  const choiceInput = await askQuestion(`Select Git repository type${defaultHint}: `);
  const choice = choiceInput.trim() || defaultChoice;

  if (choice === '2' || choice.toLowerCase() === 'private') {
    const urlPrompt = defaultUrl ? `Enter Git SSH Remote URL [${defaultUrl}]: ` : 'Enter Git SSH Remote URL (e.g. git@github.com:org/repo.git): ';
    const urlInput = await askQuestion(urlPrompt);
    const remoteUrl = (urlInput || defaultUrl).trim();
    return {
      action: 'create',
      git_type: 'private',
      git_remote_url: remoteUrl,
      deploy_key: projectState.deployKey || null
    };
  }

  if (choice === '3' || choice.toLowerCase() === 'public') {
    const urlPrompt = defaultUrl ? `Enter Git HTTPS Remote URL [${defaultUrl}]: ` : 'Enter Git HTTPS Remote URL (e.g. https://github.com/org/repo.git): ';
    const urlInput = await askQuestion(urlPrompt);
    const remoteUrl = (urlInput || defaultUrl).trim();
    return {
      action: 'create',
      git_type: 'public',
      git_remote_url: remoteUrl,
      deploy_key: null
    };
  }

  return {
    action: 'create',
    git_type: 'bare',
    git_remote_url: '',
    deploy_key: null
  };
}

module.exports = {
  getLocalGCPDefaults,
  loadConfig,
  saveConfig,
  isConfigComplete,
  decideUseSavedConfig,
  getSavedConnectionConfig,
  getSavedGCPConfig,
  getSavedServiceAccountConfig,
  getSavedGitConfig,
  promptInstanceAuthMode,
  promptLookerConnection,
  promptGCPConfig,
  promptGCFIngressSettings,
  normalizeIngressSettings,
  promptLookerServiceAccount,
  promptModelConfig,
  promptGitConfig
};
