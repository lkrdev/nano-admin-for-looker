export class HttpError extends Error {
  public readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'HttpError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export type ActionHandler = (sdk: any, userId: string, payload: any) => Promise<any>;

import { getWorkflowsHandler } from './get_workflows';
import { executeWorkflowHandler } from './execute_workflow';
import { validateDevIndexHandler } from './validate_dev_index';

export const actionRegistry = new Map<string, ActionHandler>([
  ['get_workflows', getWorkflowsHandler],
  ['execute_workflow', executeWorkflowHandler],
  ['validate_dev_index', validateDevIndexHandler]
]);
