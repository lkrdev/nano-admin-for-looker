import {
  NormalizedUserManagementParameters,
  ResolvedScopeContext,
  WorkflowContext
} from '../types';
import { assertTargetUserInScope } from '../scope';

export interface ScopedFolderAccessItem {
  folder_id: string;
  folder_name: string;
  parent_id: string | null;
  content_metadata_id: string;
  inherits: boolean;
  max_grantable_permission: 'view' | 'edit' | null;
  editable: boolean;
  direct_access: {
    access_id: string;
    permission_type: 'view' | 'edit';
  } | null;
  group_accesses: Array<{
    group_id: string;
    group_name: string;
    permission_type: 'view' | 'edit';
  }>;
  effective_permission: 'edit' | 'view' | null;
}

export async function getUserFolderAccessAction(
  context: WorkflowContext,
  params: NormalizedUserManagementParameters,
  scope: ResolvedScopeContext,
  payload: any
): Promise<any> {
  if (!params.folder_access.allow_view) {
    throw new Error('Viewing folder access is not permitted for this workflow.');
  }

  const targetUserId = String(payload?.user_id || '').trim();
  assertTargetUserInScope(targetUserId, scope);

  const folders = await evaluateScopedFoldersForUser(context, params, scope, targetUserId);
  return {
    user_id: targetUserId,
    allow_edit: params.folder_access.allow_edit,
    folders
  };
}

export async function setUserFolderAccessAction(
  context: WorkflowContext,
  params: NormalizedUserManagementParameters,
  scope: ResolvedScopeContext,
  payload: any
): Promise<any> {
  if (!params.folder_access.allow_edit) {
    throw new Error('403 Forbidden: Editing folder access is not permitted for this workflow.');
  }

  const targetUserId = String(payload?.user_id || '').trim();
  const folderId = String(payload?.folder_id || '').trim();
  const requestedPerm = String(payload?.permission_type || '').trim().toLowerCase();

  assertTargetUserInScope(targetUserId, scope);
  if (!folderId) {
    throw new Error('folder_id is required.');
  }
  if (requestedPerm !== 'view' && requestedPerm !== 'edit') {
    throw new Error('permission_type must be either "view" or "edit".');
  }

  const folders = await evaluateScopedFoldersForUser(context, params, scope, targetUserId);
  const targetFolder = folders.find((f) => f.folder_id === folderId);
  if (!targetFolder) {
    throw new Error(`403 Forbidden: Folder "${folderId}" is outside the admin's Scope Group folder hierarchy.`);
  }

  if (targetFolder.inherits) {
    throw new Error(
      `400 Bad Request: Folder "${targetFolder.folder_name}" inherits its access settings from a parent folder (` +
        `inherits: true). Direct user grants are only allowed on folders with custom access (inherits: false).`
    );
  }

  if (
    targetFolder.max_grantable_permission === 'view' &&
    requestedPerm === 'edit'
  ) {
    throw new Error(
      `403 Forbidden: Cannot grant "edit" access on folder "${targetFolder.folder_name}" because the admin's Scope Groups only hold "view" access.`
    );
  }

  if (!targetFolder.max_grantable_permission) {
    throw new Error(`403 Forbidden: No grantable permission available on folder "${targetFolder.folder_name}".`);
  }

  if (targetFolder.direct_access?.access_id) {
    await context.sdk.ok(
      context.sdk.update_content_metadata_access(targetFolder.direct_access.access_id, {
        content_metadata_id: targetFolder.content_metadata_id,
        permission_type: requestedPerm,
        user_id: targetUserId
      })
    );
  } else {
    await context.sdk.ok(
      context.sdk.create_content_metadata_access({
        content_metadata_id: targetFolder.content_metadata_id,
        permission_type: requestedPerm,
        user_id: targetUserId
      })
    );
  }

  return {
    success: true,
    user_id: targetUserId,
    folder_id: folderId,
    permission_type: requestedPerm,
    message: `Granted "${requestedPerm}" access on folder "${targetFolder.folder_name}" to user ${targetUserId}.`
  };
}

export async function removeUserFolderAccessAction(
  context: WorkflowContext,
  params: NormalizedUserManagementParameters,
  scope: ResolvedScopeContext,
  payload: any
): Promise<any> {
  if (!params.folder_access.allow_edit) {
    throw new Error('403 Forbidden: Editing folder access is not permitted for this workflow.');
  }

  const targetUserId = String(payload?.user_id || '').trim();
  const folderId = String(payload?.folder_id || '').trim();
  assertTargetUserInScope(targetUserId, scope);

  if (!folderId) {
    throw new Error('folder_id is required.');
  }

  const folders = await evaluateScopedFoldersForUser(context, params, scope, targetUserId);
  const targetFolder = folders.find((f) => f.folder_id === folderId);
  if (!targetFolder) {
    throw new Error(`403 Forbidden: Folder "${folderId}" is outside the admin's Scope Group folder hierarchy.`);
  }

  if (targetFolder.inherits) {
    throw new Error(
      `400 Bad Request: Folder "${targetFolder.folder_name}" inherits access from a parent folder and cannot be modified directly.`
    );
  }

  if (!targetFolder.direct_access?.access_id) {
    throw new Error(`User ${targetUserId} does not have a direct access grant on folder "${targetFolder.folder_name}".`);
  }

  await context.sdk.ok(
    context.sdk.delete_content_metadata_access(targetFolder.direct_access.access_id)
  );

  return {
    success: true,
    user_id: targetUserId,
    folder_id: folderId,
    message: `Revoked direct access on folder "${targetFolder.folder_name}" for user ${targetUserId}.`
  };
}

