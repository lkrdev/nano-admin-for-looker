const { execSync, spawn } = require('child_process');
const { askQuestion } = require('./ui');

function parseJsonFromStdout(stdout) {
  const lines = stdout.split('\n');
  const jsonStartIndex = lines.findIndex(l => {
    const trimmed = l.trim();
    return trimmed.startsWith('{') || (trimmed.startsWith('[') && !trimmed.startsWith('[command]'));
  });

  if (jsonStartIndex !== -1) {
    const jsonText = lines.slice(jsonStartIndex).join('\n').trim();
    try {
      return JSON.parse(jsonText);
    } catch (e) {
      const match = jsonText.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
      if (match) {
        try {
          return JSON.parse(match[0]);
        } catch (e2) {}
      }
    }
  }

  const match = stdout.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
  if (!match) {
    throw new Error('No valid JSON object or array found in output:\n' + stdout);
  }
  return JSON.parse(match[0]);
}

function runCommandFiltered(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['inherit', 'inherit', 'pipe'] });

    child.stderr.on('data', (data) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        const lower = line.toLowerCase();
        if (
          lower.includes('wayland') ||
          lower.includes('ozone') ||
          lower.includes('drmgetdevices') ||
          lower.includes('gpu/ipc') ||
          lower.includes('mesa')
        ) {
          continue;
        }
        process.stderr.write(line + '\n');
      }
    });

    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command ${cmd} exited with code ${code}`));
    });
  });
}

async function checkGCPAuth() {
  console.log('🔑 Checking Google Cloud session status...');
  let authenticated = false;

  while (!authenticated) {
    try {
      execSync('gcloud auth print-access-token', { stdio: 'pipe' });
      authenticated = true;
      console.log('✅ Google Cloud session is active and valid.');
    } catch (err) {
      console.log('\n⚠️  Google Cloud SDK authentication is missing or expired.');
      console.log('To avoid interactive password prompts in this script, please open a separate terminal and run:');
      console.log('    gcloud auth login');
      console.log('\nOnce authenticated, return here to continue.');
      
      const response = await askQuestion('\nPress [Enter] to retry authentication check, or "q" to quit: ');
      if (response.toLowerCase() === 'q') {
        console.log('❌ Deployment aborted.');
        process.exit(1);
      }
    }
  }
}

const fs = require('fs');
const path = require('path');

function validateLocalTooling() {
  console.log('🔍 Phase 1: Validating local tooling (fast local checks)...');

  try {
    execSync('node --version', { stdio: 'ignore' });
    execSync('npm --version', { stdio: 'ignore' });
  } catch (e) {
    console.error('❌ Error: Node.js and npm are required but were not found.');
    console.error('Please install Node.js (v18+) and npm before running this script.');
    process.exit(1);
  }

  try {
    execSync('gcloud --version', { stdio: 'ignore' });
  } catch (e) {
    console.error('❌ Error: Google Cloud CLI (gcloud) is required but was not found.');
    console.error('Please install the Google Cloud SDK: https://cloud.google.com/sdk/docs/install');
    process.exit(1);
  }

  try {
    execSync('looker-cli version', { stdio: 'ignore' });
  } catch (e) {
    console.error('❌ Error: looker-cli is required but was not found in your PATH.');
    console.error('Please make sure looker-cli is installed and added to your PATH.');
    process.exit(1);
  }

  const rootNodeModules = path.join(__dirname, '..', '..', 'node_modules');
  const backendNodeModules = path.join(__dirname, '..', '..', 'backend', 'node_modules');
  const extensionNodeModules = path.join(__dirname, '..', '..', 'extension', 'node_modules');

  if (!fs.existsSync(rootNodeModules) || !fs.existsSync(backendNodeModules) || !fs.existsSync(extensionNodeModules)) {
    console.error('❌ Error: Required npm dependencies are missing.');
    console.error('Please run "npm install" and "npm install --prefix backend" first before running the deployment script.');
    process.exit(1);
  }

  console.log('✅ Local tooling check passed (Node/NPM, gcloud CLI, looker-cli, local node_modules).');
}

async function checkPrerequisites() {
  validateLocalTooling();
  await checkGCPAuth();
}

async function ensureLookerLoggedIn(connectionConfig) {
  console.log(`\n🔑 Checking Looker session status for host ${connectionConfig.looker_host}...`);
  let loggedIn = false;
  let lookerUser = 'Unknown User';

  try {
    const userMeOutput = execSync(`looker-cli api user me --host=${connectionConfig.looker_host} --port=${connectionConfig.looker_port} --ssl=${connectionConfig.looker_ssl}`, { encoding: 'utf8', stdio: 'pipe' });
    const userMe = parseJsonFromStdout(userMeOutput);
    lookerUser = `${userMe.display_name || userMe.first_name + ' ' + userMe.last_name} (${userMe.email})`;
    loggedIn = true;
  } catch (e) {
    console.log(`Not authenticated with Looker host ${connectionConfig.looker_host}. Initiating login via OAuth PKCE...`);
    const loginArgs = ['session', 'login', '--oauth', `--host=${connectionConfig.looker_host}`, `--port=${connectionConfig.looker_port}`, `--ssl=${connectionConfig.looker_ssl}`];
    
    await runCommandFiltered('looker-cli', loginArgs);

    try {
      const userMeOutput = execSync(`looker-cli api user me --host=${connectionConfig.looker_host} --port=${connectionConfig.looker_port} --ssl=${connectionConfig.looker_ssl}`, { encoding: 'utf8', stdio: 'pipe' });
      const userMe = parseJsonFromStdout(userMeOutput);
      lookerUser = `${userMe.display_name || userMe.first_name + ' ' + userMe.last_name} (${userMe.email})`;
      loggedIn = true;
    } catch (meErr) {
      lookerUser = 'Authenticated (Details unavailable)';
      loggedIn = true;
    }
  }

  if (!loggedIn) {
    console.error(`❌ Error: Could not authenticate with Looker host ${connectionConfig.looker_host}.`);
    process.exit(1);
  }

  return lookerUser;
}

module.exports = {
  parseJsonFromStdout,
  runCommandFiltered,
  validateLocalTooling,
  checkGCPAuth,
  checkPrerequisites,
  ensureLookerLoggedIn
};
