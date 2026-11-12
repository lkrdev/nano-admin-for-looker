import {
  NormalizedUserManagementParameters,
  ResolvedScopeContext,
  WorkflowContext
} from '../types';
import { assertTargetUserInScope } from '../scope';

export interface EvaluatedRoleInfo {
  id: string;
  name: string;
  is_admin_role: boolean;
  assignable: boolean;
  is_direct: boolean;
  inherited_from_groups: Array<{ id: string; name: string }>;
  permissions: string[];
  models: string[];
  model_set_all_access: boolean;
}

export async function getUserRolesAction(
  context: WorkflowContext,
  params: NormalizedUserManagementParameters,
  scope: ResolvedScopeContext,
  payload: any
): Promise<any> {
  if (!params.roles.allow_view) {
    throw new Error('Viewing user roles is not permitted for this workflow.');
  }

  const targetUserId = String(payload?.user_id || '').trim();
  assertTargetUserInScope(targetUserId, scope);

  const roles = await evaluateRolesForTargetUser(context, params, targetUserId);
  return {
    user_id: targetUserId,
    allow_edit: params.roles.allow_edit,
    roles
  };
}

export async function setUserRolesAction(
  context: WorkflowContext,
  params: NormalizedUserManagementParameters,
  scope: ResolvedScopeContext,
  payload: any
): Promise<any> {
  if (!params.roles.allow_edit) {
    throw new Error('403 Forbidden: Editing user roles is not permitted for this workflow.');
  }

  const targetUserId = String(payload?.user_id || '').trim();
  assertTargetUserInScope(targetUserId, scope);

  if (!Array.isArray(payload?.role_ids)) {
    throw new Error('role_ids array is required.');
  }
  const desiredRoleIds = payload.role_ids.map((id: any) => String(id).trim()).filter(Boolean);

  const evaluatedRoles = await evaluateRolesForTargetUser(context, params, targetUserId);
  const roleById = new Map<string, EvaluatedRoleInfo>();
  for (const r of evaluatedRoles) {
    roleById.set(r.id, r);
  }

  // Verify every requested role is assignable by the invoking admin
  for (const reqId of desiredRoleIds) {
    const rMeta = roleById.get(reqId);
    if (!rMeta) {
      throw new Error(`Role ID "${reqId}" does not exist.`);
    }
    if (!rMeta.assignable) {
      if (rMeta.is_admin_role) {
        throw new Error(`403 Forbidden: Assigning Admin role "${rMeta.name}" is strictly prohibited.`);
      }
      throw new Error(
        `403 Forbidden: Role "${rMeta.name}" (ID: ${reqId}) exceeds the invoking admin's effective permissions/models or is not in allowed_role_ids.`
      );
    }
  }

  // Preserve any existing out-of-scope direct roles on the target user
  const preservedOutOfScopeDirectIds = evaluatedRoles
    .filter((r) => r.is_direct && !r.assignable)
    .map((r) => r.id);

  const finalDirectRoleIds = Array.from(
    new Set<string>([...preservedOutOfScopeDirectIds, ...desiredRoleIds])
  );

  await context.sdk.ok(context.sdk.set_user_roles(targetUserId, finalDirectRoleIds));

  return {
    success: true,
    user_id: targetUserId,
    direct_role_ids: finalDirectRoleIds,
    preserved_out_of_scope_role_ids: preservedOutOfScopeDirectIds,
    message: `Updated direct roles for user ${targetUserId}.`
  };
}

// --- Hoisted Pure Helpers ---

export async function evaluateRolesForTargetUser(
  context: WorkflowContext,
  params: NormalizedUserManagementParameters,
  targetUserId: string
): Promise<EvaluatedRoleInfo[]> {
  const sdk = context.sdk;
  const [allRoles, targetUser, adminUser] = await Promise.all([
    sdk.ok(sdk.all_roles({})),
    sdk.ok(sdk.user(targetUserId, 'id,role_ids,group_ids')),
    sdk.ok(sdk.user(context.userId, 'id,role_ids,group_ids'))
  ]);

  const targetDirectRoleIds = new Set<string>(
    (targetUser?.role_ids || []).map((id: any) => String(id))
  );
  const targetGroupIds = new Set<string>(
    (targetUser?.group_ids || []).map((id: any) => String(id))
  );

  const groupRolesInfo = await fetchGroupRolesMap(sdk, allRoles || []);
  const adminEffectiveRoleIds = await resolveEffectiveRoleIdsForUser(
    sdk,
    context.userId,
    adminUser,
    groupRolesInfo.roleIdsByGroupId
  );

  const adminCapabilities = computeEffectiveCapabilities(allRoles || [], adminEffectiveRoleIds);
  const explicitAllowlist = new Set<string>(params.roles.allowed_role_ids);

  const evaluated: EvaluatedRoleInfo[] = [];

  for (const role of allRoles || []) {
    const roleId = String(role.id);
    const roleName = String(role.name || `Role ${roleId}`);
    const isAdmin = isRoleAdmin(role);
    const permissions: string[] = Array.isArray(role.permission_set?.permissions)
      ? role.permission_set.permissions.map((p: any) => String(p))
      : [];
    const models: string[] = Array.isArray(role.model_set?.models)
      ? role.model_set.models.map((m: any) => String(m))
      : [];
    const modelAllAccess = Boolean(role.model_set?.all_access || role.model_set?.unlimited);

    const withinAllowlist = explicitAllowlist.size === 0 || explicitAllowlist.has(roleId);
    const withinAdminSubset = isRoleSubsetOfAdmin(
      permissions,
      models,
      modelAllAccess,
      adminCapabilities
    );

    const assignable =
      params.roles.allow_edit && !isAdmin && withinAllowlist && withinAdminSubset;

    const groupsForRole = groupRolesInfo.groupsByRoleId.get(roleId) || [];
    const inheritedFromGroups = groupsForRole.filter((g) => targetGroupIds.has(g.id));

    evaluated.push({
      id: roleId,
      name: roleName,
      is_admin_role: isAdmin,
      assignable,
      is_direct: targetDirectRoleIds.has(roleId),
      inherited_from_groups: inheritedFromGroups,
      permissions,
      models,
      model_set_all_access: modelAllAccess
    });
  }

  return evaluated;
}

