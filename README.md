# Nano-Admin for Looker

This project contains a Looker Admin Extension (Frontend React app running in an iframe) and a Google Cloud Function (GCF Backend) running on Node.js to safely perform administrative Looker API operations on behalf of users.

---

## 🛠️ Prerequisites

Before getting started, make sure you have the following installed on your local system:
1. **Node.js (v18+) & npm**
2. **Google Cloud SDK (gcloud CLI)**: Installed and authenticated (`gcloud auth login`)
3. **Looker CLI (looker-cli)**: Used to manage Looker resources via command line

---

## 🚀 Deployment (Quick Start)

The project includes an automated deployment script that handles compiling code, provisioning resources in GCP (including Secret Manager), configuring Looker user attributes with whitelists, and preparing the frontend bundle.

To run the automated deployment:

```bash
npm run deploy
```

The script will:
* Check for all CLI prerequisites.
* Prompt you for Looker and GCP targets (saving them to `deploy-config.json` for reuse).
* Log you into Looker interactively via OAuth PKCE flow (if not already logged in).
* Provision new Looker API client credentials for your GCF backend.
* Upload credentials securely to **Google Cloud Secret Manager** (falling back to environment variables if Secret Manager is not accessible).
* Build and deploy the GCF backend function to Google Cloud.
* Automatically configure the Looker user attribute `nano_admin_admin_extension_nano_admin_challenge` with the correct domain whitelists.
* Update local configuration paths and compile the production bundle.

Once completed, follow the instructions printed at the end of the script to upload the compiled `extension/dist/bundle.js` and `extension/manifest.lkml` to your Looker project.

---

## 💻 Local Development Setup

To run both frontend and backend locally with automatic mockups and watch configuration:

1. **Install root dependencies:**
   ```bash
   npm install
   ```

2. **Start the local dev environment:**
   ```bash
   npm run dev
   ```
   This runs:
   * Webpack Dev Server serving the frontend over HTTPS at `https://localhost:8080/bundle.js`
   * Functions Framework local backend running at `http://localhost:8081`

3. **Self-signed Certificate Verification:**
   Visit `https://localhost:8080/bundle.js` once in your browser to accept the self-signed SSL certificate so Looker's iframe can load it.

4. **Authentication Fallback:**
   If Looker credentials are not configured locally via `backend/looker.ini` or environment variables, the backend runs in **mockup mode**, using dummy data for fast interface testing.

---

## 📂 Project Structure

```
.
├── extension/                 # Frontend Looker Extension (React & TypeScript)
│   ├── src/                   # React app layouts, router, and configurations
│   ├── webpack.config.js      # Webpack configuration (HTTPS, single bundle build)
│   ├── manifest.lkml          # Manifest definition for Looker Integration
│   └── tsconfig.json
│
├── backend/                   # Backend Google Cloud Function (Node.js & TypeScript)
│   ├── src/                   # GCF entry, API actions, and security validation
│   └── tsconfig.json
│
├── scripts/                   # Development and deployment scripts
│   ├── deploy.js              # Automated GCP and Looker provisioning script
│   └── generate-hash.js       # Sync hash builder to verify builds match
└── package.json               # Workspace configuration and launch scripts
```

---

## 🔒 Architecture & Design: Challenge-Response Flow

To maintain high security when performing administrative operations from an iframe, this project uses a secure cryptographic challenge-response authentication protocol:

```
 Looker Extension (Frontend)                   Looker API Server                 Cloud Function (Backend)
             |                                         |                                     |
             | -- 1. API Request with Challenge ------>| (Injects user attribute secret)     |
             |                                         | ----------------------------------->| (Verifies HMAC signature)
             |                                         |                                     |
             | <--- 2. 401 Unauthorized (Expired) <------------------------------------------| (Signature fails or expired)
             |                                         |                                     |
             |                                         | <--- 3. Refresh user attribute -----| (Generates new challenge;
             |                                         |         secret via Admin API        |  writes to Looker user database)
             |                                         |                                     |
             | -- 4. Retries request ----------------->| (Injects new user attribute secret) |
             |                                         | ----------------------------------->| (Validates HMAC signature)
             |                                         |                                     |
             | <--- 5. 200 OK (Authenticated Data) <-----------------------------------------| (Succeeds)
```

### 1. Header Injection
The frontend routes requests through Looker's server proxy with the header `X-Nano-Admin-Challenge: extensionSDK.createSecretKeyTag('nano_admin_challenge')`. Looker intercepts this and replaces the placeholder with the current user's actual `nano_admin_challenge` attribute value.

### 2. Validation & Refresh
The GCF backend verifies that the challenge timestamp is recent (within 2 minutes) and matches the signature generated using the secret `GCF_HMAC_SECRET`. If the challenge is invalid or expired:
* The backend generates a fresh challenge signature.
* Writes it directly to the user's `nano_admin_challenge` attribute in Looker via Looker's Node SDK.
* Returns `401 Unauthorized (challenge_required)`.

### 3. Automatic Retry
The frontend intercepts the `401` status code and transparently retries the request. In the retry, Looker injects the newly written user attribute, and the handshake succeeds.

---

## 🛠️ Manual Configuration (GCP and Looker)

If you prefer to configure components manually instead of using `npm run deploy`, complete these steps:

### GCP Secret Manager Setup
Create and configure these secrets in your project:
1. `LOOKERSDK_CLIENT_ID`: Your Looker API Client ID.
2. `LOOKERSDK_CLIENT_SECRET`: Your Looker API Client Secret.
3. `GCF_HMAC_SECRET`: A random 32-character hexadecimal string used to sign challenges.

### Manual Cloud Function Deployment
Run the following from the root directory:
```bash
gcloud functions deploy nano-admin-backend \
  --gen2 \
  --runtime=nodejs24 \
  --region=us-central1 \
  --trigger-http \
  --allow-unauthenticated \
  --entry-point=nanoAdminBackend \
  --source=backend \
  --set-env-vars="LOOKERSDK_BASE_URL=https://your-looker-instance.looker.app:443" \
  --set-secrets="LOOKERSDK_CLIENT_ID=LOOKERSDK_CLIENT_ID:latest,LOOKERSDK_CLIENT_SECRET=LOOKERSDK_CLIENT_SECRET:latest,GCF_HMAC_SECRET=GCF_HMAC_SECRET:latest"
```

### Manual Looker User Attribute Setup
Create the attribute in Looker under **Admin -> Users -> User Attributes**:
* **Name**: `nano_admin_admin_extension_nano_admin_challenge` (corresponds to Looker's `{project}_{app}_{attribute}` structure)
* **Label**: `Nano Admin Challenge`
* **Data Type**: `String`
* **User Access**: `View`
* **Hide Values**: `Yes`
* **Domain Whitelist**: Add `http://localhost:8081` (local) and your production GCF URL (production).
