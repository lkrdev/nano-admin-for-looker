const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const crypto = require('crypto');

function loadLocalBuildHash() {
  let hash = '';
  try {
    const hashFile = path.join(__dirname, '..', '..', 'backend', 'src', 'build_hash.ts');
    if (fs.existsSync(hashFile)) {
      const content = fs.readFileSync(hashFile, 'utf8');
      const match = content.match(/BUILD_HASH\s*=\s*['"]([^'"]+)['"]/);
      if (match) hash = match[1];
    }
  } catch (e) {}
  return hash;
}

function resolveGcfUrl(config) {
  const canonicalUrl = `https://${config.gcp_region}-${config.gcp_project_id}.cloudfunctions.net/${config.gcf_name}`;
  let gcfUrl = '';

  try {
    const rawUrl = execSync(`gcloud functions describe ${config.gcf_name} --region=${config.gcp_region} --project=${config.gcp_project_id} --format="value(url)"`, { encoding: 'utf8', stdio: 'pipe' }).trim();
    if (rawUrl && rawUrl.startsWith('http')) {
      gcfUrl = rawUrl;
    }
  } catch (e) {}

  if (!gcfUrl || gcfUrl.includes('.a.run.app')) {
    gcfUrl = canonicalUrl;
  }

  return gcfUrl;
}

function checkSecretsExistInGCP(projectId) {
  if (!projectId) return false;
  try {
    execSync(`gcloud secrets describe LOOKERSDK_CLIENT_ID --project=${projectId}`, { stdio: 'ignore' });
    execSync(`gcloud secrets describe LOOKERSDK_CLIENT_SECRET --project=${projectId}`, { stdio: 'ignore' });
    return true;
  } catch (e) {
    return false;
  }
}

async function scanExistingResources(config, getLookerSaFn) {
  let gcpAccount = 'Unknown Account';
  try {
    gcpAccount = execSync('gcloud config get-value account', { encoding: 'utf8' }).trim();
  } catch (e) {}

  console.log('\n🔎 Scanning Looker to verify target service account...');
  let targetLookerSa = null;
  if (config.looker_service_account && getLookerSaFn) {
    targetLookerSa = await getLookerSaFn(config, config.looker_service_account);
  }

  console.log('🔎 Scanning GCP environment for existing resources...');
  let secretClientIdExists = false;
  let secretClientSecretExists = false;
  let secretHmacExists = false;
  try {
    execSync(`gcloud secrets describe LOOKERSDK_CLIENT_ID --project=${config.gcp_project_id}`, { stdio: 'ignore' });
    secretClientIdExists = true;
  } catch (e) {}
  try {
    execSync(`gcloud secrets describe LOOKERSDK_CLIENT_SECRET --project=${config.gcp_project_id}`, { stdio: 'ignore' });
    secretClientSecretExists = true;
  } catch (e) {}
  try {
    execSync(`gcloud secrets describe GCF_HMAC_SECRET --project=${config.gcp_project_id}`, { stdio: 'ignore' });
    secretHmacExists = true;
  } catch (e) {}

  let functionExists = false;
  try {
    execSync(`gcloud functions describe ${config.gcf_name} --region=${config.gcp_region} --project=${config.gcp_project_id}`, { stdio: 'ignore' });
    functionExists = true;
  } catch (e) {}

  let attributeExists = false;
  try {
    execSync(`looker-cli attribute cat nano_admin_admin_extension_nano_admin_challenge --host=${config.looker_host} --port=${config.looker_port} --ssl=${config.looker_ssl}`, { stdio: 'ignore' });
    attributeExists = true;
  } catch (e) {}

  return {
    gcpAccount,
    targetLookerSa,
    secretClientIdExists,
    secretClientSecretExists,
    secretHmacExists,
    functionExists,
    attributeExists
  };
}

function executeDeployCommand(cmdStr) {
  return new Promise((resolve, reject) => {
    const child = spawn('bash', ['-c', cmdStr], { stdio: ['inherit', 'pipe', 'pipe'] });
    let stdoutBuffer = '';
    let stderrBuffer = '';

    child.stdout.on('data', (data) => {
      const str = data.toString();
      stdoutBuffer += str;
      process.stdout.write(str);
    });

    child.stderr.on('data', (data) => {
      const str = data.toString();
      stderrBuffer += str;
      process.stderr.write(str);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdoutBuffer);
      } else {
        const error = new Error(`Command failed with code ${code}`);
        error.stderr = stderrBuffer;
        error.stdout = stdoutBuffer;
        reject(error);
      }
    });
  });
}

