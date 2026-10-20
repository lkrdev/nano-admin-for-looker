const https = require('https');
const { execSync } = require('child_process');
const { loadLocalBuildHash } = require('./gcp');
const { parseJsonFromStdout } = require('./prereqs');

function fetchUrlContent(url) {
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

async function runPostDeploymentVerification(config, gcfUrl) {
  console.log('\n🔍 Running post-deployment verification checks...');
  
  const localHash = loadLocalBuildHash();
  const instances = Array.isArray(config.instances) && config.instances.length > 0
    ? config.instances
    : [{ looker_host: config.looker_host, looker_port: config.looker_port, looker_ssl: config.looker_ssl }];

  // 1. Global Resource Verification
  let functionPass = false;
  let deployedHash = '';
  let ingressSettings = '';
  const configuredIngress = (config.gcf_ingress_settings || 'all').toLowerCase();
  const expectedIngressEnum = configuredIngress === 'internal-and-gclb'
    ? 'ALLOW_INTERNAL_AND_GCLB'
    : configuredIngress === 'internal-only'
      ? 'ALLOW_INTERNAL_ONLY'
      : 'ALLOW_ALL';
  try {
    deployedHash = execSync(`gcloud functions describe ${config.gcf_name} --region=${config.gcp_region} --project=${config.gcp_project_id} --format="value(serviceConfig.environmentVariables.BUILD_HASH)"`, { encoding: 'utf8', stdio: 'pipe' }).trim();
    ingressSettings = execSync(`gcloud functions describe ${config.gcf_name} --region=${config.gcp_region} --project=${config.gcp_project_id} --format="value(serviceConfig.ingressSettings)"`, { encoding: 'utf8', stdio: 'pipe' }).trim();
    functionPass = (deployedHash === localHash && localHash !== '' && (!ingressSettings || ingressSettings === expectedIngressEnum));
  } catch (e) {}

  let gcsPass = false;
  try {
    const gcsBundleUrl = `https://storage.googleapis.com/${config.gcs_bucket_name}/bundle.js`;
    const bundleContent = await fetchUrlContent(gcsBundleUrl);
    gcsPass = bundleContent.includes(localHash) && localHash !== '';
  } catch (e) {}

  // 2. Per-Instance Verification
  const instanceResults = [];
  let allProjectsPass = true;
  let allModelsPass = true;
  let allAttrsPass = true;
  let allManifestsPass = true;
  let allIndexPass = true;
  let allModelFilesPass = true;

  for (const inst of instances) {
    let projectPass = false;
    try {
      const projOutput = execSync(`looker-cli api project project nano_admin --host=${inst.looker_host} --port=${inst.looker_port} --ssl=${inst.looker_ssl}`, { encoding: 'utf8', stdio: 'pipe' });
      const proj = parseJsonFromStdout(projOutput);
      projectPass = Boolean(proj && (proj.id === 'nano_admin' || proj.name === 'nano_admin'));
    } catch (e) {}
    if (!projectPass) allProjectsPass = false;

    let modelPass = false;
    try {
      const modelsOutput = execSync(`looker-cli api lookmlmodel all_lookml_models --host=${inst.looker_host} --port=${inst.looker_port} --ssl=${inst.looker_ssl}`, { encoding: 'utf8', stdio: 'pipe' });
      const models = parseJsonFromStdout(modelsOutput);
      modelPass = Array.isArray(models) && models.some(m => m.name === 'nano_admin' || m.project_name === 'nano_admin');
    } catch (e) {}
    if (!modelPass) allModelsPass = false;

    let indexPass = false;
    let modelFilePass = false;
    let modelFileName = '';
    try {
      const filesOutput = execSync(`looker-cli api project all_project_files nano_admin --host=${inst.looker_host} --port=${inst.looker_port} --ssl=${inst.looker_ssl}`, { encoding: 'utf8', stdio: 'pipe' });
      const files = parseJsonFromStdout(filesOutput);
      if (Array.isArray(files)) {
        indexPass = files.some(f => f.id === 'index.md' || f.path === 'index.md');
        const mFile = files.find(f => f.extension === '.lkml' && (f.type === 'model' || f.id?.endsWith('.model.lkml')));
        if (mFile) {
          modelFilePass = true;
          modelFileName = mFile.id || mFile.path;
        }
      }
    } catch (e) {}
    if (!indexPass) allIndexPass = false;
    if (!modelFilePass) allModelFilesPass = false;

    let attrPass = false;
    let attrDetails = '';
    const isOAuthMode = inst.auth_mode === 'oauth';
    if (isOAuthMode) {
      const hostPort = (inst.looker_port && String(inst.looker_port) !== '443')
        ? `${inst.looker_host}:${inst.looker_port}`
        : inst.looker_host;
      const expectedRedirectUri = `https://${hostPort}/extensions/oauth2_redirect`;
      try {
        const oauthOutput = execSync(`looker-cli api auth oauth_client_app nano_admin_oauth_client --host=${inst.looker_host} --port=${inst.looker_port} --ssl=${inst.looker_ssl}`, { encoding: 'utf8', stdio: 'pipe' });
        const oauthApp = parseJsonFromStdout(oauthOutput);
        if (oauthApp && oauthApp.client_guid === 'nano_admin_oauth_client') {
          if (oauthApp.enabled && oauthApp.redirect_uri === expectedRedirectUri) {
            attrPass = true;
          } else {
            attrDetails = `(OAuth client enabled=${oauthApp.enabled}, redirect_uri=${oauthApp.redirect_uri}, expected=${expectedRedirectUri})`;
          }
        } else {
          attrDetails = `(OAuth client 'nano_admin_oauth_client' not found)`;
        }
      } catch (e) {
        attrDetails = `(${e.message})`;
      }
    } else {
      try {
        const attrOutput = execSync(`looker-cli api userattribute all_user_attributes --host=${inst.looker_host} --port=${inst.looker_port} --ssl=${inst.looker_ssl}`, { encoding: 'utf8', stdio: 'pipe' });
        const attributes = parseJsonFromStdout(attrOutput);
        const attr = Array.isArray(attributes) && attributes.find(a => a.name === 'nano_admin_admin_extension_nano_admin_challenge');
        if (attr) {
          const allowlistStr = Array.isArray(attr.hidden_value_domain_whitelist)
            ? attr.hidden_value_domain_whitelist.join(',')
            : String(attr.hidden_value_domain_whitelist || attr.domain_allowlist || '');
          let domainOrigin = gcfUrl;
          try {
            if (gcfUrl && gcfUrl.startsWith('http')) {
              domainOrigin = new URL(gcfUrl).origin;
            }
          } catch (e) {}

          if (!gcfUrl || allowlistStr.includes(domainOrigin) || allowlistStr.includes(gcfUrl)) {
            attrPass = true;
          } else {
            attrDetails = `(Missing ${domainOrigin} in domain allowlist: [${allowlistStr}])`;
          }
        } else {
          attrDetails = `(User attribute 'nano_admin_admin_extension_nano_admin_challenge' not found)`;
        }
      } catch (e) {
        attrDetails = `(${e.message})`;
      }
    }
    if (!attrPass) allAttrsPass = false;

    let manifestPass = false;
    let manifestDetails = '';
    try {
      const gcsBundleUrl = `https://storage.googleapis.com/${config.gcs_bucket_name}/bundle.js`;
      const prodManifestContent = execSync(`looker-cli project file cat nano_admin manifest.lkml --host=${inst.looker_host} --port=${inst.looker_port} --ssl=${inst.looker_ssl}`, { encoding: 'utf8', stdio: 'pipe' }).trim();
      if (prodManifestContent) {
        const gcfUrlOrigin = gcfUrl ? gcfUrl.replace(/\/+$/, '') : '';
        const hasGcf = !gcfUrl || prodManifestContent.includes(gcfUrl);
        const hasGcs = prodManifestContent.includes(gcsBundleUrl);
        const hasOAuthUrls = !isOAuthMode || !gcfUrlOrigin || (
          prodManifestContent.includes('oauth2_urls') &&
          prodManifestContent.includes(`${gcfUrlOrigin}/oauth/authorize`) &&
          prodManifestContent.includes(`${gcfUrlOrigin}/oauth/token`)
        );
        if (hasGcf && hasGcs && hasOAuthUrls) {
          manifestPass = true;
        } else {
          manifestDetails = `(Manifest missing URLs: gcfUrl=${hasGcf}, bundleUrl=${hasGcs}, oauth2Urls=${hasOAuthUrls})`;
        }
      } else {
        manifestDetails = `(Could not read manifest.lkml from Looker project)`;
      }
    } catch (e) {
      manifestDetails = `(${e.message})`;
    }
    if (!manifestPass) allManifestsPass = false;

    instanceResults.push({
      host: inst.looker_host,
      authMode: isOAuthMode ? 'oauth' : 'server_proxy',
      projectPass,
      modelPass,
      attrPass,
      attrDetails,
      manifestPass,
      manifestDetails,
      indexPass,
      modelFilePass,
      modelFileName
    });
  }

  console.log('\n======================================================');
  console.log('🔍 POST-DEPLOYMENT VERIFICATION RESULTS');
  console.log('======================================================');
  console.log('Global Backend & Static Assets:');
  console.log(`  ${functionPass ? '✅ PASS' : '❌ FAIL'} - Deployed Cloud Function Hash & Ingress (Local: ${localHash || 'Unknown'}, Deployed: ${deployedHash || 'None'}, Ingress: ${ingressSettings || 'Unknown'})`);
  console.log(`  ${gcsPass ? '✅ PASS' : '❌ FAIL'} - GCS Hosted JS Bundle Hash Match`);

  console.log(`\nTarget Looker Instances (${instanceResults.length}):`);
  instanceResults.forEach((res, idx) => {
    console.log(`  [Instance ${idx + 1}] ${res.host}`);
    console.log(`      ${res.projectPass ? '✅ PASS' : '❌ FAIL'} - Looker Project ('nano_admin')`);
    console.log(`      ${res.modelPass ? '✅ PASS' : '❌ FAIL'} - Looker Model Configuration ('nano_admin')`);
    const authCheckLabel = res.authMode === 'oauth'
      ? "Looker OAuth Client ('nano_admin_oauth_client')"
      : 'Looker User Attribute Allowlist';
    console.log(`      ${res.attrPass ? '✅ PASS' : '❌ FAIL'} - ${authCheckLabel} ${res.attrPass ? '' : res.attrDetails}`);
    if (res.manifestPass) {
      console.log(`      ✅ PASS - Looker Production Manifest Entitlements (Matches required configuration)`);
    } else {
      console.log(`      ⚠️ WARNING - Looker Production Manifest Entitlements [ACTION REQUIRED: Deploy extension manifest.lkml in project nano_admin. See details below.]`);
    }
    console.log(`      ${res.indexPass ? '✅ PASS' : '⚠️ WARNING'} - Project Workflows Configuration ('index.md') ${res.indexPass ? '' : '[ACTION REQUIRED: Add workflow definitions to index.md]'}`);
    console.log(`      ${res.modelFilePass ? '✅ PASS' : '⚠️ WARNING'} - LookML Model File ${res.modelFilePass ? `('${res.modelFileName}')` : '[ACTION REQUIRED: Add a model file (e.g. nano_admin.model.lkml)]'}`);
  });
  console.log('======================================================\n');

  return {
    projectPass: allProjectsPass,
    modelPass: allModelsPass,
    functionPass,
    gcsPass,
    attrPass: allAttrsPass,
    manifestPass: allManifestsPass,
    indexPass: allIndexPass,
    modelFilePass: allModelFilesPass
  };
}

module.exports = {
  runPostDeploymentVerification
};
