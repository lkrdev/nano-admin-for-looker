# Nano-Admin for Looker

This project contains a Looker Admin Extension (Frontend React app running in an iframe) and a Google Cloud Function (GCF Backend) running on Node.js to safely perform administrative Looker API operations on behalf of users.

---

## Project Structure

```
.
├── extension/                 # Frontend Looker Extension (React & TypeScript)
│   ├── src/                   # React app entry and layouts
│   ├── webpack.config.js      # Webpack configuration (Single-bundle, HTTPS, CORS)
│   ├── manifest.lkml          # Manifest definition for Looker Integration
│   └── tsconfig.json
│
└── backend/                   # Backend Google Cloud Function (Node.js & TypeScript)
    ├── src/                   # GCF entry (HTTP handler, CORS, Looker Node SDK)
    └── tsconfig.json
```

---

## Local Development Setup

### 1. Prerequisite: Load NVM and Install Dependencies

Install all workspace dependencies from the root directory:
```bash
npm install
```

### 2. Start the Looker Extension (Frontend)
Run the Webpack Dev Server. It will serve the single-file JavaScript bundle over HTTPS at `https://localhost:8080/bundle.js`.
```bash
npm run extension:dev
```
> **Note**: You may need to visit `https://localhost:8080/bundle.js` directly in your browser once and accept the self-signed SSL certificate so Looker's iframe can load it.

### 3. Start the Google Cloud Function (Backend)
Run the GCF backend locally on `http://localhost:8081` using the Functions Framework:
```bash
npm run backend:dev
```

---

## Configuring Looker API Credentials for GCF

The GCF backend initializes the Looker Node SDK. You can configure it using either environment variables or a `looker.ini` file in the `backend/` directory:

### Option A: `looker.ini` Configuration (Recommended for Local Dev)
Create a file named `backend/looker.ini` with the following structure:
```ini
[Looker]
base_url=https://88aa1d94-1917-46df-bf19-8713411bc7de.looker.app:443
client_id=your_api_client_id
client_secret=your_api_client_secret
verify_ssl=true
```

### Option B: Environment Variables
Alternatively, export the variables in your shell before running the dev server:
```bash
export LOOKERSDK_BASE_URL="https://your-looker-instance.looker.app:443"
export LOOKERSDK_CLIENT_ID="your_client_id"
export LOOKERSDK_CLIENT_SECRET="your_client_secret"
```

If neither is configured, the backend will gracefully run in **development mockup mode**, allowing you to test UI actions with dummy data.

---

## Secure Challenge-Response Authentication Setup

To secure communication between the Looker Extension (frontend) and the Google Cloud Function (backend), a challenge-response handshake is used:
1. The frontend requests are routed through Looker's `serverProxy`.
2. Looker intercepts the `X-Nano-Admin-Challenge` header containing the placeholder tag `createSecretKeyTag('nano_admin_challenge')` and swaps it with the user's attribute value.
3. If the backend detects a missing or invalid challenge, it generates a fresh challenge, saves it to the user's `nano_admin_challenge` attribute via Looker's admin SDK, and returns a `401 Unauthorized` status.
4. The frontend catches the `401` status and automatically retries the request, allowing Looker to inject the new challenge, completing a seamless authentication flow.

### Configuring the Looker User Attribute

Since this is a hidden user attribute, Looker restricts where its value can be sent using a **domain whitelist**. Set up the attribute in the Looker Admin panel as follows:

1. **Go to Admin -> Users -> User Attributes** and click **Create User Attribute**.
2. **Configure Settings:**
   * **Name:** `nano_admin_admin_extension_nano_admin_challenge`
     > **Note on Namespacing:** For scoped attributes, the name in Looker must be formatted as `{modified_extension_id}_{attribute_name}`. Since the project is `nano_admin` and application is `admin_extension`, the extension ID is `nano_admin::admin_extension`, which translates to the prefix `nano_admin_admin_extension_`.
   * **Label:** `Nano Admin Challenge`
   * **Data Type:** `String`
   * **User Access:** `View`
   * **Hide Values:** `Yes` (This hides the value from users in the UI and makes it write-only/read-protected).
3. **Configure the Domain Whitelist (CRITICAL):**
   * Under the **Domain Whitelist** (or `hidden_value_domain_whitelist` API field), you must specify the destination domains to which the hidden attribute value is allowed to be sent.
   * For local development, add:
     ```
     http://localhost:8081
     ```
   * For production, add the URL of your deployed Google Cloud Function.
   * *Note:* If the whitelists do not match the backend API endpoint URL, Looker's server proxy will block forwarding the secret value and send an empty string instead.

---

## Deploying the GCF Backend to Google Cloud

