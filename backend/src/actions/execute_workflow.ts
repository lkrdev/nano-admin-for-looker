import { getWorkflows, isUserAuthorized, getScopeGroupUserIds, resolveUserIdLimitation, UserIdLimitationResult, UserIdLimitation } from '../auth_utils';
import { ActionHandler, HttpError } from './registry';
import { BUILD_HASH, BUILD_TIMESTAMP } from '../build_hash';
import { wrapLookerSDKWithLogging } from '../looker_logging_sdk';

export const executeWorkflowHandler: ActionHandler = async (sdk, userId, reqBody) => {
  const { workflowId, workflowAction, payload } = reqBody;

  if (!workflowId) {
    throw new HttpError(400, 'Missing required parameter: "workflowId"');
  }
  if (!workflowAction) {
    throw new HttpError(400, 'Missing required parameter: "workflowAction"');
  }

  // 1. Fetch workflow configurations
  const configData = await getWorkflows(sdk);
  const workflow = (configData.workflows || []).find((w: any) => w.id === workflowId);

  if (!workflow) {
    throw new HttpError(404, `Workflow with ID "${workflowId}" not found.`);
  }

  // 2. Validate Authorization
  const authorized = await isUserAuthorized(sdk, userId, workflowId);
  if (!authorized) {
    throw new HttpError(403, `User ${userId} is not authorized to execute workflow "${workflowId}"`);
  }

  const templateId = workflow.template;
  if (!templateId || typeof templateId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(templateId)) {
    throw new HttpError(400, `Workflow "${workflowId}" specifies an invalid template identifier.`);
  }

  console.log(`[Lazy Loading] Loading backend handler for template "${templateId}"...`);

  // 3. Lazy Load the template backend handler module
  let templateModule: any;
  try {
    // Relative path from dist/actions/execute_workflow.js to dist/workflow-templates/<templateId>/backend
    templateModule = require(`../workflow-templates/${templateId}/backend`);
  } catch (err: any) {
    console.error(`Failed to lazy load template "${templateId}" backend:`, err);
    throw new HttpError(
      500,
      `Failed to load backend handler for template "${templateId}". Ensure the template exists and is compiled.`
    );
  }

  const handler = templateModule.handler;
  if (typeof handler !== 'function') {
    throw new HttpError(
      500,
      `Template "${templateId}" backend module does not export a "handler" function.`
    );
  }

  // Wrap SDK with workflow logging context
  const workflowSdk = wrapLookerSDKWithLogging(sdk, {
    userId,
    workflowId: workflow.id,
    action: workflowAction
  });

  // 4. Construct context with framework helpers library and execute
  const context = {
    sdk: workflowSdk,
    userId,
    workflowId: workflow.id,
    parameters: workflow.parameters || {},
    helpers: {
      getScopeGroupUserIds: (attributeName?: string): Promise<string[]> =>
        getScopeGroupUserIds(workflowSdk, userId, attributeName),
      resolveUserIdLimitation: (limitation?: UserIdLimitation): Promise<UserIdLimitationResult> =>
        resolveUserIdLimitation(workflowSdk, userId, limitation)
    }
  };

  try {
    const result = await handler(context, workflowAction, payload || {});
    return {
      message: `Workflow "${workflowId}" executed successfully`,
      timestamp: new Date().toISOString(),
      result,
      build_hash: BUILD_HASH,
      build_timestamp: BUILD_TIMESTAMP
    };
  } catch (error: any) {
    console.error(`Error in workflow template "${templateId}" handler:`, error);
    if (error instanceof HttpError || typeof error?.status === 'number') {
      throw error;
    }
    const isForbidden = error?.message && String(error.message).startsWith('403');
    throw new HttpError(
      error?.status || (isForbidden ? 403 : 500),
      error?.message || String(error)
    );
  }
};
