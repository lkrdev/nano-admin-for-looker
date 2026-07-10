import { getWorkflows, getUserGroups } from '../auth_utils';
import { BUILD_HASH } from '../build_hash';

export async function getAdminPagesHandler(sdk: any, userId: string, payload: any): Promise<any> {
  const configData = await getWorkflows(sdk);
  const userGroups = await getUserGroups(sdk, userId);

  const authorizedPages = (configData.adminPages || []).map((page: any) => {
    let authorized = true;
    if (page.authorized_groups && page.authorized_groups.length > 0) {
      authorized = page.authorized_groups.some((groupId: string) => userGroups.includes(groupId));
    }
    return {
      ...page,
      authorized
    };
  });

  const authorizedWorkflows = (configData.workflows || []).map((wf: any) => {
    let authorized = true;
    if (wf.authorized_groups && wf.authorized_groups.length > 0) {
      authorized = wf.authorized_groups.some((groupId: string) => userGroups.includes(groupId));
    }
    return {
      ...wf,
      authorized
    };
  });

  return {
    message: 'Admin items retrieved successfully',
    timestamp: new Date().toISOString(),
    pages: authorizedPages,
    workflows: authorizedWorkflows,
    build_hash: BUILD_HASH
  };
}