function printDrsTroubleshootingGuide(projectId) {
  console.log('\n======================================================');
  console.log('🚨 DOMAIN RESTRICTED SHARING (DRS) POLICY DETECTED');
  console.log('======================================================');
  console.log('The deployment failed because your Google Cloud Organization has');
  console.log('Domain Restricted Sharing (DRS) enabled. This policy prevents');
  console.log('making resources publicly accessible (assigning "allUsers").');
  console.log('\nSince Looker calls the backend Cloud Function, it requires public');
  console.log('(unauthenticated) access to allow the Extension to interact with it.');
  console.log('\nTo resolve this, you need to override the DRS policy for this project:');
  console.log('\nOption A: https://cloud.google.com/blog/topics/developers-practitioners/how-create-public-cloud-run-services-when-domain-restricted-sharing-enforced?e=48754805');
  console.log('\nOption B: Override via gcloud CLI (if you have Policy Admin permissions)');
  console.log('   Run the following commands in your terminal:');
  console.log('   Create a file policy.yaml:');
  console.log('   ---');
  console.log('   name: projects/' + projectId + '/policies/iam.allowedPolicyMemberDomains');
  console.log('   spec:');
  console.log('     rules:');
  console.log('     - allowAll: true');
  console.log('   ---');
  console.log('   Apply it:');
  console.log(`   gcloud org-policies set-policy policy.yaml --project=${projectId}`);
  console.log('======================================================\n');
}

