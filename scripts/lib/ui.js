const readline = require('readline');

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
  console.log('NOTE: No changes will be applied to your Looker instance or GCP project');
  console.log('until you have reviewed and confirmed the final deployment preview.');
  console.log('====================================================\n');
}

function printDeploymentPreview(config, lookerUser, status) {
  let credsLabel = 'Auto-generated Looker Service Account';
  let lookerSaStatus = status.saExists ? 'EXISTS (WILL REUSE / SKIPPED RE-CREATION)' : 'WILL BE CREATED';

  if (config.looker_credential_method === 'manual') {
    credsLabel = 'Manual User API Keys (Provided during prompt)';
    lookerSaStatus = 'SKIPPED (USING MANUAL KEYS)';
  } else if (config.looker_credential_method === 'reuse') {
    credsLabel = 'Reuse Existing GCP Secret Manager Credentials';
  }

  let saLabel = 'Auto-managed Service Account';
  if (config.looker_service_account) {
    saLabel = config.looker_service_account;
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

function printDeploymentSuccess(config, manifestContent, gcfUrl, isManifestUpToDate = false) {
  const protocol = config.looker_ssl ? 'https' : 'http';
  const lookerIdeUrl = `${protocol}://${config.looker_host}/projects/nano_admin/files/manifest.lkml`;
  const extensionUrl = `${protocol}://${config.looker_host}/extensions/nano_admin::admin_extension`;

  console.log('\n🎉 Deployment and setup completed successfully! 🎉');
  console.log('----------------------------------------------------');

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

module.exports = {
  askQuestion,
  printHeader,
  printDeploymentPreview,
  askConfirmation,
  printDeploymentCancelled,
  printDeploymentSuccess
};
