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

The project includes an automated deployment script that handles compiling code, provisioning resources in GCP (including Secret Manager), configuring per-instance Looker authentication (`Server Proxy` user attributes or `OAuth 2.0` client registration), and preparing the frontend bundle.

To run the automated deployment:

```bash
npm run deploy
```

The script will:
* Check for all CLI prerequisites.
* Prompt you for GCP and Looker instance targets, including each instance's authentication mode (`Server Proxy` or `OAuth 2.0`), saving them to `deploy-config.json` for reuse.
* Log you into Looker interactively via OAuth PKCE flow (if not already logged in).
* Provision Looker API service account credentials for your GCF backend and upload them securely to **Google Cloud Secret Manager**.
* Build and deploy the GCF backend function to Google Cloud.
* Automatically configure either the Looker user attribute `nano_admin_admin_extension_nano_admin_challenge` (for `Server Proxy` mode) or the Looker OAuth client application `nano_admin_oauth_client` (for `OAuth 2.0` mode).
* Update `extension/manifest.lkml`, compile the production frontend bundle, and upload static assets to Google Cloud Storage.

Once completed, follow the instructions printed at the end of the script to deploy `extension/manifest.lkml` and `index.md` to your Looker project.

---

## 📂 Project Structure

```
.
├── extension/                 # Frontend Looker Extension (React & TypeScript)
│   ├── src/                   # React app layouts, transport client, and configurations
│   ├── webpack.config.js      # Webpack configuration (single bundle build)
│   ├── manifest.lkml          # Manifest definition for Looker Integration
│   └── tsconfig.json
│
├── backend/                   # Backend Google Cloud Function (Node.js & TypeScript)
│   ├── src/                   # GCF entry, OAuth & challenge auth, and workflow actions
│   └── tsconfig.json
│
├── scripts/                   # Development and deployment scripts
│   ├── deploy.js              # Automated GCP and Looker provisioning script
│   └── generate-hash.js       # Sync hash builder to verify builds match
└── package.json               # Workspace configuration and launch scripts
```

---

## 🔒 Architecture & Authentication Modes

Nano-Admin supports two authentication modes that can be configured per Looker instance during deployment (`auth_mode: "server_proxy"` or `auth_mode: "oauth"`).

### Choosing an Authentication Mode (Public vs. Private/Hybrid IP Context)

* **Server Proxy Mode (`server_proxy`)**: Uses Looker's `extensionSDK.serverProxy` with a hidden user attribute HMAC challenge (`nano_admin_challenge`). It is completely transparent to end users (no sign-in prompt or popup). However, Looker's application server blocks `serverProxy` egress when a Looker instance is configured with Private IP / Hybrid networking (such as Private Service Connect or internal IP ranges).
* **OAuth 2.0 Mode (`oauth`)**: Uses the Looker Extension Framework's OAuth 2.0 PKCE flow (`extensionSDK.oauth2Authenticate` and `extensionSDK.oauth2ExchangeCodeForToken`) combined with `extensionSDK.fetchProxy` directly from the user's browser to the Cloud Function backend.
  * **Why Private/Hybrid IP instances use OAuth 2.0**: Because `fetchProxy` runs from the user's browser rather than through Looker's server-side proxy, it bypasses Looker's internal-IP `serverProxy` block. Note that while `OAuth 2.0` is necessary for Private/Hybrid IP instances today, this coupling is only due to Looker's current `serverProxy` egress limitation—Public IP instances can also use `OAuth 2.0` mode, and Private/Hybrid IP instances could use `Server Proxy` mode if Looker lifts that limitation in the future.

### Cloud Function Ingress Settings (`gcf_ingress_settings`)

During deployment, `npm run deploy` prompts for the Cloud Function's `--ingress-settings` value (`all`, `internal-and-gclb`, or `internal-only`) and saves it as `gcf_ingress_settings` in `deploy-config.json`.

**When you must set ingress to `all` (`ALLOW_ALL`):**
* **OAuth 2.0 Mode (`oauth`)**: In OAuth mode, the user's browser directly navigates to `GET /oauth/authorize` and invokes `POST /oauth/token` and `POST /` via `extensionSDK.fetchProxy`. Because those requests originate from end-user browsers rather than an internal GCP VPC, Cloud Function ingress **must** be set to `all` (unless you front the Cloud Function with an external Google Cloud Load Balancer or route user browser traffic through an internal VPC proxy). If ingress is restricted to `internal-and-gclb` or `internal-only` without a load balancer/VPC path from the browser, Google Frontend will block the requests with a `404 Not Found` page.
* **Server Proxy Mode (`server_proxy`) on Public IP Looker Instances**: In `server_proxy` mode, requests originate from the Looker application server. If the Looker server reaches the Cloud Function over the public internet (rather than through a shared VPC / VPC Service Controls perimeter or Cloud Load Balancer), ingress must also be set to `all`.

---

### Mode 1: Server Proxy Challenge-Response Flow (`server_proxy`)

When configured for `server_proxy`, the extension authenticates requests without user interaction using a cryptographic challenge-response protocol:

