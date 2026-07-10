# Looker Nano-Admin Workflow Templates

This directory contains reusable **Workflow Templates** that define the frontend and backend components of Nano-Admin workflows. 

Workflows are configured and authorized in Looker using a YAML configuration file (e.g. `dummy_index.yml` or `index.md`). Individual workflows are instantiated by referencing a **Workflow Template** and parameterizing it.

---

## Convention

Each subfolder under this directory represents a **Workflow Template**. The template folder name matches the template identifier (e.g. `crud`).

### Folder Structure

```
workflow-templates/
├── README.md                 # This documentation
└── <template_id>/            # E.g., "crud"
    ├── README.md             # Documentation for this specific template
    ├── manifest.json         # Template configuration schema and metadata
    ├── frontend/             # Frontend React components
    │   └── index.tsx         # Frontend entry point (default export React.FC)
    └── backend/              # Backend serverless handler logic
        └── index.ts          # Backend entry point (named exports or default handler)
```

---

## 1. Metadata & Parameters: `manifest.json`

The `manifest.json` file describes the template, its version, and the configurable parameters it expects. This serves as documentation and validation for the YAML configuration.

Example `manifest.json`:
```json
{
  "name": "CRUD Workflow Template",
  "description": "A reusable CRUD workflow template that can list, read, create, and update Looker objects.",
  "version": "1.0.0",
  "parameters": {
    "target_object": {
      "type": "string",
      "description": "The Looker API object type (e.g. 'users', 'connections')",
      "required": true
    },
    "supported_operations": {
      "type": "array",
      "description": "List of operations supported by this instantiation",
      "items": {
        "type": "object",
        "properties": {
          "name": { "type": "string" }, 
          "fields": { "type": "array", "items": { "type": "string" } },
          "values": { "type": "object" }//TODO: values should be specific to/nested under fields.
        }
      }
    }
  }
}
```

---

## 2. Frontend Component: `frontend/index.tsx`

The frontend entry point must be `frontend/index.tsx`. It must export a React component as the **default export**.

### Props Interface

The component will receive the following props from the shell application:

```typescript
export interface WorkflowComponentProps {
  workflowId: string;         // Unique ID of the instantiated workflow
  label: string;              // Human-readable label of the workflow
  parameters: any;            // Configured parameters for this instance
  coreSDK: any;               // Looker Extension SDK Core API Client
  extensionSDK: any;          // Raw Looker Extension SDK
  addLog: (msg: string) => void; // Function to output logs to the execution terminal
  callBackend: (action: string, payload?: any) => Promise<any>; // Secure wrapper to call this workflow's backend
}
```

---

## 3. Backend Handler: `backend/index.ts`

The backend entry point must be `backend/index.ts`. It must export a handler function.

### Context & Handler Interface

```typescript
import { LookerNodeSDK } from '@looker/sdk-node';

export interface WorkflowContext {
  sdk: LookerNodeSDK;         // Authenticated Looker Node SDK Client
  userId: string;             // Authenticated Looker User ID triggering the request
  workflowId: string;         // Unique ID of the instantiated workflow
  parameters: any;            // Configured parameters for this instance
}

export type WorkflowBackendHandler = (
  context: WorkflowContext,
  action: string,             // The action requested by the frontend
  payload: any                // Additional payload sent from the frontend
) => Promise<any>;

// The file MUST export a handler function, either default or named:
export const handler: WorkflowBackendHandler = async (context, action, payload) => {
  // Handler logic here...
};
```

---

## How Lazy Loading Works

### Frontend (Webpack & React.lazy)
To keep the initial bundle lightweight, the frontend wrapper uses Webpack dynamic imports with `React.lazy` to resolve the component only when the user navigates to the workflow:
```typescript
const DynamicWorkflowComponent = React.lazy(() => 
  import(`./workflow-templates/${templateId}/frontend`)
);
```

### Backend (GCP Cloud Function)
The backend does not pre-load all workflow codes on startup. When a request to `execute_workflow` is received, the Cloud Function dynamically resolves and imports the template handler:
```typescript
const templateModule = require(`./workflow-templates/${templateId}/backend`);
const result = await templateModule.handler(context, action, payload);
```

### Build & Deploy Sync
A build script (`scripts/generate-hash.js`) automatically copies template files from the top-level `workflow-templates` directory into:
- `extension/src/workflow-templates/` for compilation by Webpack.
- `backend/src/workflow-templates/` for compilation by TypeScript and deployment to GCF.
