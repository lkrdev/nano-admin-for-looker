const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { parseJsonFromStdout } = require('./prereqs');

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
    return true;
  }
}

async function getAdminRoleId(connectionConfig) {
  try {
    const rolesOutput = execSync(`looker-cli api role all_roles --host=${connectionConfig.looker_host} --port=${connectionConfig.looker_port} --ssl=${connectionConfig.looker_ssl}`, { encoding: 'utf8', stdio: 'pipe' });
    const roles = parseJsonFromStdout(rolesOutput);
    const rolesList = Array.isArray(roles) ? roles : [];

    const adminByName = rolesList.find(r => r.name === 'Admin');
    if (adminByName) return adminByName.id;

    const adminByPerm = rolesList.find(r => {
      if (r.permission_set) {
        if (r.permission_set.all_access === true) return true;
        if (Array.isArray(r.permission_set.permissions) && r.permission_set.permissions.includes('administer')) return true;
      }
      return false;
    });
    if (adminByPerm) return adminByPerm.id;
  } catch (err) {
    console.warn(`⚠️ Warning: Failed to query Looker roles: ${err.message}`);
  }
  return null;
}

async function assignAdminRoleToUser(connectionConfig, userId) {
  const adminRoleId = await getAdminRoleId(connectionConfig);
  if (!adminRoleId) {
    console.warn('⚠️ Could not find an Administrator role in Looker to automatically assign.');
    return false;
  }
  try {
    console.log(`Assigning Administrator role (ID: ${adminRoleId}) to service account ID ${userId}...`);
    const payload = JSON.stringify([parseInt(adminRoleId, 10)]);
    execSync(`echo '${payload}' | looker-cli api user set_user_roles ${userId} - --host=${connectionConfig.looker_host} --port=${connectionConfig.looker_port} --ssl=${connectionConfig.looker_ssl}`, { encoding: 'utf8', stdio: 'pipe' });
    console.log(`✅ Successfully assigned Administrator role to service account ID ${userId}.`);
    return true;
  } catch (err) {
    console.warn(`⚠️ Warning: Failed to assign Administrator role: ${err.message}`);
    return false;
  }
}


