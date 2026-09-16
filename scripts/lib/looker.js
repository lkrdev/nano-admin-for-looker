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
    }
  } catch (e) {}

  console.log(`Creating/Updating user attribute "${attrName}" on ${config.looker_host} with domain whitelist: ${domainOrigin}`);

  try {
    const cmd = `looker-cli attribute create ${attrName} "Nano Admin Challenge" --is-hidden --type=string --domain-allowlist="${domainOrigin}" --default-value="init_challenge" --force --host=${config.looker_host} --port=${config.looker_port} --ssl=${config.looker_ssl}`;
    execSync(cmd, { stdio: 'pipe' });
    console.log(`✅ Successfully configured Looker user attribute on ${config.looker_host}.`);
  } catch (e) {
    const errText = (e.stderr ? e.stderr.toString() : '') + ' ' + (e.message || '');
    if (errText.includes('cannot increase the number of domains matched by the hidden value domain whitelist')) {
      console.warn(`⚠️  Notice: Looker host ${config.looker_host} prevented updating the domain whitelist because user challenge tokens already exist on the instance.`);
      console.warn(`    If backend connectivity works, no action is needed. If you changed backend URLs, reset the attribute in Looker Admin -> User Attributes.`);
    } else {
      console.warn(`⚠️  Warning: Failed to configure Looker user attribute automatically via CLI on ${config.looker_host}:`, e.message);
    }
  }
}

module.exports = {
  getLookerSaById,
  checkUserAdminPermission,
  getAdminRoleId,
  assignAdminRoleToUser,
  getLookerCredentials,
  updateLocalConfigs,
  configureLookerAttribute
};
