import { LookerBackendSDK } from '../looker_logging_sdk';

export interface ActionContext {
  instanceHost: string;
}

export type ActionHandler = (
  sdk: LookerBackendSDK,
  userId: string,
  payload: any,
  context?: ActionContext
) => Promise<any>;

import { getWorkflowsHandler } from './get_workflows';
import { executeWorkflowHandler } from './execute_workflow';
import { validateDevIndexHandler } from './validate_dev_index';

export const actionRegistry = new Map<string, ActionHandler>([
  ['get_workflows', getWorkflowsHandler],
  ['execute_workflow', executeWorkflowHandler],
  ['validate_dev_index', validateDevIndexHandler]
]);
