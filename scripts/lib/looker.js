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
  console.log('\n⚙️ Configuring Looker user attribute for secure challenge-response...');

  let domainOrigin = '';
  try {
    domainOrigin = new URL(gcfUrl).origin;
  } catch (e) {}

  const allowlistItems = ['http://localhost:8081', 'https://localhost:8081', gcfUrl];
  if (domainOrigin && !allowlistItems.includes(domainOrigin)) {
    allowlistItems.push(domainOrigin);
  }
  const allowlist = allowlistItems.join(',');
  const attrName = 'nano_admin_admin_extension_nano_admin_challenge';

  console.log(`Creating/Updating user attribute "${attrName}" with domain whitelist:`);
  console.log(`👉 ${allowlist}`);

  try {
    const cmd = `looker-cli attribute create ${attrName} "Nano Admin Challenge" --is-hidden --type=string --domain-allowlist="${allowlist}" --default-value="init_challenge" --force --host=${config.looker_host} --port=${config.looker_port} --ssl=${config.looker_ssl}`;
    execSync(cmd, { stdio: 'inherit' });
    console.log('✅ Successfully configured Looker user attribute.');
  } catch (e) {
    console.error('❌ Failed to configure Looker user attribute automatically via CLI:', e.message);
    console.log('Please make sure you are logged in to Looker via looker-cli and try again, or manually configure the attribute in Looker.');
  }
}

module.exports = {
  getLookerSaById,
  checkUserAdminPermission,
  getLookerCredentials,
  updateLocalConfigs,
  configureLookerAttribute
};