async function deployGCF(config, lookerCreds) {
  console.log('\n☁️ Setting up Google Cloud deployment...');

  const localBuildHash = loadLocalBuildHash();
  console.log(`Local Build Hash is: ${localBuildHash}`);

  console.log(`Setting active GCP project to ${config.gcp_project_id}...`);
  execSync(`gcloud config set project ${config.gcp_project_id}`, { stdio: 'inherit' });

  console.log('Enabling required Google Cloud APIs (Function, Secret Manager, Cloud Build)...');
  try {
    execSync('gcloud services enable cloudfunctions.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com', { stdio: 'inherit' });
  } catch (e) {
    console.warn('⚠️ Warning: Failed to enable services automatically. Make sure they are enabled in your GCP project.');
  }

  const projectNumber = execSync(`gcloud projects describe ${config.gcp_project_id} --format="value(projectNumber)"`, { encoding: 'utf8' }).trim();
  const defaultSa = `${projectNumber}-compute@developer.gserviceaccount.com`;
  console.log(`Default Compute Engine service account: ${defaultSa}`);

  console.log(`Ensuring Cloud Build Builder permission for default Compute Service Account: ${defaultSa}...`);
  try {
    execSync(`gcloud projects add-iam-policy-binding ${config.gcp_project_id} --member="serviceAccount:${defaultSa}" --role="roles/cloudbuild.builds.builder"`, { stdio: 'ignore' });
    console.log('✅ Granted roles/cloudbuild.builds.builder permission.');
  } catch (e) {
    console.warn('⚠️ Warning: Failed to automatically grant Cloud Build Builder permission. This may cause deployment warnings or failures.');
  }

  let secretManagerError = null;

  try {
    let hasHmac = false;
    try {
      execSync('gcloud secrets describe GCF_HMAC_SECRET', { stdio: 'ignore' });
      hasHmac = true;
      console.log('✅ GCF_HMAC_SECRET already exists in Secret Manager.');
    } catch (e) {
      console.log('Creating GCF_HMAC_SECRET secret in Secret Manager...');
      try {
        execSync('gcloud secrets create GCF_HMAC_SECRET --replication-policy="automatic"', { stdio: 'inherit' });
      } catch (err) {}
    }

    if (!hasHmac) {
      const hmacSecret = crypto.randomBytes(32).toString('hex');
      console.log('Adding new secret version for GCF_HMAC_SECRET...');
      execSync(`echo -n "${hmacSecret}" | gcloud secrets versions add GCF_HMAC_SECRET --data-file=-`, { stdio: 'inherit' });
    }

    if (lookerCreds) {
      console.log('Configuring LOOKERSDK_CLIENT_ID in Secret Manager...');
      try {
        execSync('gcloud secrets describe LOOKERSDK_CLIENT_ID', { stdio: 'ignore' });
      } catch (e) {
        try {
          execSync('gcloud secrets create LOOKERSDK_CLIENT_ID --replication-policy="automatic"', { stdio: 'inherit' });
        } catch (err) {}
      }
      execSync(`echo -n "${lookerCreds.clientId}" | gcloud secrets versions add LOOKERSDK_CLIENT_ID --data-file=-`, { stdio: 'inherit' });

      console.log('Configuring LOOKERSDK_CLIENT_SECRET in Secret Manager...');
      try {
        execSync('gcloud secrets describe LOOKERSDK_CLIENT_SECRET', { stdio: 'ignore' });
      } catch (e) {
        try {
          execSync('gcloud secrets create LOOKERSDK_CLIENT_SECRET --replication-policy="automatic"', { stdio: 'inherit' });
        } catch (err) {}
      }
      execSync(`echo -n "${lookerCreds.clientSecret}" | gcloud secrets versions add LOOKERSDK_CLIENT_SECRET --data-file=-`, { stdio: 'inherit' });
    }

    console.log(`Granting Secret Accessor permission to default Compute Service Account: ${defaultSa}...`);
    try {
      execSync(`gcloud secrets add-iam-policy-binding GCF_HMAC_SECRET --member="serviceAccount:${defaultSa}" --role="roles/secretmanager.secretAccessor" --project=${config.gcp_project_id}`, { stdio: 'ignore' });
      execSync(`gcloud secrets add-iam-policy-binding LOOKERSDK_CLIENT_ID --member="serviceAccount:${defaultSa}" --role="roles/secretmanager.secretAccessor" --project=${config.gcp_project_id}`, { stdio: 'ignore' });
      execSync(`gcloud secrets add-iam-policy-binding LOOKERSDK_CLIENT_SECRET --member="serviceAccount:${defaultSa}" --role="roles/secretmanager.secretAccessor" --project=${config.gcp_project_id}`, { stdio: 'ignore' });
    } catch (e) {
      console.warn('⚠️ Warning: Failed to grant Secret Accessor permission automatically. Make sure the default compute service account has roles/secretmanager.secretAccessor role.');
    }
  } catch (smErr) {
    secretManagerError = smErr.message;
    console.warn(`⚠️ Warning: Secret Manager provisioning encountered an issue: ${smErr.message}`);
  }

  console.log('\n📦 Compiling backend TypeScript code...');
  execSync('npm run backend:build', { stdio: 'inherit' });

  console.log(`\n🚀 Deploying Cloud Function: ${config.gcf_name} to region ${config.gcp_region}...`);
  const deployCommand = `gcloud functions deploy ${config.gcf_name} \\
    --gen2 \\
    --runtime=nodejs24 \\
    --region=${config.gcp_region} \\
    --trigger-http \\
    --allow-unauthenticated \\
    --entry-point=nanoAdminBackend \\
    --source=backend \\
    --set-env-vars="LOOKERSDK_BASE_URL=https://${config.looker_host}:${config.looker_port},BUILD_HASH=${localBuildHash}" \\
    --set-secrets="LOOKERSDK_CLIENT_ID=LOOKERSDK_CLIENT_ID:latest,LOOKERSDK_CLIENT_SECRET=LOOKERSDK_CLIENT_SECRET:latest,GCF_HMAC_SECRET=GCF_HMAC_SECRET:latest"`;

  console.log(`Running deploy command:\n${deployCommand}\n`);
  try {
    await executeDeployCommand(deployCommand);
  } catch (error) {
    const isDrs = error.stderr && (
      error.stderr.includes('do not belong to a permitted customer') ||
      error.stderr.includes('allowedPolicyMemberDomains')
    );

    if (isDrs) {
      printDrsTroubleshootingGuide(config.gcp_project_id);
    }
    throw error;
  }

  console.log('Retrieving deployed Cloud Function URL...');
  const gcfUrl = resolveGcfUrl(config);

  if (!gcfUrl || !gcfUrl.startsWith('http')) {
    console.error(`\n💥 Fatal Error: Failed to resolve valid HTTP URL for Cloud Function "${config.gcf_name}". Received: "${gcfUrl}"`);
    process.exit(1);
  }

  console.log(`\n✅ Cloud Function deployed successfully at: ${gcfUrl}`);
  return { gcfUrl, secretManagerError };
}

