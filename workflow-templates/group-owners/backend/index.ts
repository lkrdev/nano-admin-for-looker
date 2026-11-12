import { normalizeGroupOwnersParameters, WorkflowContext } from './types';
import {
  addChildGroupAction,
  addUserToOwnedGroupAction,
  createChildGroupAction,
  getOwnedGroupDetailsAction,
  listOwnedGroupsAction,
  removeChildGroupAction,
  removeUserFromOwnedGroupAction,
  resolveGroupOwnersContext,
  updateOwnedGroupOwnerAction
} from './actions/groups';

export const handler = async (
  context: WorkflowContext,
  action: string,
  payload: any = {}
): Promise<any> => {
  const params = normalizeGroupOwnersParameters(context.parameters);
  const ownedContext = await resolveGroupOwnersContext(context, params);

  if (action === 'list_owned_groups') {
    return await listOwnedGroupsAction(context, params, ownedContext);
  }
  if (action === 'get_group_details') {
    return await getOwnedGroupDetailsAction(context, params, ownedContext, payload);
  }
  if (action === 'add_user_to_group') {
    return await addUserToOwnedGroupAction(context, params, ownedContext, payload);
  }
  if (action === 'remove_user_from_group') {
    return await removeUserFromOwnedGroupAction(context, params, ownedContext, payload);
  }
  if (action === 'update_group_owner') {
    return await updateOwnedGroupOwnerAction(context, params, ownedContext, payload);
  }
  if (action === 'add_child_group') {
    return await addChildGroupAction(context, params, ownedContext, payload);
  }
  if (action === 'remove_child_group') {
    return await removeChildGroupAction(context, params, ownedContext, payload);
  }
  if (action === 'create_child_group') {
    return await createChildGroupAction(context, params, ownedContext, payload);
  }

  throw new Error(`Unknown or unsupported action "${action}" for group-owners workflow.`);
};
