const fs = require('fs');
const path = require('path');

const LOG_FILE_PATH = path.join(__dirname, '..', '..', 'deploy.log');

function logDeployStep(stepName, details) {
  try {
    const timestamp = new Date().toISOString();
    let logLine = `[${timestamp}] [DEPLOY] ${stepName}`;
    if (details !== undefined && details !== null) {
      if (typeof details === 'object') {
        const sanitized = { ...details };
        if (sanitized.clientSecret) sanitized.clientSecret = '[REDACTED]';
        if (sanitized.looker_client_secret) sanitized.looker_client_secret = '[REDACTED]';
        if (sanitized.manual_client_secret) sanitized.manual_client_secret = '[REDACTED]';
        logLine += `\n  Details: ${JSON.stringify(sanitized, null, 2).replace(/\n/g, '\n  ')}`;
      } else {
        logLine += ` - ${details}`;
      }
    }
    fs.appendFileSync(LOG_FILE_PATH, logLine + '\n', 'utf8');
  } catch (err) {
    // Non-blocking log failure handling
  }
}

module.exports = {
  logDeployStep
};
