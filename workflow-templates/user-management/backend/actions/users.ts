import {
  NormalizedUserManagementParameters,
  ResolvedScopeContext,
  WorkflowContext
} from '../types';
import { assertTargetUserInScope, isScopeGroupsLimitationMode } from '../scope';
import { buildEvaluatedUserAttributes, resolveCreationRequiredAttributes } from './attributes';

export async function listUsersAction(
  context: WorkflowContext,
  params: NormalizedUserManagementParameters,
  scope: ResolvedScopeContext
): Promise<any> {
  const sdk = context.sdk;
  const allUsers = await sdk.ok(
    sdk.all_users({
      fields: 'id,first_name,last_name,display_name,email,is_disabled,group_ids,role_ids,personal_folder_id,home_folder_id'
    })
  );

  const inScopeUsers = filterUsersByScope(allUsers || [], scope);
  const rolesMap = await fetchRolesNameMap(sdk);
  const groupNameMap = new Map<string, string>();
  for (const mg of scope.manageableGroups) {
    groupNameMap.set(mg.id, mg.name);
  }

  let creationAttributes: any[] = [];
  if (params.profile.allow_create && params.user_attributes.allow_edit) {
    try {
      const evaluated = await buildEvaluatedUserAttributes(context, params, scope, context.userId);
      creationAttributes = evaluated.filter((a) => a.editable);
    } catch (err) {
      creationAttributes = [];
    }
  }

  const users = inScopeUsers.map((u: any) => formatUserSummary(u, scope, groupNameMap, rolesMap));

  return {
    users,
    total_count: users.length,
    capabilities: params,
    scope_info: {
      mode: scope.limitation.mode,
      attribute_name: scope.attributeName,
      active_scope_groups: scope.manageableGroups.filter((g) => g.is_scope_group),
      manageable_groups: scope.manageableGroups
    },
    creation_attributes: creationAttributes
  };
}

export async function getUserDetailAction(
  context: WorkflowContext,
  params: NormalizedUserManagementParameters,
  scope: ResolvedScopeContext,
  payload: any
): Promise<any> {
  const targetUserId = String(payload?.user_id || '').trim();
  assertTargetUserInScope(targetUserId, scope);

  const user = await context.sdk.ok(context.sdk.user(targetUserId));
  return {
    user: {
      id: String(user.id),
      first_name: user.first_name || '',
      last_name: user.last_name || '',
      display_name:
        user.display_name ||
        `${user.first_name || ''} ${user.last_name || ''}`.trim() ||
        user.email ||
        `User ${user.id}`,
      email: user.email || '',
      is_disabled: Boolean(user.is_disabled),
      group_ids: (user.group_ids || []).map((g: any) => String(g)),
      role_ids: (user.role_ids || []).map((r: any) => String(r)),
      personal_folder_id: user.personal_folder_id ? String(user.personal_folder_id) : null,
      home_folder_id: user.home_folder_id ? String(user.home_folder_id) : null
    },
    capabilities: params
  };
}

