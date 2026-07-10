import { getWorkflows, isUserAuthorized } from '../auth_utils';
import { ActionHandler } from './registry';

export const executeWorkflowHandler: ActionHandler = async (sdk, userId, reqBody) => {
  const { workflowId, workflowAction, payload } = reqBody;

  if (!workflowId) {
    throw { status: 400, message: 'Missing required parameter: "workflowId"' };
  }
  if (!workflowAction) {
    throw { status: 400, message: 'Missing required parameter: "workflowAction"' };
  }

  // 1. Fetch workflow configurations
  const configData = await getWorkflows(sdk);
  const workflow = (configData.workflows || []).find((w: any) => w.id === workflowId);

  if (!workflow) {
    throw { status: 404, message: `Workflow with ID "${workflowId}" not found.` };
  }

  // 2. Validate Authorization
  const authorized = await isUserAuthorized(sdk, userId, workflowId);
  if (!authorized) {
    throw { status: 403, message: `User ${userId} is not authorized to execute workflow "${workflowId}"` };
  }

  const templateId = workflow.template;
  if (!templateId) {
    throw { status: 400, message: `Workflow "${workflowId}" does not specify a template.` };
  }

  console.log(`[Lazy Loading] Loading backend handler for template "${templateId}"...`);

  // 3. Lazy Load the template backend handler module
  let templateModule: any;
  try {
    // Relative path from dist/actions/execute_workflow.js to dist/workflow-templates/<templateId>/backend
    templateModule = require(`../workflow-templates/${templateId}/backend`);
  } catch (err: any) {
    console.error(`Failed to lazy load template "${templateId}" backend:`, err);
    throw {
      status: 500,
      message: `Failed to load backend handler for template "${templateId}". Ensure the template exists and is compiled.`
    };
  }

  const handler = templateModule.handler;
  if (typeof handler !== 'function') {
    throw {
      status: 500,
      message: `Template "${templateId}" backend module does not export a "handler" function.`
    };
  }

  // 4. Construct context and execute
  const context = {
    sdk,
    userId,
    workflowId: workflow.id,
    parameters: workflow.parameters || {}
  };

  try {
    const result = await handler(context, workflowAction, payload || {});
    return {
      message: `Workflow "${workflowId}" executed successfully`,
      timestamp: new Date().toISOString(),
      result
    };
  } catch (error: any) {
    console.error(`Error in workflow template "${templateId}" handler:`, error);
    throw {
      status: error.status || 500,
      message: error.message || String(error)
    };
  }
};
