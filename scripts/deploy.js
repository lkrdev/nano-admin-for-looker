const fs = require('fs');
const path = require('path');
const { execSync, spawn, spawnSync } = require('child_process');
const readline = require('readline');
const crypto = require('crypto');

const CONFIG_PATH = path.join(__dirname, '..', 'deploy-config.json');

// Helper to ask interactive questions
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

// Extract JSON safely from stdout in case of banners/warnings
function parseJsonFromStdout(stdout) {
  const startIdx = stdout.indexOf('{');
  const endIdx = stdout.lastIndexOf('}');
  if (startIdx === -1 || endIdx === -1) {
    throw new Error('No valid JSON object found in output:\n' + stdout);
  }
  return JSON.parse(stdout.substring(startIdx, endIdx + 1));
}

// Spawns a command and filters out noisy headless/Wayland/GPU browser errors from stderr
function runCommandFiltered(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['inherit', 'inherit', 'pipe'] });

    child.stderr.on('data', (data) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        const lower = line.toLowerCase();
        // Filter out Chromium, Wayland, GPU, DRM, Gtk, dbus, TensorFlow, XNNPACK noise
        if (
          lower.includes('wayland') ||
          lower.includes('ozone') ||
          lower.includes('drmgetdevices') ||
          lower.includes('gpu/ipc') ||
          lower.includes('contextresult') ||
          lower.includes('tensorflow') ||
          lower.includes('xnnpack') ||
          lower.includes('dbus') ||
          lower.includes('gtk') ||
          lower.includes('gl_') ||
          lower.includes('egl') ||
          lower.includes('chromium') ||
          lower.includes('error:ui') ||
          lower.includes('device_list_x11') ||
          !line.trim()
        ) {
          continue;
        }
        process.stderr.write(line + '\n');
      }
    });

    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed with code ${code}`));
    });
  });
}

function checkPrerequisites() {
  console.log('🔍 Checking prerequisites...');

  // 1. Node & NPM
  try {
    execSync('node --version', { stdio: 'ignore' });
    execSync('npm --version', { stdio: 'ignore' });
  } catch (e) {
    console.error('❌ Error: Node.js and npm are required but were not found.');
    console.error('Please install Node.js (v18+) and npm before running this script.');
    process.exit(1);
  }

  // 2. gcloud CLI
  try {
    execSync('gcloud --version', { stdio: 'ignore' });
  } catch (e) {
    console.error('❌ Error: Google Cloud CLI (gcloud) is required but was not found.');
    console.error('Please install the Google Cloud SDK: https://cloud.google.com/sdk/docs/install');
    process.exit(1);
  }

  // 3. looker-cli
  try {
    execSync('looker-cli version', { stdio: 'ignore' });
  } catch (e) {
    console.error('❌ Error: looker-cli is required but was not found in your PATH.');
    console.error('Please make sure looker-cli is installed and added to your PATH.');
    process.exit(1);
  }

  console.log('✅ All prerequisites met (Node/NPM, gcloud CLI, looker-cli).');
}

function loadConfig() {
  let config = {};
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch (e) {
      console.warn('⚠️ Warning: Failed to parse deploy-config.json. Starting fresh.');
    }
  }
  return config;
}

function saveConfig(config) {
  // Prevent any credentials from being saved to the config file
  const safeConfig = {
    looker_host: config.looker_host,
    looker_port: config.looker_port,
    looker_ssl: config.looker_ssl,
    gcp_project_id: config.gcp_project_id,
    gcp_region: config.gcp_region,
    gcf_name: config.gcf_name,
    gcs_bucket_name: config.gcs_bucket_name,
    looker_service_account: config.looker_service_account,
    looker_credential_method: config.looker_credential_method,
  };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(safeConfig, null, 2), 'utf8');
}

async function getLookerSaById(config, saId) {
  if (!saId) return null;
  try {
    const out = execSync(`looker-cli api user search_users --id="${saId}" --host=${config.looker_host} --port=${config.looker_port} --ssl=${config.looker_ssl}`, { encoding: 'utf8', stdio: 'pipe' });
    const users = JSON.parse(out);
    if (users && users.length > 0) return users[0];
  } catch (e) {}
  return null;
}

async function ensureLookerLoggedIn(config) {
  console.log('\n🔑 Checking Looker session status...');
  let loggedIn = false;
  let lookerUser = 'Unknown User';

  try {
    // Suppress stderr to hide CLI auth required message from user
    const userMeOutput = execSync(`looker-cli api user me --host=${config.looker_host} --port=${config.looker_port} --ssl=${config.looker_ssl}`, { encoding: 'utf8', stdio: 'pipe' });
    const userMe = parseJsonFromStdout(userMeOutput);
    lookerUser = `${userMe.display_name || userMe.first_name + ' ' + userMe.last_name} (${userMe.email})`;
    loggedIn = true;
  } catch (e) {
    console.log('Not authenticated with Looker. Initiating login via OAuth PKCE...');
    const loginArgs = ['session', 'login', '--oauth', `--host=${config.looker_host}`, `--port=${config.looker_port}`, `--ssl=${config.looker_ssl}`];
    
    // Spawn and filter Wayland/GPU errors in real-time
    await runCommandFiltered('looker-cli', loginArgs);

    try {
      const userMeOutput = execSync(`looker-cli api user me --host=${config.looker_host} --port=${config.looker_port} --ssl=${config.looker_ssl}`, { encoding: 'utf8', stdio: 'pipe' });
      const userMe = parseJsonFromStdout(userMeOutput);
      lookerUser = `${userMe.display_name || userMe.first_name + ' ' + userMe.last_name} (${userMe.email})`;
      loggedIn = true;
    } catch (meErr) {
      lookerUser = 'Authenticated (Details unavailable)';
      loggedIn = true;
    }
  }

  if (!loggedIn) {
    console.error('❌ Error: Could not authenticate with Looker.');
    process.exit(1);
  }

  return lookerUser;
}

async function getLookerCredentials(config, targetLookerSa, manualClientId, manualClientSecret) {
  let clientId = '';
  let clientSecret = '';

  console.log('\n🔐 Looker API Credentials Provisioning...');

  if (config.looker_credential_method === 'manual') {
    clientId = manualClientId;
    clientSecret = manualClientSecret;
    console.log('✅ Using manually entered API credentials.');
  } else {
    // Generate automatically via OAuth
    let targetSaId = '';
    
    if (targetLookerSa) {
      targetSaId = targetLookerSa.id;
      console.log(`Using existing Looker service account ID: ${targetSaId}`);
    } else {
      const saName = config.looker_service_account || 'Nano Admin Backend SA';
      console.log(`Creating new Looker service account: "${saName}"...`);
      try {
        const payload = JSON.stringify({ service_account_name: saName });
        const createOutput = execSync(`echo '${payload}' | looker-cli api user create_service_account - --host=${config.looker_host} --port=${config.looker_port} --ssl=${config.looker_ssl}`, { encoding: 'utf8', stdio: 'pipe' });
        const newSa = parseJsonFromStdout(createOutput);
        targetSaId = newSa.id;
        console.log(`✅ Successfully created Looker service account ID: ${targetSaId}`);
      } catch (createErr) {
        console.error('❌ Failed to create Looker service account:', createErr.message);
        process.exit(1);
      }
    }

    // Create API credentials for the Service Account
    console.log(`Generating API credentials for Looker service account ID ${targetSaId}...`);
    try {
      const credsOutput = execSync(`looker-cli api user create_user_credentials_api3 ${targetSaId} --host=${config.looker_host} --port=${config.looker_port} --ssl=${config.looker_ssl}`, { encoding: 'utf8', stdio: 'pipe' });
      const creds = parseJsonFromStdout(credsOutput);
      clientId = creds.client_id;
      clientSecret = creds.client_secret;
      console.log('✅ Successfully generated new API client ID & secret.');
      console.log('⚠️  IMPORTANT: Please make sure this service account has the Administrator role (or appropriate roles) assigned in Looker to perform required actions.');
    } catch (e) {
      console.error('❌ Failed to generate API credentials:', e.message);
      process.exit(1);
    }
  }

  return { clientId, clientSecret };
}

async function deployGCF(config, lookerCreds) {
  console.log('\n☁️ Setting up Google Cloud deployment...');

  // Set target project
  console.log(`Setting active GCP project to ${config.gcp_project_id}...`);
  execSync(`gcloud config set project ${config.gcp_project_id}`, { stdio: 'inherit' });

  // Try to enable required services
  console.log('Enabling required Google Cloud APIs (Function, Secret Manager, Cloud Build)...');
  try {
    execSync('gcloud services enable cloudfunctions.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com', { stdio: 'inherit' });
  } catch (e) {
    console.warn('⚠️ Warning: Failed to enable services automatically. Make sure they are enabled in your GCP project.');
  }

  // Determine default Compute Engine service account to grant Secret Accessor permission
  const projectNumber = execSync(`gcloud projects describe ${config.gcp_project_id} --format="value(projectNumber)"`, { encoding: 'utf8' }).trim();
  const defaultSa = `${projectNumber}-compute@developer.gserviceaccount.com`;
  console.log(`Default Compute Engine service account: ${defaultSa}`);

  let useSecretManager = true;
  try {
    execSync('gcloud secrets list --limit=1', { stdio: 'ignore' });
  } catch (e) {
    console.warn('⚠️ Warning: Secret Manager API is not enabled or you do not have permission. Falling back to environment variables.');
    useSecretManager = false;
  }

  let deployCommand = '';

  if (useSecretManager) {
    // Provision GCF HMAC Secret
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

    // Provision Looker Client ID and Secret if they were provided (not reused)
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

    // Grant Secret Accessor permissions to the default Compute Engine Service Account
    console.log(`Granting Secret Accessor permission to default Compute Service Account: ${defaultSa}...`);
    try {
      execSync(`gcloud secrets add-iam-policy-binding GCF_HMAC_SECRET --member="serviceAccount:${defaultSa}" --role="roles/secretmanager.secretAccessor" --project=${config.gcp_project_id}`, { stdio: 'ignore' });
      execSync(`gcloud secrets add-iam-policy-binding LOOKERSDK_CLIENT_ID --member="serviceAccount:${defaultSa}" --role="roles/secretmanager.secretAccessor" --project=${config.gcp_project_id}`, { stdio: 'ignore' });
      execSync(`gcloud secrets add-iam-policy-binding LOOKERSDK_CLIENT_SECRET --member="serviceAccount:${defaultSa}" --role="roles/secretmanager.secretAccessor" --project=${config.gcp_project_id}`, { stdio: 'ignore' });
    } catch (e) {
      console.warn('⚠️ Warning: Failed to grant Secret Accessor permission automatically. Make sure the default compute service account has roles/secretmanager.secretAccessor role.');
    }

    // Compile backend TypeScript code
    console.log('\n📦 Compiling backend TypeScript code...');
    execSync('npm run backend:build', { stdio: 'inherit' });

    console.log(`\n🚀 Deploying Cloud Function: ${config.gcf_name} to region ${config.gcp_region}...`);
    deployCommand = `gcloud functions deploy ${config.gcf_name} \\
      --gen2 \\
      --runtime=nodejs24 \\
      --region=${config.gcp_region} \\
      --trigger-http \\
      --allow-unauthenticated \\
      --entry-point=nanoAdminBackend \\
      --source=backend \\
      --set-env-vars="LOOKERSDK_BASE_URL=https://${config.looker_host}:${config.looker_port}" \\
      --set-secrets="LOOKERSDK_CLIENT_ID=LOOKERSDK_CLIENT_ID:latest,LOOKERSDK_CLIENT_SECRET=LOOKERSDK_CLIENT_SECRET:latest,GCF_HMAC_SECRET=GCF_HMAC_SECRET:latest"`;
  } else {
    // Fallback to environment variables
    if (!lookerCreds) {
      console.error('❌ Error: Looker credentials are required for environment variables fallback but were not provided/found.');
      process.exit(1);
    }
    const hmacSecret = crypto.randomBytes(32).toString('hex');
    console.log('\n📦 Compiling backend TypeScript code...');
    execSync('npm run backend:build', { stdio: 'inherit' });

    console.log(`\n🚀 Deploying Cloud Function (fallback env vars): ${config.gcf_name} to region ${config.gcp_region}...`);
    deployCommand = `gcloud functions deploy ${config.gcf_name} \\
      --gen2 \\
      --runtime=nodejs24 \\
      --region=${config.gcp_region} \\
      --trigger-http \\
      --allow-unauthenticated \\
      --entry-point=nanoAdminBackend \\
      --source=backend \\
      --set-env-vars="LOOKERSDK_BASE_URL=https://${config.looker_host}:${config.looker_port},LOOKERSDK_CLIENT_ID=${lookerCreds.clientId},LOOKERSDK_CLIENT_SECRET=${lookerCreds.clientSecret},GCF_HMAC_SECRET=${hmacSecret}"`;
  }

  console.log(`Running deploy command:\n${deployCommand}\n`);
  execSync(deployCommand, { stdio: 'inherit' });

  // Get the GCF URL
  console.log('Retrieving deployed Cloud Function URL...');
  const gcfUrl = execSync(`gcloud functions describe ${config.gcf_name} --region=${config.gcp_region} --format="value(serviceConfig.uri)"`, { encoding: 'utf8' }).trim();
  console.log(`\n✅ Cloud Function deployed successfully at: ${gcfUrl}`);
  return gcfUrl;
}

function updateLocalConfigs(gcfUrl, publicUrl) {
  console.log('\n🔄 Updating local configurations...');

  // 1. Update extension/src/config.ts
  const configPath = path.join(__dirname, '..', 'extension', 'src', 'config.ts');
  const configContent = `// This file is auto-generated by scripts/deploy.js. Do not edit directly if you want changes to persist.