export async function createUserAction(
  context: WorkflowContext,
  params: NormalizedUserManagementParameters,
  scope: ResolvedScopeContext,
  payload: any
): Promise<any> {
  if (!params.profile.allow_create) {
    throw new Error('403 Forbidden: Creating users is not permitted for this workflow.');
  }

  const firstName = String(payload?.first_name || '').trim();
  const lastName = String(payload?.last_name || '').trim();
  const email = String(payload?.email || '').trim();
  const isDisabled = Boolean(payload?.is_disabled);
  const requestedGroupIds: string[] = Array.isArray(payload?.group_ids)
    ? payload.group_ids.map((id: any) => String(id).trim()).filter(Boolean)
    : [];

  if (!firstName && !lastName && !email) {
    throw new Error('At least a name or email is required to create a user.');
  }

  // Enforce Scope Group membership requirement upon creation when scope_groups* mode is active
  if (isScopeGroupsLimitationMode(scope.limitation.mode)) {
    const hasActiveScopeGroup = requestedGroupIds.some((gid) =>
      scope.adminActiveScopeGroupIds.includes(gid)
    );
    if (!hasActiveScopeGroup) {
      throw new Error(
        '400 Bad Request: New users must be assigned to at least one of the invoking admin\'s active Scope Groups upon creation.'
      );
    }
  }

  // Ensure all requested groups are within manageable group hierarchy
  for (const gid of requestedGroupIds) {
    if (!scope.manageableGroupIdsSet.has(gid)) {
      throw new Error(`403 Forbidden: Group "${gid}" is outside the admin's manageable Scope Group hierarchy.`);
    }
  }

  // Pre-validate user attribute rules (including must_match_admin / must_match_scope_group) before creating user
  const attributesToSet = await resolveCreationRequiredAttributes(
    context,
    params,
    scope,
    payload?.user_attributes || {}
  );

  // Pre-check to block creating duplicate users that already exist
  await assertUserDoesNotExist(context.sdk, email, firstName, lastName);

  // 1. Create the base user record
  const newUser = await context.sdk.ok(
    context.sdk.create_user({
      first_name: firstName,
      last_name: lastName,
      is_disabled: isDisabled
    })
  );
  const newUserId = String(newUser.id);

  // 2. Immediately add the user to selected Scope Groups & child groups first (no rollback on partial failure)
  const sortedGroupIds = [
    ...requestedGroupIds.filter((gid) => scope.adminActiveScopeGroupIds.includes(gid)),
    ...requestedGroupIds.filter((gid) => !scope.adminActiveScopeGroupIds.includes(gid))
  ];

  const warnings: string[] = [];
  for (const gid of sortedGroupIds) {
    try {
      await context.sdk.ok(context.sdk.add_group_user(gid, { user_id: newUserId }));
    } catch (err: any) {
      warnings.push(`Failed to add user to group ${gid}: ${err?.message || String(err)}`);
    }
  }

  // 3. Apply initial user attributes
  for (const attrItem of attributesToSet) {
    try {
      await context.sdk.ok(
        context.sdk.set_user_attribute_user_value(newUserId, attrItem.attribute_id, {
          value: attrItem.value
        })
      );
    } catch (err: any) {
      warnings.push(`Failed to set attribute "${attrItem.attribute_name}": ${err?.message || String(err)}`);
    }
  }

  // 4. Optional email credentials & welcome/password reset email
  if (email && params.credentials.allow_email_credentials) {
    try {
      await context.sdk.ok(
        context.sdk.create_user_credentials_email(newUserId, { email })
      );
      if (payload?.send_welcome_email && params.credentials.allow_password_reset) {
        await context.sdk.ok(
          context.sdk.send_user_credentials_email_password_reset(newUserId)
        );
      }
    } catch (err: any) {
      warnings.push(`Failed to configure email credentials: ${err?.message || String(err)}`);
    }
  }

  return {
    success: true,
    user: {
      ...newUser,
      id: newUserId
    },
    warnings,
    message:
      warnings.length > 0
        ? `User ${newUserId} created and added to scope group(s) with ${warnings.length} partial warning(s).`
        : `Successfully created user ${newUserId}.`
  };
}

export async function updateUserProfileAction(
  context: WorkflowContext,
  params: NormalizedUserManagementParameters,
  scope: ResolvedScopeContext,
  payload: any
): Promise<any> {
  const targetUserId = String(payload?.user_id || '').trim();
  assertTargetUserInScope(targetUserId, scope);

  const updateBody: Record<string, any> = {};
  const wantsNameUpdate = payload?.first_name !== undefined || payload?.last_name !== undefined;
  const wantsEmailUpdate = payload?.email !== undefined;

  if (!wantsNameUpdate && !wantsEmailUpdate) {
    throw new Error('No profile fields provided to update.');
  }

  if (wantsNameUpdate) {
    if (!params.profile.allow_update_name) {
      throw new Error('403 Forbidden: Updating user name fields is not permitted for this workflow.');
    }
    if (payload.first_name !== undefined) {
      updateBody.first_name = String(payload.first_name).trim();
    }
    if (payload.last_name !== undefined) {
      updateBody.last_name = String(payload.last_name).trim();
    }
  }

  if (wantsEmailUpdate) {
    if (!params.profile.allow_update_email) {
      throw new Error(
        '403 Forbidden: Updating an existing user\'s email address is disabled for this workflow.'
      );
    }
    const newEmail = String(payload.email || '').trim();
    if (!newEmail) {
      throw new Error('A valid non-empty email address is required.');
    }
    if (typeof context.sdk.update_user_credentials_email === 'function') {
      await context.sdk.ok(
        context.sdk.update_user_credentials_email(targetUserId, { email: newEmail })
      );
    } else {
      updateBody.email = newEmail;
    }
  }

  let updatedUser: any = null;
  if (Object.keys(updateBody).length > 0) {
    updatedUser = await context.sdk.ok(context.sdk.update_user(targetUserId, updateBody));
  } else {
    updatedUser = await context.sdk.ok(context.sdk.user(targetUserId));
  }

  return {
    success: true,
    user: updatedUser,
    message: `Updated profile for user ${targetUserId}.`
  };
}

