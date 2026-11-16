import { normalizeParameters, WorkflowContext } from './types';
import { resolveScopeContext } from './scope';
import {
  createUserAction,
  deleteUserAction,
  getUserDetailAction,
  listUsersAction,
  setUserDisabledAction,
  updateUserProfileAction
} from './actions/users';
import {
  addUserToGroupAction,
  getUserGroupsAction,
  removeUserFromGroupAction
} from './actions/groups';
import { getUserRolesAction, setUserRolesAction } from './actions/roles';
import {
  deleteUserAttributeAction,
  getUserAttributesAction,
  setUserAttributeAction
} from './actions/attributes';
import {
  getUserFolderAccessAction,
  removeUserFolderAccessAction,
  setUserFolderAccessAction
} from './actions/folders';
import {
  createEmailCredentialsAction,
  deleteEmailCredentialsAction,
  getUserCredentialsAction,
  resetTotpAction,
  revokeSessionAction,
  sendPasswordResetAction
} from './actions/credentials';
import {
  deleteUserScheduleAction,
  getUserTelemetryAction,
  reassignUserScheduleAction,
  updateUserScheduleAction
} from './actions/telemetry';

export const handler = async (
  context: WorkflowContext,
  action: string,
  payload: any = {}
): Promise<any> => {
  const params = normalizeParameters(context.parameters);
  const scope = await resolveScopeContext(context, params);

  if (action === 'list_users') {
    return await listUsersAction(context, params, scope);
  }
  if (action === 'get_user_detail') {
    return await getUserDetailAction(context, params, scope, payload);
  }
  if (action === 'create_user') {
    return await createUserAction(context, params, scope, payload);
  }
  if (action === 'update_user_profile') {
    return await updateUserProfileAction(context, params, scope, payload);
  }
  if (action === 'set_user_disabled') {
    return await setUserDisabledAction(context, params, scope, payload);
  }
  if (action === 'delete_user') {
    return await deleteUserAction(context, params, scope, payload);
  }

  if (action === 'get_user_groups') {
    return await getUserGroupsAction(context, params, scope, payload);
  }
  if (action === 'add_user_to_group') {
    return await addUserToGroupAction(context, params, scope, payload);
  }
  if (action === 'remove_user_from_group') {
    return await removeUserFromGroupAction(context, params, scope, payload);
  }

  if (action === 'get_user_roles') {
    return await getUserRolesAction(context, params, scope, payload);
  }
  if (action === 'set_user_roles') {
    return await setUserRolesAction(context, params, scope, payload);
  }

  if (action === 'get_user_attributes') {
    return await getUserAttributesAction(context, params, scope, payload);
  }
  if (action === 'set_user_attribute') {
    return await setUserAttributeAction(context, params, scope, payload);
  }
  if (action === 'delete_user_attribute') {
    return await deleteUserAttributeAction(context, params, scope, payload);
  }

  if (action === 'get_user_folder_access') {
    return await getUserFolderAccessAction(context, params, scope, payload);
  }
  if (action === 'set_user_folder_access') {
    return await setUserFolderAccessAction(context, params, scope, payload);
  }
  if (action === 'remove_user_folder_access') {
    return await removeUserFolderAccessAction(context, params, scope, payload);
  }

  if (action === 'get_user_credentials') {
    return await getUserCredentialsAction(context, params, scope, payload);
  }
  if (action === 'send_password_reset') {
    return await sendPasswordResetAction(context, params, scope, payload);
  }
  if (action === 'create_email_credentials') {
    return await createEmailCredentialsAction(context, params, scope, payload);
  }
  if (action === 'delete_email_credentials') {
    return await deleteEmailCredentialsAction(context, params, scope, payload);
  }
  if (action === 'reset_totp') {
    return await resetTotpAction(context, params, scope, payload);
  }
  if (action === 'revoke_session') {
    return await revokeSessionAction(context, params, scope, payload);
  }

  if (action === 'get_user_telemetry') {
    return await getUserTelemetryAction(context, params, scope, payload);
  }
  if (action === 'update_user_schedule') {
    return await updateUserScheduleAction(context, params, scope, payload);
  }
  if (action === 'delete_user_schedule') {
    return await deleteUserScheduleAction(context, params, scope, payload);
  }
  if (action === 'reassign_user_schedule') {
    return await reassignUserScheduleAction(context, params, scope, payload);
  }

  throw new Error(`Unknown or unsupported action "${action}" for user-management workflow.`);
};
