export type ActionHandler = (sdk: any, userId: string, payload: any) => Promise<any>;

import { getAdminPagesHandler } from './get_admin_pages';
import { auditUsersHandler } from './audit_users';
import { purgeCacheHandler } from './purge_cache';
import { executeWorkflowHandler } from './execute_workflow';

export const actionRegistry = new Map<string, ActionHandler>([
  ['get_admin_pages', getAdminPagesHandler],
  ['audit_users', auditUsersHandler],
  ['purge_cache', purgeCacheHandler],
  ['execute_workflow', executeWorkflowHandler]
]);