export function isRoleAdmin(role: any): boolean {
  if (!role) return false;
  if (String(role.name || '').trim().toLowerCase() === 'admin') return true;
  if (role.permission_set?.all_access === true || role.permission_set?.unlimited === true) return true;
  const perms: string[] = Array.isArray(role.permission_set?.permissions)
    ? role.permission_set.permissions
    : [];
  return perms.includes('administer');
}

function computeEffectiveCapabilities(
  allRoles: any[],
  effectiveRoleIds: Set<string>
): {
  hasAllPermissions: boolean;
  hasAllModels: boolean;
  permissions: Set<string>;
  models: Set<string>;
} {
  let hasAllPermissions = false;
  let hasAllModels = false;
  const permissions = new Set<string>();
  const models = new Set<string>();

  for (const role of allRoles) {
    if (!effectiveRoleIds.has(String(role.id))) continue;

    if (isRoleAdmin(role)) {
      hasAllPermissions = true;
      hasAllModels = true;
    }
    if (role.model_set?.all_access === true || role.model_set?.unlimited === true) {
      hasAllModels = true;
    }
    for (const p of role.permission_set?.permissions || []) {
      permissions.add(String(p));
    }
    for (const m of role.model_set?.models || []) {
      models.add(String(m));
    }
  }

  return { hasAllPermissions, hasAllModels, permissions, models };
}

function isRoleSubsetOfAdmin(
  rolePermissions: string[],
  roleModels: string[],
  roleModelAllAccess: boolean,
  adminCaps: {
    hasAllPermissions: boolean;
    hasAllModels: boolean;
    permissions: Set<string>;
    models: Set<string>;
  }
): boolean {
  if (!adminCaps.hasAllPermissions) {
    for (const p of rolePermissions) {
      if (!adminCaps.permissions.has(p)) {
        return false;
      }
    }
  }

  if (roleModelAllAccess && !adminCaps.hasAllModels) {
    return false;
  }

  if (!adminCaps.hasAllModels) {
    for (const m of roleModels) {
      if (!adminCaps.models.has(m)) {
        return false;
      }
    }
  }

  return true;
}

async function resolveEffectiveRoleIdsForUser(
  sdk: any,
  userId: string,
  userObj: any,
  roleIdsByGroupId: Map<string, string[]>
): Promise<Set<string>> {
  const effectiveIds = new Set<string>();
  for (const rid of userObj?.role_ids || []) {
    effectiveIds.add(String(rid));
  }
  for (const gid of userObj?.group_ids || []) {
    const gRoles = roleIdsByGroupId.get(String(gid)) || [];
    gRoles.forEach((rid) => effectiveIds.add(rid));
  }

  if (typeof sdk.user_roles === 'function') {
    try {
      const apiRoles = await sdk.ok(sdk.user_roles({ user_id: userId }));
      for (const r of apiRoles || []) {
        if (r.id !== undefined && r.id !== null) {
          effectiveIds.add(String(r.id));
        }
      }
    } catch (err) {
      // Fallback to userObj.role_ids + group roles
    }
  }

  return effectiveIds;
}

async function fetchGroupRolesMap(
  sdk: any,
  allRoles: any[]
): Promise<{
  groupsByRoleId: Map<string, Array<{ id: string; name: string }>>;
  roleIdsByGroupId: Map<string, string[]>;
}> {
  const groupsByRoleId = new Map<string, Array<{ id: string; name: string }>>();
  const roleIdsByGroupId = new Map<string, string[]>();

  if (typeof sdk.role_groups === 'function') {
    for (const role of allRoles) {
      const roleId = String(role.id);
      try {
        const groups = await sdk.ok(sdk.role_groups(roleId, 'id,name'));
        const list = (groups || []).map((g: any) => ({
          id: String(g.id),
          name: String(g.name || `Group ${g.id}`)
        }));
        groupsByRoleId.set(roleId, list);
        for (const g of list) {
          if (!roleIdsByGroupId.has(g.id)) {
            roleIdsByGroupId.set(g.id, []);
          }
          roleIdsByGroupId.get(g.id)!.push(roleId);
        }
      } catch (err) {
        // Ignore individual role_groups failure
      }
    }
  } else if (typeof sdk.search_groups_with_hierarchy === 'function') {
    try {
      const hierarchy = await sdk.ok(sdk.search_groups_with_hierarchy({}));
      for (const g of hierarchy || []) {
        const gid = String(g.id);
        const gName = String(g.name || `Group ${gid}`);
        const rids: string[] = Array.isArray(g.role_ids) ? g.role_ids.map((r: any) => String(r)) : [];
        roleIdsByGroupId.set(gid, rids);
        for (const rid of rids) {
          if (!groupsByRoleId.has(rid)) {
            groupsByRoleId.set(rid, []);
          }
          groupsByRoleId.get(rid)!.push({ id: gid, name: gName });
        }
      }
    } catch (err) {
      // Ignore
    }
  }

  return { groupsByRoleId, roleIdsByGroupId };
}
