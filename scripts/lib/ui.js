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
  console.log(`  • Cloud Function Ingress: ${config.gcf_ingress_settings || 'all'}`);
  console.log(`  • GCS Bucket Name:        ${config.gcs_bucket_name}`);
  console.log(`  • Active GCP Account:     ${status.gcpAccount || 'Authenticated User'}`);
  
  console.log(`\nTarget Looker Instances (${instances.length}):`);
  instances.forEach((inst, idx) => {
    const user = Array.isArray(lookerUsers)
      ? (lookerUsers.find(u => u.host === inst.looker_host)?.user || 'Authenticated User')
      : (lookerUsers || 'Authenticated User');

    let saLabel = 'Auto-managed Service Account';
    if (inst.looker_credential_method === 'manual') saLabel = 'Using manual API credentials';
    else if (inst.looker_credential_method === 'reuse') saLabel = 'Reusing Secret Manager credentials';
    else if (inst.looker_service_account) saLabel = `Service Account ID ${inst.looker_service_account}`;

    let projectLabel = inst.projectState?.projectExists ? 'Existing project (reusing)' : 'New project (will create)';

    let modelLabel = 'Existing model (reusing)';
    if (!inst.projectState?.modelExists) {
      if (inst.modelSelection?.unlimited) {
        modelLabel = 'New model (Unlimited database connections)';
      } else if (inst.modelSelection?.allowed_connections?.length > 0) {
        modelLabel = `New model (Connection: "${inst.modelSelection.allowed_connections[0]}")`;
      } else {
        modelLabel = 'New model (Unlimited database connections)';
      }
    }

    let gitLabel = 'Bare repository (hosted on Looker server)';
    const isGitReuse = inst.gitAction === 'reuse' || inst.gitConfig?.action === 'reuse';
    const effectiveGitType = inst.git_type || inst.gitConfig?.git_type || 'bare';
    const effectiveGitUrl = inst.git_remote_url || inst.gitConfig?.git_remote_url || '';

    if (isGitReuse) {
      gitLabel = `Existing Git connection (${effectiveGitType}${effectiveGitUrl ? ` - ${effectiveGitUrl}` : ''}, reusing)`;
    } else if (effectiveGitType === 'private') {
      gitLabel = `Private repository (${effectiveGitUrl || 'URL pending'})`;
    } else if (effectiveGitType === 'public') {
      gitLabel = `Public repository (${effectiveGitUrl || 'URL pending'})`;
    }

    const authLabel = inst.auth_mode === 'oauth'
      ? 'OAuth 2.0 (PKCE)'
      : 'Server Proxy (User Attribute Challenge)';

    console.log(`  [Instance ${idx + 1}] ${inst.looker_host}:${inst.looker_port} (SSL: ${inst.looker_ssl ? 'Yes' : 'No'})`);
    console.log(`      ├─ Auth Mode:            ${authLabel}`);
    console.log(`      ├─ Service Account:      ${saLabel}`);
    console.log(`      ├─ Project "nano_admin": ${projectLabel}`);
    console.log(`      ├─ Model "nano_admin":   ${modelLabel}`);
    console.log(`      ├─ Git Repository:       ${gitLabel}`);
    console.log(`      └─ Active Session:       ${user}`);
  });

  console.log('\nDeployment Actions & Resource Overwrites (Pending Execution Confirmation):');
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
  console.log(`  [ ] Looker Project & Model Provisioning ('nano_admin'):`);
  instances.forEach((inst, idx) => {
    const isProjReuse = inst.projectState?.projectExists || inst.projectAction === 'reuse';
    const isModelReuse = inst.projectState?.modelExists || inst.modelAction === 'reuse';
    const isGitReuse = inst.gitAction === 'reuse' || inst.gitConfig?.action === 'reuse';
    const effectiveGitType = inst.git_type || inst.gitConfig?.git_type || 'bare';

    const pText = isProjReuse ? 'REUSED (UNTOUCHED)' : 'NEWLY CREATED';
    const mText = isModelReuse
      ? 'REUSED (UNTOUCHED)'
      : `CREATE WITH ${inst.modelSelection?.unlimited ? 'UNLIMITED CONNECTIONS' : `CONNECTION: ${inst.modelSelection?.allowed_connections?.[0]}`}`;
    const gText = isGitReuse
      ? 'REUSED (UNTOUCHED)'
      : `CONFIGURE AS ${effectiveGitType.toUpperCase()}`;

    console.log(`      ├─ [Instance ${idx + 1}] Project: [${pText}] | Model: [${mText}] | Git: [${gText}]`);
  });
  console.log(`  [ ] Looker Authentication Provisioning (per instance):`);
  instances.forEach((inst, idx) => {
    const branchChar = idx === instances.length - 1 ? '└─' : '├─';
    if (inst.auth_mode === 'oauth') {
      console.log(`      ${branchChar} [Instance ${idx + 1}] OAuth Client ('nano_admin_oauth_client'): [REGISTER / VERIFY REDIRECT URI]`);
    } else {
      console.log(`      ${branchChar} [Instance ${idx + 1}] User Attribute ('nano_admin_admin_extension_nano_admin_challenge'): [CREATE / VERIFY DOMAIN ALLOWLIST]`);
    }
  });
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

