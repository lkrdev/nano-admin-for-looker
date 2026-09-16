const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const crypto = require('crypto');

function sanitizeHostForSecret(host) {
  const cleanHost = (host || '').trim().toLowerCase();
  let sanitized = cleanHost.replace(/[^a-z0-9]/g, '_');
  if (sanitized.length > 180) {
    const hash = crypto.createHash('sha256').update(cleanHost).digest('hex').substring(0, 16);
    sanitized = `${sanitized.substring(0, 180)}_${hash}`;
  }
  return sanitized;
}

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

function checkSecretsExistInGCP(projectId, instances = []) {
  if (!projectId) return false;
  const targetHosts = Array.isArray(instances) && instances.length > 0
    ? instances.map(i => i.looker_host || i)
    : [];
  if (targetHosts.length === 0) return false;

  try {
    for (const host of targetHosts) {
      const sanitizedHost = sanitizeHostForSecret(host);
      execSync(`gcloud secrets describe NANO_ADMIN_LOOKERSDK_CLIENT_ID_${sanitizedHost} --project=${projectId}`, { stdio: 'ignore' });
      execSync(`gcloud secrets describe NANO_ADMIN_LOOKERSDK_CLIENT_SECRET_${sanitizedHost} --project=${projectId}`, { stdio: 'ignore' });
    }
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
  let secretHmacExists = false;
  try {
    execSync(`gcloud secrets describe GCF_HMAC_SECRET --project=${config.gcp_project_id}`, { stdio: 'ignore' });
    secretHmacExists = true;
  } catch (e) {}

  let functionExists = false;
  try {
    execSync(`gcloud functions describe ${config.gcf_name} --region=${config.gcp_region} --project=${config.gcp_project_id}`, { stdio: 'ignore' });
    functionExists = true;
  } catch (e) {}

  return {
    gcpAccount,
    targetLookerSa,
    secretHmacExists,
    functionExists
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

  console.log('\n📦 Compiling backend TypeScript code and generating build hash...');
  execSync('npm run backend:build', { stdio: 'inherit' });

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

  console.log(`Ensuring Secret Accessor permission for default Compute Service Account: ${defaultSa}...`);
  try {
    execSync(`gcloud projects add-iam-policy-binding ${config.gcp_project_id} --member="serviceAccount:${defaultSa}" --role="roles/secretmanager.secretAccessor"`, { stdio: 'ignore' });
    console.log('✅ Granted roles/secretmanager.secretAccessor permission.');
  } catch (e) {
    console.warn('⚠️ Warning: Failed to grant project-level Secret Accessor permission automatically.');
  }

  let secretManagerError = null;
  const secretBindings = [
    'GCF_HMAC_SECRET=GCF_HMAC_SECRET:latest'
  ];

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

    const instances = Array.isArray(config.instances) && config.instances.length > 0
      ? config.instances
      : [{ looker_host: config.looker_host, looker_port: config.looker_port, looker_ssl: config.looker_ssl }];

    if (lookerCreds) {
      const multiMap = typeof lookerCreds === 'object' && lookerCreds.instances ? lookerCreds.instances : lookerCreds;

      for (const inst of instances) {
        const host = inst.looker_host;
        const creds = multiMap[host] || (host === config.looker_host ? lookerCreds : null);
        const sanitizedHost = sanitizeHostForSecret(host);
        const clientIdSecret = `NANO_ADMIN_LOOKERSDK_CLIENT_ID_${sanitizedHost}`;
        const clientSecretSecret = `NANO_ADMIN_LOOKERSDK_CLIENT_SECRET_${sanitizedHost}`;

        if (creds && creds.client_id && creds.client_secret) {
          console.log(`Configuring Secret Manager secret ${clientIdSecret}...`);
          try { execSync(`gcloud secrets describe ${clientIdSecret} --project=${config.gcp_project_id}`, { stdio: 'ignore' }); }
          catch (e) { try { execSync(`gcloud secrets create ${clientIdSecret} --replication-policy="automatic" --project=${config.gcp_project_id}`, { stdio: 'inherit' }); } catch (err) {} }
          execSync(`echo -n "${creds.client_id}" | gcloud secrets versions add ${clientIdSecret} --project=${config.gcp_project_id} --data-file=-`, { stdio: 'inherit' });

          console.log(`Configuring Secret Manager secret ${clientSecretSecret}...`);
          try { execSync(`gcloud secrets describe ${clientSecretSecret} --project=${config.gcp_project_id}`, { stdio: 'ignore' }); }
          catch (e) { try { execSync(`gcloud secrets create ${clientSecretSecret} --replication-policy="automatic" --project=${config.gcp_project_id}`, { stdio: 'inherit' }); } catch (err) {} }
          execSync(`echo -n "${creds.client_secret}" | gcloud secrets versions add ${clientSecretSecret} --project=${config.gcp_project_id} --data-file=-`, { stdio: 'inherit' });
        } else {
          console.log(`✅ Reusing existing Secret Manager secrets for host: ${host} (${clientIdSecret}, ${clientSecretSecret})`);
        }

        secretBindings.push(`${clientIdSecret}=${clientIdSecret}:latest`);
        secretBindings.push(`${clientSecretSecret}=${clientSecretSecret}:latest`);

        try {
          execSync(`gcloud secrets add-iam-policy-binding ${clientIdSecret} --member="serviceAccount:${defaultSa}" --role="roles/secretmanager.secretAccessor" --project=${config.gcp_project_id}`, { stdio: 'ignore' });
          execSync(`gcloud secrets add-iam-policy-binding ${clientSecretSecret} --member="serviceAccount:${defaultSa}" --role="roles/secretmanager.secretAccessor" --project=${config.gcp_project_id}`, { stdio: 'ignore' });
        } catch (e) {}
      }
    }
  } catch (smErr) {
    secretManagerError = smErr.message;
    console.warn(`⚠️ Warning: Secret Manager provisioning encountered an issue: ${smErr.message}`);
  }

  const primaryHost = (config.instances && config.instances.length > 0) ? config.instances[0].looker_host : config.looker_host;
  const primaryPort = (config.instances && config.instances.length > 0) ? config.instances[0].looker_port : config.looker_port;

  console.log(`\n🚀 Deploying Cloud Function: ${config.gcf_name} to region ${config.gcp_region}...`);
  const deployCommand = `gcloud functions deploy ${config.gcf_name} \\
    --gen2 \\
    --runtime=nodejs24 \\
    --region=${config.gcp_region} \\
    --trigger-http \\
    --allow-unauthenticated \\
    --entry-point=nanoAdminBackend \\
    --source=backend \\
    --set-env-vars="LOOKERSDK_BASE_URL=https://${primaryHost}:${primaryPort},BUILD_HASH=${localBuildHash}" \\
    --set-secrets="${secretBindings.join(',')}"`;

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
  sanitizeHostForSecret,
  loadLocalBuildHash,
  resolveGcfUrl,
  checkSecretsExistInGCP,
  scanExistingResources,
  deployGCF,
  deployExtensionToGCS
};