```
 Looker Extension (Frontend)                   Looker API Server                 Cloud Function (Backend)
             |                                         |                                     |
             | -- 1. API Request with Challenge ------>| (Injects user attribute secret)     |
             |                                         | ----------------------------------->| (Verifies HMAC signature)
             |                                         |                                     |
             |                                         | <--- 2. Refresh user attribute -----| (Signature fails or expired;
             |                                         |         secret via Admin API        |  generates new challenge token
             |                                         |                                     |  & writes to Looker database)
             | <--- 3. 401 Unauthorized (Challenge) <---------------------------------------| 
             |                                         |                                     |
             | -- 4. Retries request ----------------->| (Injects newly provisioned secret)  |
             |                                         | ----------------------------------->| (Validates HMAC signature)
             |                                         |                                     |
             | <--- 5. 200 OK (Authenticated Data) <-----------------------------------------| (Succeeds)
```

1. **Header Injection**: The frontend routes requests through Looker's server proxy with the header `Authorization: looker-attribute-challenge extensionSDK.createSecretKeyTag('nano_admin_challenge')`. Looker replaces the placeholder with the current user's `nano_admin_challenge` attribute value.
2. **Validation & Refresh Handshake**: The backend verifies that the challenge timestamp is within the 8-hour window and matches the `GCF_HMAC_SECRET` signature. If missing or expired, the backend writes a fresh challenge token to the user's `nano_admin_challenge` attribute via the Looker SDK and returns `401 Unauthorized`.
3. **Transparent Retry**: The frontend intercepts the `401` response and transparently retries the request, which now succeeds with the newly injected user attribute value.

---

### Mode 2: OAuth 2.0 PKCE Flow (`oauth`)

When configured for `oauth`, the extension authenticates the user against the Looker instance itself using OAuth 2.0 PKCE:

1. **OAuth Client Registration**: The deployment script registers an OAuth client (`nano_admin_oauth_client`) on the Looker instance with `redirect_uri: https://<looker-host>/extensions/oauth2_redirect`.
2. **Backend-Mediated PKCE Handshake**: Because the Looker Extension Framework blocks `oauth2Authenticate` and `oauth2ExchangeCodeForToken` calls that directly target the same origin as the Looker host, the extension initiates the flow against the Cloud Function backend:
   * `GET /oauth/authorize`: Validates the target Looker instance against `LOOKER_ALLOWED_INSTANCES` and responds with `302 Redirect` to `https://<looker-host>/auth?...`, where the user authorizes the session and Looker redirects back to `/extensions/oauth2_redirect`.
   * `POST /oauth/token`: Receives the PKCE `code` and `code_verifier` from `extensionSDK.oauth2ExchangeCodeForToken` and proxies the token exchange server-to-server to `https://<looker-host>/api/token`.
3. **Bearer Token Verification**: The frontend caches the resulting token in `localStorage` and sends `Authorization: Bearer <access_token>` via `extensionSDK.fetchProxy`. The backend verifies the token against `https://<looker-host>/api/4.0/user?fields=id` (caching verified token hashes for 15 minutes) and ensures the authenticated Looker user ID matches `X-Looker-User-ID`.

---

## 🛠️ Manual Configuration (GCP and Looker)

If you prefer to configure components manually instead of using `npm run deploy`, complete these steps:

### GCP Secret Manager Setup
Create and configure these secrets in your project (replacing `<sanitized_host>` with the lowercase hostname where non-alphanumeric characters are replaced with `_`):
1. `NANO_ADMIN_LOOKERSDK_CLIENT_ID_<sanitized_host>`: Your Looker API Client ID for that instance.
2. `NANO_ADMIN_LOOKERSDK_CLIENT_SECRET_<sanitized_host>`: Your Looker API Client Secret for that instance.
3. `GCF_HMAC_SECRET`: A random 32-byte hexadecimal string used to sign challenges.

### Manual Cloud Function Deployment
Run the following from the root directory:
```bash
gcloud functions deploy nano-admin-backend \
  --gen2 \
  --runtime=nodejs24 \
  --region=us-central1 \
  --trigger-http \
  --allow-unauthenticated \
  --ingress-settings=all \
  --entry-point=nanoAdminBackend \
  --source=backend \
  --set-env-vars="LOOKER_ALLOWED_INSTANCES=your-looker-instance.looker.app,LOOKER_INSTANCE_AUTH_MODES=your-looker-instance.looker.app=server_proxy" \
  --set-secrets="NANO_ADMIN_LOOKERSDK_CLIENT_ID_your_looker_instance_looker_app=NANO_ADMIN_LOOKERSDK_CLIENT_ID_your_looker_instance_looker_app:latest,NANO_ADMIN_LOOKERSDK_CLIENT_SECRET_your_looker_instance_looker_app=NANO_ADMIN_LOOKERSDK_CLIENT_SECRET_your_looker_instance_looker_app:latest,GCF_HMAC_SECRET=GCF_HMAC_SECRET:latest"
```

### Manual Looker Setup (Server Proxy Mode)
Create the attribute in Looker under **Admin -> Users -> User Attributes**:
* **Name**: `nano_admin_admin_extension_nano_admin_challenge` (corresponds to Looker's `{project}_{app}_{attribute}` structure)
* **Label**: `Nano Admin Challenge`
* **Data Type**: `String`
* **User Access**: `View`
* **Hide Values**: `Yes`
* **Domain Whitelist**: Add your production GCF URL.

### Manual Looker Setup (OAuth 2.0 Mode)
Register the OAuth client in Looker via the API Explorer (`register_oauth_client_app`) or `looker-cli`:
* **`client_guid`**: `nano_admin_oauth_client`
* **`redirect_uri`**: `https://<your-looker-host>/extensions/oauth2_redirect`
* **`display_name`**: `Nano Admin Extension`
* **`enabled`**: `true`