function printDeploymentSuccess(config, manifestContent, gcfUrl, isManifestUpToDate = false, projectResults = []) {
  const instances = Array.isArray(config.instances) && config.instances.length > 0
    ? config.instances
    : [{ looker_host: config.looker_host, looker_port: config.looker_port, looker_ssl: config.looker_ssl }];

  console.log('\n🎉 Deployment completed successfully! 🎉');
  console.log('----------------------------------------------------');

  if (projectResults && projectResults.length > 0) {
    console.log('\n📦 Looker Project & Git Configuration:');
    projectResults.forEach((res, idx) => {
      console.log(`  [Instance ${idx + 1}] ${res.host}:`);
      console.log(`      ├─ Project "nano_admin":       ${res.project?.created ? 'Newly created' : 'Verified (exists)'}`);
      console.log(`      ├─ Model "nano_admin":         ${res.model?.created ? 'Newly configured' : 'Verified (exists)'}`);
      const gitType = res.git?.git_type || 'bare';
      const gitDesc = gitType === 'bare'
        ? 'Bare repository (hosted on Looker server)'
        : `${gitType} repository (${res.git?.git_remote_url || 'no url'})`;
      console.log(`      ├─ Git Connection:             ${gitDesc}`);
      
      const filesDesc = [
        res.files?.hasManifest ? 'manifest.lkml' : null,
        res.files?.hasIndexMd ? 'index.md' : null,
        res.files?.hasModelFile ? (res.files.modelFileName || '*.model.lkml') : null
      ].filter(Boolean).join(', ') || 'none';
      console.log(`      └─ Files Found in Project:     ${filesDesc}`);
    });
  }

  const privateInstancesNeedingKey = (projectResults || []).filter(r => r.git?.git_type === 'private' && r.git?.deploy_key);
  if (privateInstancesNeedingKey.length > 0) {
    console.log('\n🔑 ACTION REQUIRED: REGISTER GIT DEPLOY KEYS (PRIVATE REPOSITORY):');
    console.log('For each Looker instance, add the generated public SSH key as a Deploy Key in your remote Git repository:');
    privateInstancesNeedingKey.forEach(r => {
      console.log(`\n--- Public Deploy Key for ${r.host} (${r.git.git_remote_url || 'remote repo'}) ---`);
      console.log(r.git.deploy_key);
      console.log('----------------------------------------------------');
    });
    console.log('👉 In your Git provider (GitHub, GitLab, etc.), navigate to Repository Settings -> Deploy Keys -> Add deploy key.');
    console.log('👉 Paste the public key above and grant Read access (or Read/Write if using Looker Git commit).');
  }

  const allManifestsPass = isManifestUpToDate && (projectResults.length === 0 || projectResults.every(r => r.files?.hasManifest));
  const allIndexPass = projectResults.length === 0 || projectResults.every(r => r.files?.hasIndexMd);
  const allModelFilesPass = projectResults.length === 0 || projectResults.every(r => r.files?.hasModelFile);

  if (allManifestsPass && allIndexPass && allModelFilesPass && privateInstancesNeedingKey.length === 0) {
    console.log('\n✅ Production manifest.lkml and project files are in place across all instances!');
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
    console.log('\n📋 REQUIRED NEXT STEPS:');
    let stepNumber = 1;

    if (privateInstancesNeedingKey.length > 0) {
      console.log(`\n${stepNumber++}. Register the public deploy key(s) listed above in your remote Git repository.`);
    }

    if (!allManifestsPass) {
      console.log(`\n${stepNumber++}. In your Git repository or Looker project "nano_admin", create or update "manifest.lkml" with:`);
      instances.forEach((inst, idx) => {
        const protocol = 'https';
        const hostPort = (inst.looker_port && String(inst.looker_port) !== '443')
          ? `${inst.looker_host}:${inst.looker_port}`
          : inst.looker_host;
        const lookerIdeUrl = `${protocol}://${hostPort}/projects/nano_admin/files/manifest.lkml`;
        console.log(`   👉 [Instance ${idx + 1}] IDE URL: ${lookerIdeUrl}`);
      });
      console.log('\n----------------- COPY FROM HERE -----------------');
      console.log(manifestContent || 'manifest.lkml content could not be read.');
      console.log('------------------ COPY TO HERE ------------------\n');
      console.log('   Commit, push, and deploy this manifest to production.');
    }

    if (!allIndexPass) {
      console.log(`\n${stepNumber++}. Add your workflow definitions file "index.md" to project "nano_admin" and deploy to production.`);
      console.log('   (See template workflows in the project repository for reference syntax).');
    }

    if (!allModelFilesPass) {
      console.log(`\n${stepNumber++}. Ensure a model file (such as "nano_admin.model.lkml" or "blank.model.lkml") exists in project "nano_admin".`);
    }

    console.log(`\n${stepNumber++}. Open Looker, load the Nano Admin extension, and test functionality:`);
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