To deploy the backend Google Cloud Function, you will use the Google Cloud SDK (`gcloud` CLI).

### Prerequisites

1. **Install the gcloud CLI:** Ensure the Google Cloud SDK is installed on your local machine.
2. **Authenticate with GCP:** Log in to your Google Cloud account by running:
   ```bash
   gcloud auth login
   ```
3. **Configure the target Project:** Set the active project where you want to deploy the Cloud Function:
   ```bash
   gcloud config set project YOUR_PROJECT_ID
   ```
4. **API Enablement (First-time Deployment):** If you haven't deployed a Cloud Function or used Cloud Build in this project before, the CLI will prompt you to enable the necessary APIs (e.g. `cloudfunctions.googleapis.com`, `cloudbuild.googleapis.com`, `artifactregistry.googleapis.com`). Press `y` when prompted to enable them automatically.

### 1. Run the Deployment Command

You can run the pre-configured deployment command from the project root:

```bash
npm run backend:deploy
```

Or run the full command manually to customize the region, function name, or set environment variables:

```bash
gcloud functions deploy nano-admin-backend \
  --gen2 \
  --runtime=nodejs24 \
  --region=us-central1 \
  --trigger-http \
  --allow-unauthenticated \
  --entry-point=nanoAdminBackend \
  --source=backend \
  --set-env-vars="GCF_HMAC_SECRET=your_hmac_secret,LOOKERSDK_BASE_URL=https://your-looker-instance.looker.app:443" \
  --set-secrets="LOOKERSDK_CLIENT_ID=LOOKER_CLIENT_ID_SECRET:latest,LOOKERSDK_CLIENT_SECRET=LOOKER_CLIENT_SECRET_SECRET:latest"
```

> [!TIP]
> For security, it is highly recommended to store the sensitive Looker API client ID and client secret using **Google Cloud Secret Manager** and reference them via the `--set-secrets` flag, rather than passing them as plain-text environment variables.

### 2. Update Extension Configuration with the Production URL

Once deployed, Google Cloud will provide a public HTTPS trigger URL for your function (e.g., `https://nano-admin-backend-xxxxx-uc.a.run.app`).

1. **Update `extension/manifest.lkml`:**
   Replace the `http://localhost:8081` entry in `external_api_urls` with your new production URL:
   ```lkml
   external_api_urls: [
     "https://nano-admin-backend-xxxxx-uc.a.run.app"
   ]
   ```
2. **Update the Frontend API calls in `extension/src/App.tsx`:**
   In [App.tsx](file:///usr/local/google/home/fabble/projects/nano-admin-for-looker/extension/src/App.tsx), locate the server proxy calls and replace the local URL with your production URL:
   ```typescript
   // Replace http://localhost:8081 with your production URL:
   await extensionSDK.serverProxy('https://nano-admin-backend-xxxxx-uc.a.run.app', ...)
   ```
3. **Rebuild the Frontend Extension:**
   ```bash
   npm run extension:build
   ```
4. **Update the Looker User Attribute Domain Whitelist:**
   Go to the Looker Admin panel -> **User Attributes** -> `nano_admin_admin_extension_nano_admin_challenge`.
   * Add your production function URL (e.g., `https://nano-admin-backend-xxxxx-uc.a.run.app`) to the **Domain Whitelist** so that Looker allows the secret key values to be sent to that endpoint.

---

## Deploying to Looker

To run the extension in your Looker instance, follow these steps:

1. **Create the Project:** Open your Looker instance and create a LookML project called `nano_admin`.
2. **Add manifest.lkml:** Copy the contents of [extension/manifest.lkml](file:///usr/local/google/home/fabble/projects/nano-admin-for-looker/extension/manifest.lkml) into the project's `manifest.lkml` file.
3. **Add Model File:** Create a model file (e.g. `nano_admin.model.lkml`) in the project directory. The file must specify a valid connection:
   ```lkml
   connection: "your_connection_name"
   ```
4. **Create Model Configuration:** Go to **Admin -> LookML Projects** (or Model Configurations) and create a configuration for `nano_admin` allowing access to the connection specified in the model file. **Without a model file and its corresponding Looker Admin model configuration, the extension will not show up in the Looker menu.**
5. **Add index.md (Routing Configuration):** Create an `index.md` file in your `nano_admin` project to register the admin pages:
   ```yaml
   adminPages:
     - route: "/user-audit"
       label: "User Audit Dashboard"
     - route: "/cache-purge"
       label: "Cache Purge Utility"
   ```
6. **Commit & Deploy:** Commit the changes and deploy them to production. Once deployed to production, the extension will be visible to all permitted users in Looker's main menu.