export const BACKEND_URL = '${gcfUrl}';
export const PUBLIC_PATH = '${publicUrl}';
`;
  fs.writeFileSync(configPath, configContent, 'utf8');
  console.log(`📝 Updated ${configPath} with GCF backend URL and GCS Public Path.`);

  // 2. Update extension/manifest.lkml for production
  const manifestPath = path.join(__dirname, '..', 'extension', 'manifest.lkml');
  if (fs.existsSync(manifestPath)) {
    let manifest = fs.readFileSync(manifestPath, 'utf8');
    const gcsBundleUrl = `${publicUrl}bundle.js`;

    // Reset any local file reference and replace/set the url parameter
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

    // Commented lines cleanup
    manifest = manifest.replace(/#\s*url:\s*".*?"\n/g, '');

    // Update external_api_urls to include both GCF URL and GCS domain
    const requiredUrls = [`"${gcfUrl}"`, `"https://storage.googleapis.com"`];
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
    console.log(`📝 Updated ${manifestPath} for GCS production hosting.`);
  }

  // 3. Compile extension bundle
  console.log('\n📦 Compiling extension React bundle...');
  execSync('npm run extension:build', { stdio: 'inherit' });
  console.log('✅ Compiled extension React bundle successfully.');
}

async function deployExtensionToGCS(config) {
  const bucketName = config.gcs_bucket_name;
  console.log(`\n🪣 Configuring Google Cloud Storage Bucket: gs://${bucketName}...`);

  // Create bucket if it doesn't exist
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

  // Grant public read permission to the bucket so browser can load the bundle & chunks
  console.log(`Setting public read access on bucket gs://${bucketName}...`);
  try {
    execSync(`gcloud storage buckets add-iam-policy-binding gs://${bucketName} --member=allUsers --role=roles/storage.objectViewer --project=${config.gcp_project_id}`, { stdio: 'ignore' });
    console.log(`✅ Granted public read access to allUsers.`);
  } catch (iamErr) {
    console.warn(`⚠️ Warning: Failed to automatically set public read access. Ensure publicAccessPrevention is not enforced or configure the bucket policy manually.`);
  }

  // Apply CORS configuration to allow Looker's origin
  console.log(`Configuring CORS policy on bucket gs://${bucketName} for Looker origin...`);
  const corsPath = path.join(__dirname, '..', 'gcs-cors.json');
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

  // Sync dist folder to GCS bucket
  console.log(`Uploading extension assets to gs://${bucketName}...`);
  try {
    execSync(`gcloud storage cp -r extension/dist/* gs://${bucketName}/ --project=${config.gcp_project_id}`, { stdio: 'inherit' });
    console.log(`✅ Successfully uploaded extension assets to GCS.`);
  } catch (uploadErr) {
    console.error(`❌ Failed to upload extension assets to GCS: ${uploadErr.message}`);
    process.exit(1);
  }

  const publicUrl = `https://storage.googleapis.com/${bucketName}/`;
  console.log(`🌍 Extension assets publicly accessible at: ${publicUrl}`);
  return publicUrl;
}

