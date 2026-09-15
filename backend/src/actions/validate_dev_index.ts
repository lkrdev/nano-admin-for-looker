import fs from 'fs';
import path from 'path';
import { fetchDevIndexContent, parseYamlWithStatus } from '../auth_utils';
import { ActionHandler } from './registry';

export const validateDevIndexHandler: ActionHandler = async (sdk, userId, payload) => {
  let text = typeof payload?.index_content === 'string' && payload.index_content.trim() ? payload.index_content : '';
  let fetchError: string | null = null;

  if (!text) {
    const devFetch = await fetchDevIndexContent();
    text = devFetch.text || '';
    fetchError = devFetch.error;
  }

  if (!text) {
    return {
      valid: false,
      error_type: 'fetch_error',
      message: 'Failed to retrieve index.md content for validation.',
      details: fetchError || 'Development index.md file content not provided or empty.'
    };
  }

  const { data, parseError } = parseYamlWithStatus(text);
  if (parseError) {
    return {
      valid: false,
      error_type: 'yaml_syntax',
      message: 'YAML Syntax Error in development index.md',
      details: parseError
    };
  }

  const schemaValidation = validateWorkflowsSchema(data);
  if (!schemaValidation.valid) {
    return {
      valid: false,
      error_type: 'schema_error',
      message: 'Invalid workflow schema structure in development index.md',
      details: schemaValidation.error
    };
  }

  return {
    valid: true,
    message: 'Development index.md is valid!',
    workflows_count: schemaValidation.workflows.length,
    workflows: schemaValidation.workflows
  };
};

// --- Hoisted Pure Helpers ---

function validateWorkflowsSchema(parsedData: any): { valid: boolean; error?: string; workflows: any[] } {
  if (!parsedData || typeof parsedData !== 'object') {
    return { valid: false, error: 'Root content must be a YAML object.', workflows: [] };
  }

  const workflows = parsedData.workflows;
  if (!Array.isArray(workflows)) {
    return { valid: false, error: 'Missing or invalid "workflows" array at root.', workflows: [] };
  }

  if (workflows.length === 0) {
    return { valid: false, error: '"workflows" list is empty.', workflows: [] };
  }

  for (let i = 0; i < workflows.length; i++) {
    const wf = workflows[i];
    const itemPrefix = `Workflow #${i + 1}`;

    if (!wf.id || typeof wf.id !== 'string') {
      return { valid: false, error: `${itemPrefix} is missing required string "id" property.`, workflows: [] };
    }
    if (!wf.label || typeof wf.label !== 'string') {
      return { valid: false, error: `${itemPrefix} ("${wf.id}") is missing required string "label" property.`, workflows: [] };
    }
    if (!wf.template || typeof wf.template !== 'string') {
      return { valid: false, error: `${itemPrefix} ("${wf.id}") is missing required string "template" property.`, workflows: [] };
    }

    const templateExists = checkTemplateExists(wf.template);
    if (!templateExists) {
      return { valid: false, error: `${itemPrefix} ("${wf.id}") references non-existent template "${wf.template}".`, workflows: [] };
    }
  }

  const sanitizedWorkflows = workflows.map((wf: any) => {
    const manifest = getTemplateManifest(wf.template);
    return {
      id: wf.id,
      label: wf.label,
      template: wf.template,
      mount_type: manifest.mount_type || wf.mount_type || 'page',
      authorized_groups_count: Array.isArray(wf.authorized_groups) ? wf.authorized_groups.length : 0
    };
  });

  return { valid: true, workflows: sanitizedWorkflows };
}

function getTemplateManifest(templateId: string): any {
  try {
    const manifestPath = path.resolve(__dirname, '..', 'workflow-templates', templateId, 'manifest.json');
    if (fs.existsSync(manifestPath)) {
      const content = fs.readFileSync(manifestPath, 'utf8');
      return JSON.parse(content);
    }
  } catch (e) {
    // Ignore manifest read error
  }
  return {};
}

function checkTemplateExists(templateId: string): boolean {
  try {
    const templateDir = path.resolve(__dirname, '..', 'workflow-templates', templateId);
    return fs.existsSync(templateDir) && fs.statSync(templateDir).isDirectory();
  } catch {
    return false;
  }
}
