import path from 'path';
import { getWorkflows, isUserAuthorized, getScopeGroupUserIds, resolveUserIdLimitation, UserIdLimitationResult, UserIdLimitation, UserIdLimitationMode } from '../auth_utils';
import { ActionHandler } from './registry';
import { wrapLookerSDKWithLogging } from '../looker_logging_sdk';

const VALID_TEMPLATE_ID_REGEX = /^[-a-z0-9]{1,50}$/;

export const executeWorkflowHandler: ActionHandler = async (sdk, userId, reqBody, actionContext) => {
  const { workflowId, workflowAction, payload } = reqBody;
  const instanceHost = actionContext?.instanceHost;

  if (!workflowId) {
    throw { status: 400, message: 'Missing required parameter: "workflowId"' };
  }
  if (!workflowAction) {
    throw { status: 400, message: 'Missing required parameter: "workflowAction"' };
  }

  // 1. Fetch workflow configurations
  const configData = await getWorkflows(sdk, instanceHost);
  const workflow = (configData.workflows || []).find((w: any) => w.id === workflowId);

  if (!workflow) {
    throw { status: 404, message: `Workflow with ID "${workflowId}" not found.` };
  }

  // 2. Validate Authorization
  const authorized = await isUserAuthorized(sdk, userId, workflowId, instanceHost);
  if (!authorized) {
    throw { status: 403, message: `User ${userId} is not authorized to execute workflow "${workflowId}"` };
  }

  const templateId = workflow.template;
  const resolvedBackendPath = resolveTemplateBackendPath(templateId, workflowId);

  console.log(`[Lazy Loading] Loading backend handler for template "${templateId}"...`);

  // 3. Lazy Load the template backend handler module
  let templateModule: any;
  try {
    templateModule = require(resolvedBackendPath);
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

  // Wrap SDK with workflow logging context
  const workflowSdk = wrapLookerSDKWithLogging(sdk, {
    userId,
    instanceHost,
    workflowId: workflow.id,
    action: workflowAction
  });

  // 4. Construct context with framework helpers library and execute
  const context = {
    sdk: workflowSdk,
    userId,
    workflowId: workflow.id,
    instanceHost,
    parameters: workflow.parameters || {},
    helpers: {
      getScopeGroupUserIds: (attributeName?: string, includeSubgroups?: boolean): Promise<string[]> =>
        getScopeGroupUserIds(workflowSdk, userId, attributeName, includeSubgroups),
      resolveUserIdLimitation: (limitation?: UserIdLimitation, defaultMode?: UserIdLimitationMode): Promise<UserIdLimitationResult> =>
        resolveUserIdLimitation(workflowSdk, userId, limitation, defaultMode)
    }
  };

  try {
    const result = await handler(context, workflowAction, payload || {});
    return {
      message: `Workflow "${workflowId}" executed successfully`,
      timestamp: new Date().toISOString(),
      result,
      build_hash: process.env.BUILD_HASH || '',
      build_timestamp: process.env.BUILD_TIMESTAMP || ''
    };
  } catch (error: any) {
    console.error(`Error in workflow template "${templateId}" handler:`, error);
    throw {
      status: error.status || 500,
      message: error.message || String(error)
    };
  }
};

export function resolveTemplateBackendPath(templateId: unknown, workflowId: string): string {
  if (!templateId || typeof templateId !== 'string' || !VALID_TEMPLATE_ID_REGEX.test(templateId)) {
    throw { status: 400, message: `Workflow "${workflowId}" specifies an invalid template identifier.` };
  }

  const templatesRoot = path.resolve(__dirname, '..', 'workflow-templates');
  const resolvedBackendPath = path.resolve(templatesRoot, templateId, 'backend');
  if (!resolvedBackendPath.startsWith(templatesRoot + path.sep)) {
    throw { status: 400, message: `Workflow "${workflowId}" specifies an invalid template identifier.` };
  }

  return resolvedBackendPath;
}