async function configureLookerAttribute(config, gcfUrl) {
  console.log('\n⚙️ Configuring Looker user attribute for secure challenge-response...');

  const allowlist = `http://localhost:8081,https://localhost:8081,${gcfUrl}`;
  const attrName = 'nano_admin_admin_extension_nano_admin_challenge';

  console.log(`Creating/Updating user attribute "${attrName}" with domain whitelist:`);
  console.log(`👉 ${allowlist}`);

  try {
    const cmd = `looker-cli attribute create ${attrName} "Nano Admin Challenge" --is-hidden --type=string --domain-allowlist="${allowlist}" --force --host=${config.looker_host} --port=${config.looker_port} --ssl=${config.looker_ssl}`;
    execSync(cmd, { stdio: 'inherit' });
    console.log('✅ Successfully configured Looker user attribute.');
  } catch (e) {
    console.error('❌ Failed to configure Looker user attribute automatically via CLI:', e.message);
    console.log('Please make sure you are logged in to Looker via looker-cli and try again, or manually configure the attribute in Looker.');
  }
}

async function main() {
  console.log('====================================================');
  console.log('🚀 Nano-Admin for Looker Deployment Script 🚀');
  console.log('====================================================');
  console.log('Welcome! You will be guided through configuring your target settings.');
  console.log('NOTE: No changes will be applied to your Looker instance or GCP project');
  console.log('until you have reviewed and confirmed the final deployment preview.');
  console.log('====================================================\n');

  checkPrerequisites();

  const config = loadConfig();

  // Phase 1: Looker Connection Configuration
  console.log('⚙️ Connecting to Looker...');
  config.looker_host = config.looker_host || await askQuestion('Enter Looker API Host (e.g. your-instance.looker.app): ');
  if (!config.looker_host) {
    console.error('❌ Error: Looker Host is required.');
    process.exit(1);
  }
  const portInput = await askQuestion(`Enter Looker API Port [${config.looker_port || '443'}]: `);
  config.looker_port = portInput || config.looker_port || '443';
  const sslInput = await askQuestion(`Use SSL (HTTPS)? (Y/n): `);
  config.looker_ssl = sslInput.toLowerCase() !== 'n';

  // Phase 2: Log into Looker (required BEFORE we can scan service accounts)
  const lookerUser = await ensureLookerLoggedIn(config);

  // Phase 3: Eagerly Scan for Looker Service Accounts containing 'nano' and 'admin'
  console.log('\n🔎 Eagerly scanning Looker for matching service accounts...');
  let matchedSAs = [];
  try {
    const out = execSync(`looker-cli api user search_users --is_service_account=true --host=${config.looker_host} --port=${config.looker_port} --ssl=${config.looker_ssl}`, { encoding: 'utf8', stdio: 'pipe' });
    const users = JSON.parse(out);
    if (users && users.length > 0) {
      matchedSAs = users.filter((u) => {
        const name = ((u.first_name || '') + ' ' + (u.last_name || '')).toLowerCase();
        const email = (u.email || '').toLowerCase();
        return (
          (name.includes('nano') && name.includes('admin')) ||
          (email.includes('nano') && email.includes('admin'))
        );
      });
    }
  } catch (e) {
    console.warn('⚠️ Warning: Failed to scan Looker service accounts automatically.');
  }

  if (matchedSAs.length > 0) {
    console.log('\nFound the following matching Looker service accounts (containing "nano" and "admin"):');
    matchedSAs.forEach((u, index) => {
      const fullName = ((u.first_name || '') + ' ' + (u.last_name || '')).trim();
      console.log(`  ID: ${u.id} - Name: ${fullName} (Email: ${u.email || 'None'})`);
    });
  } else {
    console.log('\nNo existing Looker service accounts found containing both "nano" and "admin".');
  }

  // Phase 4: Service Account & Credentials Options
  const saInput = await askQuestion(`\nEnter the Looker Service Account ID to use (leave blank to create 'Nano Admin Backend SA'): `);
  config.looker_service_account = saInput || '';

  const credMethodInput = await askQuestion('\nHow should Looker API credentials for GCF be supplied?\n  1 = Generate automatically via OAuth\n  2 = Enter manually\nChoose option [1]: ');
  
  let manualClientId = '';
  let manualClientSecret = '';
  if (credMethodInput === '2') {
    config.looker_credential_method = 'manual';
    manualClientId = await askQuestion('Enter Looker API Client ID: ');
    manualClientSecret = await askQuestion('Enter Looker API Client Secret: ');
    if (!manualClientId || !manualClientSecret) {
      console.error('❌ Error: Both Client ID and Client Secret are required for manual mode.');
      process.exit(1);
    }
  } else {
    config.looker_credential_method = 'generate';
  }

  // Phase 5: GCP and remaining configurations
  console.log('\n⚙️ Configuring GCP settings...');
  config.gcp_project_id = config.gcp_project_id || await askQuestion('Enter GCP Project ID: ');
  if (!config.gcp_project_id) {
    console.error('❌ Error: GCP Project ID is required.');
    process.exit(1);
  }
  const regionInput = await askQuestion(`Enter GCP Region [${config.gcp_region || 'us-central1'}]: `);
  config.gcp_region = regionInput || config.gcp_region || 'us-central1';

  const gcfNameInput = await askQuestion(`Enter Cloud Function Name [${config.gcf_name || 'nano-admin-backend'}]: `);
  config.gcf_name = gcfNameInput || config.gcf_name || 'nano-admin-backend';

  const bucketInput = await askQuestion(`Enter GCS Bucket Name to host extension assets [${config.gcs_bucket_name || config.gcp_project_id + '-nano-admin-extension'}]: `);
  config.gcs_bucket_name = bucketInput || config.gcs_bucket_name || `${config.gcp_project_id}-nano-admin-extension`;

  saveConfig(config);
  console.log('✅ Configuration saved to deploy-config.json (sensitive data omitted).');

  // Retrieve active GCP account
  let gcpAccount = 'Unknown Account';
  try {
    gcpAccount = execSync('gcloud config get-value account', { encoding: 'utf8' }).trim();
  } catch (e) {}

  // Determine Looker Service Account status for review page
  console.log('\n🔎 Scanning Looker to verify target service account...');
  let lookerSaStatus = 'Create new service account';
  let targetLookerSa = null;
  const targetLookerSaName = config.looker_service_account || 'Nano Admin Backend SA';

  if (config.looker_service_account) {
    targetLookerSa = await getLookerSaById(config, config.looker_service_account);
    if (targetLookerSa) {
      const fullName = ((targetLookerSa.first_name || '') + ' ' + (targetLookerSa.last_name || '')).trim();
      lookerSaStatus = `Reuse existing service account: ${fullName} (ID: ${targetLookerSa.id})`;
    } else {
      lookerSaStatus = `Create new dedicated service account with ID/Name: "${config.looker_service_account}"`;
    }
  } else {
    lookerSaStatus = `Create new dedicated service account: "Nano Admin Backend SA"`;
  }

  // Check existing GCP objects to see what will be overwritten
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

  // Display the Review and Confirm page
  console.log('\n======================================================');
  console.log('🔎 PREVIEW OF PENDING CHANGES');
  console.log('======================================================');
  console.log('Please review the active sessions and target configuration below:');
  console.log('\nTarget Configurations:');
  console.log(`  • Looker Host:            ${config.looker_host}:${config.looker_port} (SSL: ${config.looker_ssl})`);
  console.log(`  • Looker Service Account:   ${targetLookerSa ? ((targetLookerSa.first_name || '') + ' ' + (targetLookerSa.last_name || '')).trim() + ' (ID: ' + targetLookerSa.id + ')' : targetLookerSaName}`);
  console.log(`  • Looker Credentials:     ${config.looker_credential_method === 'generate' ? 'Generate automatically via OAuth' : 'Manually entered credentials'}`);
  console.log(`  • GCP Project ID:         ${config.gcp_project_id}`);
  console.log(`  • GCP Region:             ${config.gcp_region}`);
  console.log(`  • Cloud Function Name:    ${config.gcf_name}`);
  console.log('\nActive Sessions (used to apply changes):');
  console.log(`  • Active GCP Account:     ${gcpAccount}`);
  console.log(`  • Active Looker User:     ${lookerUser}`);
  console.log('\nDeployment Actions & Resource Overwrites:');
  console.log('  [✓] Compile & package extension (will overwrite extension/src/config.ts & manifest.lkml)');
  console.log('  [✓] Compile backend TypeScript code');
  console.log(`  [ ] Looker Service Account Configuration:`);
  console.log(`      └─ Action: [${lookerSaStatus}]`);
  console.log(`  [ ] Deploy Google Cloud Function:`);
  console.log(`      └─ Status: ${config.gcf_name} will be [${functionExists ? 'OVERWRITTEN / RE-DEPLOYED' : 'NEWLY CREATED'}]`);
  console.log(`  [ ] Secret Manager Provisioning & IAM Setup:`);
  console.log(`      ├─ LOOKERSDK_CLIENT_ID:     [${secretClientIdExists ? 'UPDATED (NEW VERSION ADDED)' : 'NEWLY CREATED'}]`);
  console.log(`      ├─ LOOKERSDK_CLIENT_SECRET: [${secretClientSecretExists ? 'UPDATED (NEW VERSION ADDED)' : 'NEWLY CREATED'}]`);
  console.log(`      ├─ GCF_HMAC_SECRET:         [${secretHmacExists ? 'REUSED (UNTOUCHED)' : 'NEWLY CREATED'}]`);
  console.log(`      └─ Secret Accessor Role:    [GRANT ACCESS TO DEFAULT GCP COMPUTE SERVICE ACCOUNT]`);
  console.log(`  [ ] Looker User Attribute:`);
  console.log(`      └─ nano_admin_admin_extension_nano_admin_challenge: [${attributeExists ? 'FORCE-UPDATED (OVERWRITTEN)' : 'NEWLY CREATED'}]`);
  console.log('======================================================');

  const confirm = (await askQuestion('\nAre you sure you want to proceed with these changes? (y/N): ')).toLowerCase();
  if (confirm !== 'y' && confirm !== 'yes') {
    console.log('\n❌ Deployment cancelled. No changes were applied.');
    process.exit(0);
  }

  console.log('\n🚀 Starting deployment operations...');

  const lookerCreds = await getLookerCredentials(config, targetLookerSa, manualClientId, manualClientSecret);
  const gcfUrl = await deployGCF(config, lookerCreds);

  const publicUrl = `https://storage.googleapis.com/${config.gcs_bucket_name}/`;
  updateLocalConfigs(gcfUrl, publicUrl);

  await deployExtensionToGCS(config);

  await configureLookerAttribute(config, gcfUrl);

  const manifestPath = path.join(__dirname, '..', 'extension', 'manifest.lkml');
  let manifestContent = '';
  if (fs.existsSync(manifestPath)) {
    manifestContent = fs.readFileSync(manifestPath, 'utf8');
  }

  console.log('\n🎉 Deployment and setup completed successfully! 🎉');
  console.log('----------------------------------------------------');
  console.log('Next Steps:');
  console.log('1. Open your Looker project in Looker (Development Mode).');
  console.log('2. Edit or create your "manifest.lkml" file and replace its content with the following:');
  console.log('\n----------------- COPY FROM HERE -----------------');
  console.log(manifestContent || 'manifest.lkml content could not be read.');
  console.log('------------------ COPY TO HERE ------------------\n');
  console.log('3. Commit and push these manifest changes to your Looker project repository (or merge in Github).');
  console.log('4. Confirm that model configurations in your Looker instance are set up to grant access to the extension.');
  console.log('5. Open Looker, load the Nano Admin extension, and test the functionality.');
  console.log('----------------------------------------------------');
}

main().catch((err) => {
  console.error('\n💥 Deployment failed:', err);
  process.exit(1);
});