export async function setUserDisabledAction(
  context: WorkflowContext,
  params: NormalizedUserManagementParameters,
  scope: ResolvedScopeContext,
  payload: any
): Promise<any> {
  if (!params.profile.allow_disable) {
    throw new Error('403 Forbidden: Enabling or disabling users is not permitted for this workflow.');
  }

  const targetUserId = String(payload?.user_id || '').trim();
  assertTargetUserInScope(targetUserId, scope);

  const isDisabled = Boolean(payload?.is_disabled);
  const updated = await context.sdk.ok(
    context.sdk.update_user(targetUserId, { is_disabled: isDisabled })
  );

  return {
    success: true,
    user: updated,
    message: `User ${targetUserId} has been ${isDisabled ? 'disabled' : 'enabled'}.`
  };
}

export async function deleteUserAction(
  context: WorkflowContext,
  params: NormalizedUserManagementParameters,
  scope: ResolvedScopeContext,
  payload: any
): Promise<any> {
  if (!params.profile.allow_delete) {
    throw new Error('403 Forbidden: Deleting users is not permitted for this workflow.');
  }

  const targetUserId = String(payload?.user_id || '').trim();
  assertTargetUserInScope(targetUserId, scope);

  await context.sdk.ok(context.sdk.delete_user(targetUserId));
  return {
    success: true,
    user_id: targetUserId,
    message: `Successfully deleted user ${targetUserId}.`
  };
}

// --- Hoisted Pure Helpers ---

function filterUsersByScope(allUsers: any[], scope: ResolvedScopeContext): any[] {
  if (!scope.limitation.active) {
    return allUsers;
  }
  const allowedSet = new Set<string>(scope.limitation.userIds.map((id) => String(id)));
  return allUsers.filter((u: any) => allowedSet.has(String(u.id)));
}

async function fetchRolesNameMap(sdk: any): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (typeof sdk.all_roles !== 'function') {
    return map;
  }
  try {
    const roles = await sdk.ok(sdk.all_roles({ fields: 'id,name' }));
    for (const r of roles || []) {
      map.set(String(r.id), r.name || `Role ${r.id}`);
    }
  } catch (err) {
    // Ignore role map lookup failure
  }
  return map;
}

function formatUserSummary(
  u: any,
  scope: ResolvedScopeContext,
  groupNameMap: Map<string, string>,
  rolesMap: Map<string, string>
): any {
  const uid = String(u.id);
  const userGroupIds: string[] = (u.group_ids || []).map((g: any) => String(g));
  const userRoleIds: string[] = (u.role_ids || []).map((r: any) => String(r));

  const sharedScopeGroupIds = userGroupIds.filter((gid) =>
    scope.adminActiveScopeGroupIds.includes(gid)
  );
  const manageableGroupMemberships = userGroupIds
    .filter((gid) => scope.manageableGroupIdsSet.has(gid))
    .map((gid) => ({
      id: gid,
      name: groupNameMap.get(gid) || `Group ${gid}`,
      is_scope_group: scope.adminActiveScopeGroupIds.includes(gid)
    }));

  const directRoles = userRoleIds.map((rid) => ({
    id: rid,
    name: rolesMap.get(rid) || `Role ${rid}`
  }));

  return {
    id: uid,
    first_name: u.first_name || '',
    last_name: u.last_name || '',
    display_name:
      u.display_name ||
      `${u.first_name || ''} ${u.last_name || ''}`.trim() ||
      u.email ||
      `User ${uid}`,
    email: u.email || '',
    is_disabled: Boolean(u.is_disabled),
    group_ids: userGroupIds,
    role_ids: userRoleIds,
    shared_scope_group_ids: sharedScopeGroupIds,
    manageable_groups: manageableGroupMemberships,
    direct_roles: directRoles
  };
}

async function assertUserDoesNotExist(
  sdk: any,
  email: string,
  firstName: string,
  lastName: string
): Promise<void> {
  if (email) {
    if (typeof sdk.search_users === 'function') {
      const existingByEmail = await sdk.ok(sdk.search_users({ email }));
      if (Array.isArray(existingByEmail) && existingByEmail.length > 0) {
        throw new Error(`409 Conflict: A user with email "${email}" already exists.`);
      }
    }
  }

  const allUsers = await sdk.ok(sdk.all_users({ fields: 'id,first_name,last_name,email' }));
  for (const existing of allUsers || []) {
    if (email && String(existing.email || '').trim().toLowerCase() === email.toLowerCase()) {
      throw new Error(`409 Conflict: A user with email "${email}" already exists (ID: ${existing.id}).`);
    }
    if (
      !email &&
      firstName &&
      lastName &&
      String(existing.first_name || '').trim().toLowerCase() === firstName.toLowerCase() &&
      String(existing.last_name || '').trim().toLowerCase() === lastName.toLowerCase()
    ) {
      throw new Error(
        `409 Conflict: A user named "${firstName} ${lastName}" already exists (ID: ${existing.id}).`
      );
    }
  }
}
