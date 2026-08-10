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
  
  let modelPass = false;
  try {
    const modelsOutput = execSync(`looker-cli api lookmlmodel all_lookml_models --host=${config.looker_host} --port=${config.looker_port} --ssl=${config.looker_ssl}`, { encoding: 'utf8', stdio: 'pipe' });
    const models = parseJsonFromStdout(modelsOutput);
    modelPass = Array.isArray(models) && models.some(m => m.name === 'nano_admin');
  } catch (e) {}

  let functionPass = false;
  let deployedHash = '';
  try {
    deployedHash = execSync(`gcloud functions describe ${config.gcf_name} --region=${config.gcp_region} --project=${config.gcp_project_id} --format="value(serviceConfig.environmentVariables.BUILD_HASH)"`, { encoding: 'utf8', stdio: 'pipe' }).trim();
    functionPass = (deployedHash === localHash && localHash !== '');
  } catch (e) {}

  let gcsPass = false;
  try {
    const gcsBundleUrl = `https://storage.googleapis.com/${config.gcs_bucket_name}/bundle.js`;
    const bundleContent = await fetchUrlContent(gcsBundleUrl);
    gcsPass = bundleContent.includes(localHash) && localHash !== '';
  } catch (e) {}

  let attrPass = false;
  let attrDetails = '';
  try {
    const attrOutput = execSync(`looker-cli api userattribute all_user_attributes --host=${config.looker_host} --port=${config.looker_port} --ssl=${config.looker_ssl}`, { encoding: 'utf8', stdio: 'pipe' });
    const attributes = parseJsonFromStdout(attrOutput);
    const attr = Array.isArray(attributes) && attributes.find(a => a.name === 'nano_admin_admin_extension_nano_admin_challenge');
    if (attr) {
      const allowlistStr = Array.isArray(attr.hidden_value_domain_whitelist)
        ? attr.hidden_value_domain_whitelist.join(',')
        : String(attr.hidden_value_domain_whitelist || attr.domain_allowlist || '');
      if (!gcfUrl || allowlistStr.includes(gcfUrl)) {
        attrPass = true;
      } else {
        attrDetails = `(Missing ${gcfUrl} in domain allowlist: [${allowlistStr}])`;
      }
    } else {
      attrDetails = `(User attribute 'nano_admin_admin_extension_nano_admin_challenge' not found)`;
    }
  } catch (e) {
    attrDetails = `(${e.message})`;
  }

  let manifestPass = false;
  let manifestDetails = '';
  try {
    const gcsBundleUrl = `https://storage.googleapis.com/${config.gcs_bucket_name}/bundle.js`;
    const prodManifestContent = execSync(`looker-cli project file cat nano_admin manifest.lkml --host=${config.looker_host} --port=${config.looker_port} --ssl=${config.looker_ssl}`, { encoding: 'utf8', stdio: 'pipe' }).trim();
    if (prodManifestContent) {
      const hasGcf = !gcfUrl || prodManifestContent.includes(gcfUrl);
      const hasGcs = prodManifestContent.includes(gcsBundleUrl);
      if (hasGcf && hasGcs) {
        manifestPass = true;
      } else {
        manifestDetails = `(Production manifest.lkml in Looker missing required URLs: gcfUrl=${hasGcf}, bundleUrl=${hasGcs})`;
      }
    } else {
      manifestDetails = `(Could not read manifest.lkml from Looker project)`;
    }
  } catch (e) {
    manifestDetails = `(${e.message})`;
  }

  console.log('\n======================================================');
  console.log('🔍 POST-DEPLOYMENT VERIFICATION RESULTS');
  console.log('======================================================');
  console.log(`  ${modelPass ? '✅ PASS' : '❌ FAIL'} - Looker Model Configuration ('nano_admin')`);
  console.log(`  ${functionPass ? '✅ PASS' : '❌ FAIL'} - Deployed Cloud Function Hash (Local: ${localHash || 'Unknown'}, Deployed: ${deployedHash || 'None'})`);
  console.log(`  ${gcsPass ? '✅ PASS' : '❌ FAIL'} - GCS Hosted JS Bundle Hash Match`);
  console.log(`  ${attrPass ? '✅ PASS' : '❌ FAIL'} - Looker User Attribute Allowlist ${attrPass ? '' : attrDetails}`);
  console.log(`  ${manifestPass ? '✅ PASS' : '❌ FAIL'} - Looker Production Manifest Entitlements ${manifestPass ? '' : manifestDetails}`);
  console.log('======================================================\n');

  return {
    modelPass,
    functionPass,
    gcsPass,
    attrPass,
    manifestPass
  };
}

module.exports = {
  runPostDeploymentVerification
};