// --- Hoisted Pure Helpers ---

export async function evaluateScopedFoldersForUser(
  context: WorkflowContext,
  params: NormalizedUserManagementParameters,
  scope: ResolvedScopeContext,
  targetUserId: string
): Promise<ScopedFolderAccessItem[]> {
  const sdk = context.sdk;
  if (typeof sdk.all_folders !== 'function') {
    return [];
  }

  const [allFolders, targetUser, allGroups] = await Promise.all([
    sdk.ok(sdk.all_folders()),
    sdk.ok(sdk.user(targetUserId, 'id,group_ids')),
    typeof sdk.all_groups === 'function' ? sdk.ok(sdk.all_groups({ fields: 'id,name' })) : Promise.resolve([])
  ]);

  const userGroupIds = new Set<string>((targetUser?.group_ids || []).map((g: any) => String(g)));
  const groupNameMap = new Map<string, string>();
  for (const g of allGroups || []) {
    groupNameMap.set(String(g.id), g.name || `Group ${g.id}`);
  }
  for (const mg of scope.manageableGroups) {
    groupNameMap.set(mg.id, mg.name);
  }

  const nonPersonalFolders = (allFolders || []).filter(
    (f: any) => !f.is_personal && !f.is_personal_descendant && f.content_metadata_id
  );

  const folderById = new Map<string, any>();
  const childrenByParentId = new Map<string, string[]>();
  for (const f of nonPersonalFolders) {
    const fid = String(f.id);
    folderById.set(fid, f);
    if (f.parent_id !== undefined && f.parent_id !== null) {
      const pid = String(f.parent_id);
      if (!childrenByParentId.has(pid)) {
        childrenByParentId.set(pid, []);
      }
      childrenByParentId.get(pid)!.push(fid);
    }
  }

  // Fetch content_metadata and content_metadata_accesses for each candidate folder
  const metaByFolderId = new Map<string, { inherits: boolean; accesses: any[] }>();
  for (const f of nonPersonalFolders) {
    const fid = String(f.id);
    const cmId = String(f.content_metadata_id);
    let inherits = false;
    let accesses: any[] = [];

    if (typeof sdk.content_metadata === 'function') {
      try {
        const cm = await sdk.ok(sdk.content_metadata(cmId));
        inherits = Boolean(cm?.inherits);
      } catch (err) {
        inherits = false;
      }
    }

    if (typeof sdk.all_content_metadata_accesses === 'function') {
      try {
        accesses = await sdk.ok(sdk.all_content_metadata_accesses(cmId));
      } catch (err) {
        accesses = [];
      }
    }

    metaByFolderId.set(fid, { inherits, accesses: accesses || [] });
  }

  // Determine root folders accessible by admin's Scope Groups (or all folders if mode === 'none')
  const scopedPermissionByFolderId = new Map<string, 'view' | 'edit'>();

  if (scope.limitation.mode === 'none' || scope.limitation.mode === 'exclude_privileged') {
    for (const f of nonPersonalFolders) {
      scopedPermissionByFolderId.set(String(f.id), 'edit');
    }
  } else {
    for (const f of nonPersonalFolders) {
      const fid = String(f.id);
      const meta = metaByFolderId.get(fid);
      if (!meta) continue;

      const scopePerm = computeHighestScopeGroupPermission(
        meta.accesses,
        scope.manageableGroupIdsSet
      );
      if (scopePerm) {
        scopedPermissionByFolderId.set(fid, scopePerm);
      }
    }

    // Propagate scope access down to descendant folders
    const queue = Array.from(scopedPermissionByFolderId.keys());
    const visited = new Set<string>(queue);

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const parentPerm = scopedPermissionByFolderId.get(currentId)!;
      const children = childrenByParentId.get(currentId) || [];

      for (const childId of children) {
        const childMeta = metaByFolderId.get(childId);
        const directChildPerm = childMeta
          ? computeHighestScopeGroupPermission(childMeta.accesses, scope.manageableGroupIdsSet)
          : null;

        // If child inherits or doesn't explicitly restrict, inherit parent's scope permission cap
        const effectiveCap = directChildPerm || parentPerm;
        const existingCap = scopedPermissionByFolderId.get(childId);
        const mergedCap = mergeHigherPermission(existingCap || null, effectiveCap);
        if (mergedCap) {
          scopedPermissionByFolderId.set(childId, mergedCap);
        }

        if (!visited.has(childId)) {
          visited.add(childId);
          queue.push(childId);
        }
      }
    }
  }

  const results: ScopedFolderAccessItem[] = [];

  for (const f of nonPersonalFolders) {
    const fid = String(f.id);
    if (!scopedPermissionByFolderId.has(fid)) continue;

    const maxPerm = scopedPermissionByFolderId.get(fid) || null;
    const meta = metaByFolderId.get(fid) || { inherits: false, accesses: [] };
    const effectiveAccesses = resolveEffectiveAccessListForFolder(
      fid,
      folderById,
      metaByFolderId
    );

    let directAccess: { access_id: string; permission_type: 'view' | 'edit' } | null = null;
    const groupAccesses: Array<{
      group_id: string;
      group_name: string;
      permission_type: 'view' | 'edit';
    }> = [];

    for (const acc of meta.accesses) {
      const perm = normalizePerm(acc.permission_type);
      if (!perm) continue;
      if (acc.user_id !== undefined && acc.user_id !== null && String(acc.user_id) === targetUserId) {
        directAccess = {
          access_id: String(acc.id),
          permission_type: perm
        };
      }
    }

    for (const acc of effectiveAccesses) {
      const perm = normalizePerm(acc.permission_type);
      if (!perm) continue;
      if (acc.group_id !== undefined && acc.group_id !== null) {
        const gid = String(acc.group_id);
        if (userGroupIds.has(gid)) {
          groupAccesses.push({
            group_id: gid,
            group_name: groupNameMap.get(gid) || `Group ${gid}`,
            permission_type: perm
          });
        }
      }
    }

    let effectivePermission: 'view' | 'edit' | null = directAccess?.permission_type || null;
    for (const ga of groupAccesses) {
      effectivePermission = mergeHigherPermission(effectivePermission, ga.permission_type);
    }

    // If folder inherits, check if target user has direct access on the ancestor folder
    if (meta.inherits && !effectivePermission) {
      for (const acc of effectiveAccesses) {
        const perm = normalizePerm(acc.permission_type);
        if (perm && acc.user_id !== undefined && String(acc.user_id) === targetUserId) {
          effectivePermission = mergeHigherPermission(effectivePermission, perm);
        }
      }
    }

    results.push({
      folder_id: fid,
      folder_name: f.name || `Folder ${fid}`,
      parent_id: f.parent_id !== undefined && f.parent_id !== null ? String(f.parent_id) : null,
      content_metadata_id: String(f.content_metadata_id),
      inherits: meta.inherits,
      max_grantable_permission: maxPerm,
      editable: Boolean(params.folder_access.allow_edit && !meta.inherits && maxPerm),
      direct_access: directAccess,
      group_accesses: groupAccesses,
      effective_permission: effectivePermission
    });
  }

  return results;
}