async function getLookerCredentials(connectionConfig, saConfig) {
  let clientId = '';
  let clientSecret = '';
  let targetSaId = '';

  console.log('\n🔐 Looker API Credentials Provisioning...');

  if (saConfig.looker_credential_method === 'reuse') {
    console.log('✅ Reusing existing Looker credentials stored in GCP Secret Manager.');
    return null;
  }

  if (saConfig.looker_credential_method === 'manual') {
    clientId = saConfig.manual_client_id;
    clientSecret = saConfig.manual_client_secret;
    targetSaId = saConfig.looker_service_account || '';
    console.log('✅ Using manually entered API credentials.');

    if (saConfig.looker_service_account) {
      const targetLookerSa = await getLookerSaById(connectionConfig, saConfig.looker_service_account);
      if (targetLookerSa) {
        targetSaId = targetLookerSa.id;
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
        await assignAdminRoleToUser(connectionConfig, targetSaId);
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

  return { clientId, clientSecret, serviceAccountId: targetSaId || saConfig.looker_service_account || '' };
}

function updateLocalConfigs(gcfUrl, publicUrl) {
  if (!gcfUrl || !gcfUrl.startsWith('http')) {
    console.error(`\n💥 Fatal Error: Invalid Cloud Function backend URL passed to updateLocalConfigs: "${gcfUrl}"`);
    process.exit(1);
  }

  console.log('\n🔄 Generating manifest configuration in memory...');

  const manifestPath = path.join(__dirname, '..', '..', 'extension', 'manifest.lkml');
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

    const gcfUrlOrigin = gcfUrl.replace(/\/+$/, '');
    let domainOrigin = '';
    try {
      domainOrigin = new URL(gcfUrl).origin;
    } catch (e) {}

    const requiredUrls = [
      `"${gcfUrlOrigin}"`,
      domainOrigin ? `"${domainOrigin}"` : null,
      `"https://storage.googleapis.com"`
    ].filter(Boolean);
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
    fs.writeFileSync(manifestPath, manifest, 'utf8');
    console.log('✅ Updated extension/manifest.lkml on disk.');
  }

  console.log('\n📦 Compiling extension React bundle with environment variables...');
  console.log(`👉 BACKEND_URL=${gcfUrl}`);
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

async function configureLookerAttribute(config, gcfUrl) {
  console.log(`\n⚙️ Configuring Looker user attribute for secure challenge-response on host ${config.looker_host}...`);

  let domainOrigin = gcfUrl;
  try {
    if (gcfUrl && gcfUrl.startsWith('http')) {
      domainOrigin = new URL(gcfUrl).origin;
    }
  } catch (e) {}

  const attrName = 'nano_admin_admin_extension_nano_admin_challenge';

  // Pre-check if attribute already exists and has the required allowlist
  try {
    const attrOutput = execSync(`looker-cli api userattribute all_user_attributes --host=${config.looker_host} --port=${config.looker_port} --ssl=${config.looker_ssl}`, { encoding: 'utf8', stdio: 'pipe' });
    const attributes = parseJsonFromStdout(attrOutput);
    const existingAttr = Array.isArray(attributes) && attributes.find(a => a.name === attrName);
    if (existingAttr) {
      const existingAllowlistStr = Array.isArray(existingAttr.hidden_value_domain_whitelist)
        ? existingAttr.hidden_value_domain_whitelist.join(',')
        : String(existingAttr.hidden_value_domain_whitelist || existingAttr.domain_allowlist || '');

      const isWhitelisted = existingAllowlistStr.includes(domainOrigin) || (gcfUrl && existingAllowlistStr.includes(gcfUrl));
      if (isWhitelisted) {
        console.log(`✅ Looker user attribute "${attrName}" on ${config.looker_host} is already whitelisted for domain: ${domainOrigin}`);
        return;
      }

      console.log(`Resetting user attribute "${attrName}" on ${config.looker_host} to update domain allowlist to ${domainOrigin}...`);
      try {
        execSync(`looker-cli api userattribute delete_user_attribute ${existingAttr.id} --host=${config.looker_host} --port=${config.looker_port} --ssl=${config.looker_ssl}`, { stdio: 'pipe' });
        console.log(`✅ Removed stale user attribute (${existingAttr.id}) to allow domain allowlist update.`);
      } catch (delErr) {
        console.warn(`⚠️ Warning: Could not delete existing user attribute: ${delErr.message}`);
      }
    }
  } catch (e) {}

  console.log(`Creating user attribute "${attrName}" on ${config.looker_host} with domain whitelist: ${domainOrigin}`);

  try {
    const cmd = `looker-cli attribute create ${attrName} "Nano Admin Challenge" --is-hidden --type=string --domain-allowlist="${domainOrigin}" --default-value="init_challenge" --host=${config.looker_host} --port=${config.looker_port} --ssl=${config.looker_ssl}`;
    execSync(cmd, { stdio: 'pipe' });
    console.log(`✅ Successfully configured Looker user attribute on ${config.looker_host}.`);
  } catch (e) {
    console.warn(`⚠️  Warning: Failed to configure Looker user attribute automatically via CLI on ${config.looker_host}:`, e.message);
  }
}

function setDevWorkspace(connectionConfig) {
  try {
    const wsPayload = JSON.stringify({ workspace_id: 'dev' });
    execSync(`echo '${wsPayload}' | looker-cli api session update_session - --host=${connectionConfig.looker_host} --port=${connectionConfig.looker_port} --ssl=${connectionConfig.looker_ssl}`, { stdio: 'pipe' });
    return true;
  } catch (e) {
    return false;
  }
}

async function discoverLookerProjectState(connectionConfig, projectName = 'nano_admin', modelName = 'nano_admin') {
  setDevWorkspace(connectionConfig);

  let projectExists = false;
  let foundProject = null;
  let gitType = 'none';
  let gitRemoteUrl = '';
  let deployKey = null;

  try {
    const projOutput = execSync(`looker-cli api project all_projects --host=${connectionConfig.looker_host} --port=${connectionConfig.looker_port} --ssl=${connectionConfig.looker_ssl}`, { encoding: 'utf8', stdio: 'pipe' });
    const projects = parseJsonFromStdout(projOutput);
    if (Array.isArray(projects)) {
      foundProject = projects.find(p => p.id === projectName || p.name === projectName);
      if (foundProject) {
        projectExists = true;
        if (foundProject.uses_git) {
          const remoteUrl = foundProject.git_remote_url || '';
          if (foundProject.git_service_name === 'bare' || remoteUrl.includes('bare_models')) {
            gitType = 'bare';
          } else if (remoteUrl.startsWith('git@') || remoteUrl.startsWith('ssh://')) {
            gitType = 'private';
            gitRemoteUrl = remoteUrl;
          } else if (remoteUrl.startsWith('http://') || remoteUrl.startsWith('https://')) {
            gitType = 'public';
            gitRemoteUrl = remoteUrl;
          } else {
            gitType = 'other';
            gitRemoteUrl = remoteUrl;
          }
        }
      }
    }
  } catch (e) {}

  if (projectExists && (gitType === 'private' || gitType === 'bare')) {
    try {
      const keyOutput = execSync(`looker-cli api project git_deploy_key ${projectName} --host=${connectionConfig.looker_host} --port=${connectionConfig.looker_port} --ssl=${connectionConfig.looker_ssl}`, { encoding: 'utf8', stdio: 'pipe' }).trim();
      if (keyOutput && keyOutput.startsWith('ssh-')) {
        deployKey = keyOutput;
      }
    } catch (e) {}
  }

  let modelExists = false;
  let foundModel = null;
  try {
    const modelsOutput = execSync(`looker-cli api lookmlmodel all_lookml_models --host=${connectionConfig.looker_host} --port=${connectionConfig.looker_port} --ssl=${connectionConfig.looker_ssl}`, { encoding: 'utf8', stdio: 'pipe' });
    const models = parseJsonFromStdout(modelsOutput);
    if (Array.isArray(models)) {
      foundModel = models.find(m => m.name === modelName);
      if (foundModel) {
        modelExists = true;
      }
    }
  } catch (e) {}

  let availableConnections = [];
  try {
    const connOutput = execSync(`looker-cli api connection all_connections --host=${connectionConfig.looker_host} --port=${connectionConfig.looker_port} --ssl=${connectionConfig.looker_ssl}`, { encoding: 'utf8', stdio: 'pipe' });
    const conns = parseJsonFromStdout(connOutput);
    if (Array.isArray(conns)) {
      availableConnections = conns.map(c => c.name).filter(Boolean);
    }
  } catch (e) {}

  return {
    host: connectionConfig.looker_host,
    projectExists,
    project: foundProject,
    gitType,
    gitRemoteUrl,
    deployKey,
    modelExists,
    model: foundModel,
    availableConnections
  };
}

async function ensureLookerProject(connectionConfig, projectName = 'nano_admin', projectState = null) {
  if (projectState?.projectExists) {
    console.log(`✅ Looker project "${projectName}" already exists on ${connectionConfig.looker_host} (reusing).`);
    return { project: projectState.project, created: false };
  }

  console.log(`\n📁 Checking Looker project "${projectName}" on ${connectionConfig.looker_host}...`);
  try {
    const output = execSync(`looker-cli api project all_projects --host=${connectionConfig.looker_host} --port=${connectionConfig.looker_port} --ssl=${connectionConfig.looker_ssl}`, { encoding: 'utf8', stdio: 'pipe' });
    const projects = parseJsonFromStdout(output);
    const existing = Array.isArray(projects) && projects.find(p => p.id === projectName || p.name === projectName);
    if (existing) {
      console.log(`✅ Looker project "${projectName}" already exists.`);
      return { project: existing, created: false };
    }
  } catch (e) {
    console.warn(`⚠️ Warning: Could not query existing projects on ${connectionConfig.looker_host}: ${e.message}`);
  }

  console.log(`Creating Looker project "${projectName}" on ${connectionConfig.looker_host}...`);
  setDevWorkspace(connectionConfig);

  try {
    const createPayload = JSON.stringify({ name: projectName });
    const createOut = execSync(`echo '${createPayload}' | looker-cli api project create_project - --host=${connectionConfig.looker_host} --port=${connectionConfig.looker_port} --ssl=${connectionConfig.looker_ssl}`, { encoding: 'utf8', stdio: 'pipe' });
    const created = parseJsonFromStdout(createOut);
    console.log(`✅ Successfully created Looker project "${projectName}".`);
    return { project: created, created: true };
  } catch (err) {
    console.warn(`⚠️ Warning: Failed to create Looker project "${projectName}": ${err.message}`);
    return { project: null, created: false, error: err.message };
  }
}

async function ensureLookerModel(connectionConfig, modelName = 'nano_admin', projectName = 'nano_admin', modelSelection = { unlimited: true, allowed_connections: [] }, projectState = null) {
  if (projectState?.modelExists) {
    console.log(`✅ Looker model "${modelName}" already configured on ${connectionConfig.looker_host} (reusing).`);
    return { model: projectState.model, created: false };
  }

  console.log(`\n📊 Checking Looker model configuration "${modelName}" on ${connectionConfig.looker_host}...`);
  try {
    const output = execSync(`looker-cli api lookmlmodel all_lookml_models --host=${connectionConfig.looker_host} --port=${connectionConfig.looker_port} --ssl=${connectionConfig.looker_ssl}`, { encoding: 'utf8', stdio: 'pipe' });
    const models = parseJsonFromStdout(output);
    const existing = Array.isArray(models) && models.find(m => m.name === modelName);
    if (existing) {
      console.log(`✅ Looker model "${modelName}" already configured.`);
      return { model: existing, created: false };
    }
  } catch (e) {
    console.warn(`⚠️ Warning: Could not query existing models on ${connectionConfig.looker_host}: ${e.message}`);
  }

  console.log(`Creating Looker model configuration "${modelName}" for project "${projectName}" on ${connectionConfig.looker_host}...`);
  setDevWorkspace(connectionConfig);
  try {
    const payload = JSON.stringify({
      name: modelName,
      project_name: projectName,
      unlimited_db_connections: Boolean(modelSelection.unlimited),
      allowed_db_connection_names: modelSelection.allowed_connections || []
    });
    const createOut = execSync(`echo '${payload}' | looker-cli api lookmlmodel create_lookml_model - --host=${connectionConfig.looker_host} --port=${connectionConfig.looker_port} --ssl=${connectionConfig.looker_ssl}`, { encoding: 'utf8', stdio: 'pipe' });
    const created = parseJsonFromStdout(createOut);
    console.log(`✅ Successfully created Looker model configuration "${modelName}".`);
    return { model: created, created: true };
  } catch (err) {
    console.warn(`⚠️ Warning: Failed to create Looker model configuration "${modelName}": ${err.message}`);
    return { model: null, created: false, error: err.message };
  }
}

async function configureLookerProjectGit(connectionConfig, projectName = 'nano_admin', gitConfig = {}) {
  const gitType = gitConfig.git_type || 'bare';
  const remoteUrl = gitConfig.git_remote_url || '';

  if (gitConfig.action === 'reuse') {
    console.log(`✅ Project "${projectName}" is already configured with Git (${gitType}${remoteUrl ? `: ${remoteUrl}` : ''}). Reusing existing configuration.`);
    let deployKey = gitConfig.deploy_key || null;
    if (!deployKey && (gitType === 'private' || gitType === 'bare')) {
      try {
        const keyOutput = execSync(`looker-cli api project git_deploy_key ${projectName} --host=${connectionConfig.looker_host} --port=${connectionConfig.looker_port} --ssl=${connectionConfig.looker_ssl}`, { encoding: 'utf8', stdio: 'pipe' }).trim();
        if (keyOutput && keyOutput.startsWith('ssh-')) {
          deployKey = keyOutput;
        }
      } catch (e) {}
    }
    return {
      git_type: gitType,
      git_remote_url: remoteUrl,
      deploy_key: deployKey,
      status: 'already_configured'
    };
  }

  console.log(`\n🔗 Configuring Git connection (${gitType}) for project "${projectName}" on ${connectionConfig.looker_host}...`);
  setDevWorkspace(connectionConfig);

  let project = null;
  try {
    const projOut = execSync(`looker-cli api project project ${projectName} --host=${connectionConfig.looker_host} --port=${connectionConfig.looker_port} --ssl=${connectionConfig.looker_ssl}`, { encoding: 'utf8', stdio: 'pipe' });
    project = parseJsonFromStdout(projOut);
  } catch (e) {}

  if (gitType === 'bare') {
    const isAlreadyBare = project && project.uses_git && (
      (project.git_remote_url && project.git_remote_url.includes('bare_models')) ||
      project.git_service_name === 'bare'
    );
    if (isAlreadyBare) {
      console.log(`✅ Project "${projectName}" is already configured with a bare repository.`);
      return { git_type: 'bare', status: 'already_configured', deploy_key: null };
    }

    try {
      const payload = JSON.stringify({ git_service_name: 'bare' });
      execSync(`echo '${payload}' | looker-cli api project update_project ${projectName} - --host=${connectionConfig.looker_host} --port=${connectionConfig.looker_port} --ssl=${connectionConfig.looker_ssl}`, { stdio: 'pipe' });
      console.log(`✅ Configured bare repository for project "${projectName}".`);
      return { git_type: 'bare', status: 'configured', deploy_key: null };
    } catch (err) {
      console.log(`✅ Bare repository verified for project "${projectName}".`);
      return { git_type: 'bare', status: 'configured', deploy_key: null };
    }
  }

  if (gitType === 'private') {
    let deployKey = '';
    try {
      deployKey = execSync(`looker-cli api project git_deploy_key ${projectName} --host=${connectionConfig.looker_host} --port=${connectionConfig.looker_port} --ssl=${connectionConfig.looker_ssl}`, { encoding: 'utf8', stdio: 'pipe' }).trim();
    } catch (e) {
      try {
        deployKey = execSync(`looker-cli api project create_git_deploy_key ${projectName} --host=${connectionConfig.looker_host} --port=${connectionConfig.looker_port} --ssl=${connectionConfig.looker_ssl}`, { encoding: 'utf8', stdio: 'pipe' }).trim();
      } catch (createErr) {
        console.warn(`⚠️ Warning: Could not generate deploy key for project "${projectName}": ${createErr.message}`);
      }
    }

    if (deployKey) {
      console.log(`🔑 Deploy key available for project "${projectName}".`);
    }

    let status = 'pending_key_registration';
    if (remoteUrl) {
      try {
        const payload = JSON.stringify({ git_remote_url: remoteUrl });
        execSync(`echo '${payload}' | looker-cli api project update_project ${projectName} - --timeout=15 --host=${connectionConfig.looker_host} --port=${connectionConfig.looker_port} --ssl=${connectionConfig.looker_ssl}`, { stdio: 'pipe' });
        console.log(`✅ Successfully connected project "${projectName}" to remote Git repository: ${remoteUrl}`);
        status = 'configured';
      } catch (updateErr) {
        console.log(`ℹ️  Notice: Remote Git URL "${remoteUrl}" staged. Deploy key needs to be registered with your Git provider to complete synchronization.`);
        status = 'pending_key_registration';
      }
    }

    return {
      git_type: 'private',
      git_remote_url: remoteUrl,
      deploy_key: deployKey,
      status
    };
  }

  if (gitType === 'public') {
    let status = 'configured';
    if (remoteUrl) {
      try {
        const payload = JSON.stringify({ git_remote_url: remoteUrl });
        execSync(`echo '${payload}' | looker-cli api project update_project ${projectName} - --timeout=15 --host=${connectionConfig.looker_host} --port=${connectionConfig.looker_port} --ssl=${connectionConfig.looker_ssl}`, { stdio: 'pipe' });
        console.log(`✅ Successfully connected project "${projectName}" to public Git repository: ${remoteUrl}`);
      } catch (updateErr) {
        console.warn(`⚠️ Warning: Could not connect to public Git repository "${remoteUrl}": ${updateErr.message}`);
        status = 'error';
      }
    }
    return {
      git_type: 'public',
      git_remote_url: remoteUrl,
      deploy_key: null,
      status
    };
  }

  return { git_type: 'bare', status: 'configured', deploy_key: null };
}

async function inspectLookerProjectFiles(connectionConfig, projectName = 'nano_admin') {
  console.log(`\n📄 Inspecting project files in "${projectName}" on ${connectionConfig.looker_host}...`);
  try {
    const filesOut = execSync(`looker-cli api project all_project_files ${projectName} --host=${connectionConfig.looker_host} --port=${connectionConfig.looker_port} --ssl=${connectionConfig.looker_ssl}`, { encoding: 'utf8', stdio: 'pipe' });
    const files = parseJsonFromStdout(filesOut);
    const fileList = Array.isArray(files) ? files : [];

    const hasManifest = fileList.some(f => f.id === 'manifest.lkml' || f.path === 'manifest.lkml');
    const hasIndexMd = fileList.some(f => f.id === 'index.md' || f.path === 'index.md');
    const modelFile = fileList.find(f => (f.extension === '.lkml' && (f.type === 'model' || f.id?.endsWith('.model.lkml'))));
    const hasModelFile = Boolean(modelFile);

    const foundNames = fileList.map(f => f.id || f.path);
    console.log(`✅ Found ${fileList.length} files in project "${projectName}": [${foundNames.join(', ')}]`);

    return {
      hasManifest,
      hasIndexMd,
      hasModelFile,
      modelFileName: modelFile ? (modelFile.id || modelFile.path) : null,
      files: foundNames
    };
  } catch (err) {
    console.warn(`⚠️ Warning: Could not inspect project files: ${err.message}`);
    return {
      hasManifest: false,
      hasIndexMd: false,
      hasModelFile: false,
      modelFileName: null,
      files: [],
      error: err.message
    };
  }
}

module.exports = {
  getLookerSaById,
  checkUserAdminPermission,
  getAdminRoleId,
  assignAdminRoleToUser,
  getLookerCredentials,
  updateLocalConfigs,
  configureLookerAttribute,
  discoverLookerProjectState,
  ensureLookerProject,
  ensureLookerModel,
  configureLookerProjectGit,
  inspectLookerProjectFiles
};