async function deployExtensionToGCS(config) {
  const bucketName = config.gcs_bucket_name;
  console.log(`\n🪣 Configuring Google Cloud Storage Bucket: gs://${bucketName}...`);

  try {
    execSync(`gcloud storage buckets describe gs://${bucketName} --project=${config.gcp_project_id}`, { stdio: 'ignore' });
    console.log(`✅ Bucket gs://${bucketName} already exists.`);
  } catch (e) {
    console.log(`Creating new storage bucket gs://${bucketName}...`);
    try {
      execSync(`gcloud storage buckets create gs://${bucketName} --location=${config.gcp_region} --project=${config.gcp_project_id}`, { stdio: 'inherit' });
      console.log('✅ Bucket created successfully.');
    } catch (createErr) {
      console.error(`❌ Failed to create bucket: ${createErr.message}`);
      process.exit(1);
    }
  }

  console.log(`Setting public read access on bucket gs://${bucketName}...`);
  try {
    execSync(`gcloud storage buckets add-iam-policy-binding gs://${bucketName} --member=allUsers --role=roles/storage.objectViewer --project=${config.gcp_project_id}`, { stdio: 'ignore' });
    console.log(`✅ Granted public read access to allUsers.`);
  } catch (iamErr) {
    console.warn(`⚠️ Warning: Failed to automatically set public read access. Ensure publicAccessPrevention is not enforced or configure the bucket policy manually.`);
  }

  console.log(`Configuring CORS policy on bucket gs://${bucketName} for Looker origin...`);
  const corsPath = path.join(__dirname, '..', '..', 'gcs-cors.json');
  const corsConfig = [
    {
      "origin": ["*"],
      "method": ["GET", "OPTIONS", "HEAD"],
      "responseHeader": ["Content-Type", "x-goog-meta-hash"],
      "maxAgeSeconds": 3600
    }
  ];
  fs.writeFileSync(corsPath, JSON.stringify(corsConfig, null, 2), 'utf8');
  try {
    execSync(`gcloud storage buckets update gs://${bucketName} --cors-file="${corsPath}" --project=${config.gcp_project_id}`, { stdio: 'ignore' });
    console.log(`✅ CORS policy configured successfully.`);
  } catch (corsErr) {
    console.warn(`⚠️ Warning: Failed to set CORS policy automatically: ${corsErr.message}`);
  } finally {
    if (fs.existsSync(corsPath)) {
      fs.unlinkSync(corsPath);
    }
  }

  const publishMaps = process.env.PUBLISH_SOURCE_MAPS === 'true' || config.publish_source_maps === true || process.argv.includes('--upload-source-maps');

  if (publishMaps) {
    console.log(`Uploading extension assets (including source maps) to gs://${bucketName}...`);
  } else {
    console.log(`Uploading extension assets (excluding .map files by default) to gs://${bucketName}...`);
  }

  const gcloudIgnoreFlag = publishMaps ? '' : '--ignore-matches=".*\\.map$" ';
  const gsutilExcludeFlag = publishMaps ? '' : '-x ".*\\.map$" ';

  try {
    try {
      execSync(`gcloud storage cp -r ${gcloudIgnoreFlag}extension/dist/* gs://${bucketName}/ --project=${config.gcp_project_id}`, { stdio: 'inherit' });
    } catch (gcloudErr) {
      console.log('⚠️ gcloud storage upload failed. Trying fallback to gsutil...');
      execSync(`gsutil cp -r ${gsutilExcludeFlag}extension/dist/* gs://${bucketName}/`, { stdio: 'inherit' });
    }
    console.log(`✅ Successfully uploaded extension assets to GCS.`);
  } catch (uploadErr) {
    console.error(`❌ Failed to upload extension assets to GCS: ${uploadErr.message}`);
    process.exit(1);
  }

  const publicUrl = `https://storage.googleapis.com/${bucketName}/`;
  console.log(`🌍 Extension assets publicly accessible at: ${publicUrl}`);
  return publicUrl;
}

module.exports = {
  loadLocalBuildHash,
  resolveGcfUrl,
  checkSecretsExistInGCP,
  scanExistingResources,
  deployGCF,
  deployExtensionToGCS
};