function computeHighestScopeGroupPermission(
  accesses: any[],
  manageableGroupIdsSet: Set<string>
): 'view' | 'edit' | null {
  let highest: 'view' | 'edit' | null = null;
  for (const acc of accesses || []) {
    if (acc.group_id !== undefined && acc.group_id !== null) {
      const gid = String(acc.group_id);
      if (manageableGroupIdsSet.has(gid)) {
        const perm = normalizePerm(acc.permission_type);
        highest = mergeHigherPermission(highest, perm);
      }
    }
  }
  return highest;
}

function resolveEffectiveAccessListForFolder(
  folderId: string,
  folderById: Map<string, any>,
  metaByFolderId: Map<string, { inherits: boolean; accesses: any[] }>
): any[] {
  const visited = new Set<string>();
  let currId: string | null = folderId;

  while (currId && !visited.has(currId)) {
    visited.add(currId);
    const meta = metaByFolderId.get(currId);
    if (!meta) break;
    if (!meta.inherits || meta.accesses.length > 0) {
      return meta.accesses;
    }
    const folder = folderById.get(currId);
    currId = folder?.parent_id ? String(folder.parent_id) : null;
  }

  return metaByFolderId.get(folderId)?.accesses || [];
}

function normalizePerm(raw: any): 'view' | 'edit' | null {
  const str = String(raw || '').trim().toLowerCase();
  if (str === 'edit') return 'edit';
  if (str === 'view') return 'view';
  return null;
}

function mergeHigherPermission(
  a: 'view' | 'edit' | null,
  b: 'view' | 'edit' | null
): 'view' | 'edit' | null {
  if (a === 'edit' || b === 'edit') return 'edit';
  if (a === 'view' || b === 'view') return 'view';
  return null;
}
