export type ActionHandler = (sdk: any, userId: string, payload: any) => Promise<any>;

import { getWorkflowsHandler } from './get_workflows';
import { executeWorkflowHandler } from './execute_workflow';

export const actionRegistry = new Map<string, ActionHandler>([
  ['get_workflows', getWorkflowsHandler],
  ['execute_workflow', executeWorkflowHandler]
]);
