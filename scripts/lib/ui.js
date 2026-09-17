const readline = require('readline');
const { sanitizeHostForSecret } = require('./gcp');

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

function printHeader() {
  console.log('====================================================');
  console.log('🚀 Nano-Admin for Looker Deployment Script 🚀');
  console.log('====================================================');
  console.log('Welcome! You will be guided through configuring your target settings.');
  console.log('====================================================\n');
}

function printDeploymentPreview(config, lookerUsers, status) {
  const instances = config.instances || [
    {
      looker_host: config.looker_host,
      looker_port: config.looker_port,
      looker_ssl: config.looker_ssl,
      looker_service_account: config.looker_service_account,
      looker_credential_method: config.looker_credential_method
    }
  ];

  console.log('\n======================================================');
  console.log('🔎 PREVIEW OF PENDING CHANGES');
  console.log('======================================================');
  console.log('Please review the active sessions and target configuration below:');
  console.log('\nGCP Deployment Settings:');
  console.log(`  • GCP Project ID:         ${config.gcp_project_id}`);
  console.log(`  • GCP Region:             ${config.gcp_region}`);
  console.log(`  • Cloud Function Name:    ${config.gcf_name}`);
  console.log(`  • GCS Bucket Name:        ${config.gcs_bucket_name}`);
  console.log(`  • Active GCP Account:     ${status.gcpAccount || 'Authenticated User'}`);
  
  console.log(`\nTarget Looker Instances (${instances.length}):`);
  instances.forEach((inst, idx) => {
    const user = Array.isArray(lookerUsers)
      ? (lookerUsers.find(u => u.host === inst.looker_host)?.user || 'Authenticated User')
      : (lookerUsers || 'Authenticated User');

    let saLabel = inst.looker_service_account || 'Auto-managed Service Account';
    if (inst.looker_credential_method === 'manual') saLabel = 'N/A (Using manual credentials)';
    else if (inst.looker_credential_method === 'reuse') saLabel = inst.looker_service_account ? `${inst.looker_service_account} (Reusing)` : 'Reusing Secret Manager creds';

    console.log(`  [Instance ${idx + 1}] ${inst.looker_host}:${inst.looker_port} (SSL: ${inst.looker_ssl ? 'Yes' : 'No'})`);
    console.log(`      ├─ Service Account:   ${saLabel}`);
    console.log(`      └─ Active Session:    ${user}`);
  });

  console.log('\nDeployment Actions & Resource Overwrites (Pending Phase 7 Execution):');
  console.log('  [ ] Compile backend TypeScript code');
  console.log('  [ ] Compile & package extension React bundle');
  console.log(`  [ ] Deploy Google Cloud Function:`);
  console.log(`      └─ Status: ${config.gcf_name} will be [${status.functionExists ? 'OVERWRITTEN / RE-DEPLOYED' : 'NEWLY CREATED'}]`);
  console.log(`  [ ] Secret Manager Provisioning & IAM Setup:`);
  instances.forEach((inst) => {
    const sanHost = sanitizeHostForSecret(inst.looker_host);
    const isNew = inst.looker_credential_method === 'generate' || inst.looker_credential_method === 'manual';
    const actionLabel = isNew ? 'CREATE / UPDATE NEW VERSION' : 'REUSED (UNTOUCHED)';
    console.log(`      ├─ NANO_ADMIN_LOOKERSDK_CLIENT_ID_${sanHost}: [${actionLabel}]`);
    console.log(`      ├─ NANO_ADMIN_LOOKERSDK_CLIENT_SECRET_${sanHost}: [${actionLabel}]`);
  });
  console.log(`      ├─ GCF_HMAC_SECRET:         [${status.secretHmacExists ? 'REUSED (UNTOUCHED)' : 'NEWLY CREATED'}]`);
  console.log(`      └─ Secret Accessor Role:    [GRANT ACCESS TO DEFAULT GCP COMPUTE SERVICE ACCOUNT]`);
  console.log(`  [ ] GCP Project IAM Setup:`);
  console.log(`      └─ Cloud Build Builder Role: [GRANT roles/cloudbuild.builds.builder TO DEFAULT COMPUTE SERVICE ACCOUNT]`);
  console.log(`  [ ] Looker User Attribute (per instance):`);
  console.log(`      └─ nano_admin_admin_extension_nano_admin_challenge: [CREATE / FORCE-UPDATE ON ALL INSTANCES]`);
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

function printDeploymentSuccess(config, manifestContent, gcfUrl, isManifestUpToDate = false) {
  const instances = Array.isArray(config.instances) && config.instances.length > 0
    ? config.instances
    : [{ looker_host: config.looker_host, looker_port: config.looker_port, looker_ssl: config.looker_ssl }];

  console.log('\n🎉 Deployment and setup completed successfully! 🎉');
  console.log('----------------------------------------------------');

  if (isManifestUpToDate) {
    console.log('✅ Production manifest.lkml in Looker matches the required configuration across all instances. No action needed!');
    console.log('\nTarget Looker Extension Links:');
    instances.forEach((inst, idx) => {
      const protocol = 'https';
      const hostPort = (inst.looker_port && String(inst.looker_port) !== '443')
        ? `${inst.looker_host}:${inst.looker_port}`
        : inst.looker_host;
      const extensionUrl = `${protocol}://${hostPort}/extensions/nano_admin::admin_extension`;
      console.log(`  [Instance ${idx + 1}] ${inst.looker_host}`);
      console.log(`      👉 Link: ${extensionUrl}`);
    });
  } else {
    console.log('\n⚠️  ACTION REQUIRED FOR LOOKER MANIFEST:');
    console.log(`1. Open your Looker project manifest in project "nano_admin":`);
    instances.forEach((inst, idx) => {
      const protocol = 'https';
      const hostPort = (inst.looker_port && String(inst.looker_port) !== '443')
        ? `${inst.looker_host}:${inst.looker_port}`
        : inst.looker_host;
      const lookerIdeUrl = `${protocol}://${hostPort}/projects/nano_admin/files/manifest.lkml`;
      console.log(`   👉 [Instance ${idx + 1}] ${inst.looker_host}: ${lookerIdeUrl}`);
    });
    console.log('\n2. Edit or create your "manifest.lkml" file and replace its content with the following:');
    console.log('\n----------------- COPY FROM HERE -----------------');
    console.log(manifestContent || 'manifest.lkml content could not be read.');
    console.log('------------------ COPY TO HERE ------------------\n');
    console.log('3. Commit, push, and deploy these manifest changes to production in your Looker project(s).');
    console.log(`4. Open Looker, load the Nano Admin extension, and test the functionality:`);
    instances.forEach((inst, idx) => {
      const protocol = 'https';
      const hostPort = (inst.looker_port && String(inst.looker_port) !== '443')
        ? `${inst.looker_host}:${inst.looker_port}`
        : inst.looker_host;
      const extensionUrl = `${protocol}://${hostPort}/extensions/nano_admin::admin_extension`;
      console.log(`   👉 [Instance ${idx + 1}] ${inst.looker_host}: ${extensionUrl}`);
    });
  }
  console.log('----------------------------------------------------');
}

module.exports = {
  askQuestion,
  printHeader,
  printDeploymentPreview,
  askConfirmation,
  printDeploymentCancelled,
  printDeploymentSuccess
};
