import {
  resolveUserIdLimitation,
  UserIdLimitation,
  UserIdLimitationMode,
  UserIdLimitationResult
} from '../../../auth_utils';
import { LookerBackendSDK } from '../../../looker_logging_sdk';

export interface WorkflowContext {
  sdk: LookerBackendSDK | any;
  userId: string;
  workflowId: string;
  parameters: {
    target_object?: string;
    supported_operations?: Array<{
      name: string;
      fields?: string[];
      values?: Record<string, any>;
    }>;
    user_id_limitation?: UserIdLimitation;
  };
  helpers?: {
    getScopeGroupUserIds: (attributeName?: string, includeSubgroups?: boolean) => Promise<string[]>;
    resolveUserIdLimitation: (
      limitationConfig?: UserIdLimitation,
      defaultMode?: UserIdLimitationMode
    ) => Promise<UserIdLimitationResult>;
  };
}

interface TargetMeta {
  singular: string;
  idParamName: string;
  userIdParamName?: string;
  operations: {
    list?: string;
    read?: string;
    create?: string;
    update?: string;
    delete?: string;
  };
}

const TARGETS: Record<string, TargetMeta> = {
  users: {
    singular: 'user',
    idParamName: 'user_id',
    userIdParamName: 'id',
    operations: {
      list: 'all_users',
      read: 'user',
      create: 'create_user',
      update: 'update_user',
      delete: 'delete_user'
    }
  },
  groups: {
    singular: 'group',
    idParamName: 'group_id',
    operations: {
      list: 'all_groups',
      read: 'group',
      create: 'create_group',
      update: 'update_group',
      delete: 'delete_group'
    }
  },
  roles: {
    singular: 'role',
    idParamName: 'role_id',
    operations: {
      list: 'all_roles',
      read: 'role',
      create: 'create_role',
      update: 'update_role',
      delete: 'delete_role'
    }
  },
  connections: {
    singular: 'connection',
    idParamName: 'connection_name',
    operations: {
      list: 'all_connections',
      read: 'connection',
      create: 'create_connection',
      update: 'update_connection',
      delete: 'delete_connection'
    }
  },
  folders: {
    singular: 'folder',
    idParamName: 'folder_id',
    userIdParamName: 'user_id',
    operations: {
      list: 'all_folders',
      read: 'folder',
      create: 'create_folder',
      update: 'update_folder',
      delete: 'delete_folder'
    }
  },
  looks: {
    singular: 'look',
    idParamName: 'look_id',
    userIdParamName: 'user_id',
    operations: {
      list: 'all_looks',
      read: 'look',
      create: 'create_look',
      update: 'update_look',
      delete: 'delete_look'
    }
  },
  dashboards: {
    singular: 'dashboard',
    idParamName: 'dashboard_id',
    userIdParamName: 'user_id',
    operations: {
      list: 'all_dashboards',
      read: 'dashboard',
      create: 'create_dashboard',
      update: 'update_dashboard',
      delete: 'delete_dashboard'
    }
  },
  scheduled_plans: {
    singular: 'scheduled_plan',
    idParamName: 'scheduled_plan_id',
    userIdParamName: 'user_id',
    operations: {
      list: 'all_scheduled_plans',
      read: 'scheduled_plan',
      create: 'create_scheduled_plan',
      update: 'update_scheduled_plan',
      delete: 'delete_scheduled_plan'
    }
  },
  queries: {
    singular: 'query',
    idParamName: 'query_id',
    operations: {
      read: 'query',
      create: 'create_query'
    }
  },
  permissions: {
    singular: 'permission',
    idParamName: 'permission_id',
    operations: {
      list: 'all_permissions'
    }
  },
  content_metadata: {
    singular: 'content_metadata',
    idParamName: 'content_metadata_id',
    operations: {
      read: 'content_metadata',
      update: 'update_content_metadata'
    }
  }
};

export const handler = async (
  context: WorkflowContext,
  action: string,
  payload: any
): Promise<any> => {
  const sdk = context.sdk;
  const target = context.parameters?.target_object || '';
  const operations = context.parameters.supported_operations || [];

  // Verify that the requested action is one of the supported operations configured
  const opConfig = operations.find(op => op.name === action);
  if (!opConfig) {
    throw new Error(`Operation "${action}" is not permitted for workflow "${context.workflowId}"`);
  }

  // Look up metadata for the target object
  const meta = TARGETS[target];
  if (!meta) {
    throw new Error(`Unsupported target object: "${target}". Supported types are: ${Object.keys(TARGETS).join(', ')}`);
  }

  // Resolve user_id limitation scope (default to 'self' for user-owned resources)
  const limitation = await resolveLimitation(context, Boolean(meta.userIdParamName));

  // Reject configuration if user_id_limitation is enabled on a global non-user-owned object
  if (limitation.active && !meta.userIdParamName) {
    throw new Error(`Target object "${target}" is a global resource and cannot be scoped by user_id_limitation`);
  }

  const methodName = meta.operations[action as keyof typeof meta.operations];
  if (!methodName) {
    throw new Error(`Operation "${action}" is not supported by Looker for target type "${target}" (this resource type may be read-only or immutable)`);
  }

  const sdkMethod = sdk[methodName];
  if (typeof sdkMethod !== 'function') {
    throw new Error(`Looker SDK method "${methodName}" not found on client`);
  }

  const allowedFields = opConfig.fields || [];
  const fields = allowedFields.length > 0 && !allowedFields.includes('*') ? allowedFields.join(',') : undefined;

  console.log(`[CRUD Backend] Executing "${action}" (${methodName}) on "${target}" for workflow: ${context.workflowId}`);

  // 1. LIST Operation
  if (action === 'list') {
    let items: any[];
    const objectBasedTargets = ['users', 'groups', 'roles', 'scheduled_plans'];
    const positionalTargets = ['connections', 'folders', 'looks', 'dashboards'];

    if (objectBasedTargets.includes(target)) {
      const listParams = fields ? { fields } : {};
      items = await sdk.ok(sdkMethod.call(sdk, listParams));
    } else if (positionalTargets.includes(target)) {
      items = await sdk.ok(sdkMethod.call(sdk, fields));
    } else {
      items = await sdk.ok(sdkMethod.call(sdk));
    }

    if (limitation.active && meta.userIdParamName && Array.isArray(items)) {
      return items.filter(item => {
        const ownerId = extractOwnerUserId(item, meta);
        return ownerId !== '' && limitation.userIds.includes(ownerId);
      });
    }

    return items;
  }

  // 2. READ Operation
  if (action === 'read') {
    const id = String(payload?.id || '').trim();
    if (!id) {
      throw new Error(`Object ID is required for operation "read" on target "${target}"`);
    }
    if (limitation.active && target === 'users' && !limitation.userIds.includes(id)) {
      throw new Error(`403 Forbidden: Target ${meta.singular} does not belong to an allowed user scope`);
    }
    const item = await sdk.ok(sdkMethod.call(sdk, id, fields));

    if (limitation.active && meta.userIdParamName && item) {
      const ownerId = extractOwnerUserId(item, meta);
      if (!ownerId || !limitation.userIds.includes(ownerId)) {
        throw new Error(`403 Forbidden: Target ${meta.singular} does not belong to an allowed user scope`);
      }
    }

    return item;
  }

  // 3. CREATE Operation
  if (action === 'create') {
    const createBody = buildMutationBody(payload, opConfig, meta, action, context.workflowId);

    if (limitation.active && meta.userIdParamName) {
      const userKey = meta.userIdParamName;
      if (createBody[userKey] !== undefined && createBody[userKey] !== null) {
        const specifiedOwner = String(createBody[userKey]);
        if (!limitation.userIds.includes(specifiedOwner)) {
          throw new Error(`403 Forbidden: Specified owner user_id "${specifiedOwner}" is outside allowed user scope`);
        }
      } else if (userKey === 'user_id') {
        createBody.user_id = context.userId;
      }
    }

    return await sdk.ok(sdkMethod.call(sdk, createBody));
  }

  // 4. UPDATE Operation
  if (action === 'update') {
    const id = String(payload?.id || '').trim();
    if (!id) {
      throw new Error(`Object ID is required for operation "update" on target "${target}"`);
    }
    if (limitation.active && target === 'users' && !limitation.userIds.includes(id)) {
      throw new Error(`403 Forbidden: Target ${meta.singular} does not belong to an allowed user scope`);
    }

    if (limitation.active && meta.userIdParamName) {
      const readMethodName = meta.operations.read;
      if (readMethodName && typeof sdk[readMethodName] === 'function') {
        const existing = await sdk.ok(sdk[readMethodName].call(sdk, id));
        const ownerId = extractOwnerUserId(existing, meta);
        if (!ownerId || !limitation.userIds.includes(ownerId)) {
          throw new Error(`403 Forbidden: Target ${meta.singular} does not belong to an allowed user scope`);
        }
      }
    }

    const updateBody = buildMutationBody(payload, opConfig, meta, action, context.workflowId);

    if (limitation.active && meta.userIdParamName && updateBody[meta.userIdParamName] !== undefined) {
      const newOwnerId = String(updateBody[meta.userIdParamName]);
      if (!limitation.userIds.includes(newOwnerId)) {
        throw new Error(`403 Forbidden: Target owner user_id "${newOwnerId}" is outside allowed user scope`);
      }
    }

    return await sdk.ok(sdkMethod.call(sdk, id, updateBody));
  }

  // 5. DELETE Operation
  if (action === 'delete') {
    const id = String(payload?.id || '').trim();
    if (!id) {
      throw new Error(`Object ID is required for operation "delete" on target "${target}"`);
    }
    if (limitation.active && target === 'users' && !limitation.userIds.includes(id)) {
      throw new Error(`403 Forbidden: Target ${meta.singular} does not belong to an allowed user scope`);
    }

    if (limitation.active && meta.userIdParamName) {
      const readMethodName = meta.operations.read;
      if (readMethodName && typeof sdk[readMethodName] === 'function') {
        const existing = await sdk.ok(sdk[readMethodName].call(sdk, id));
        const ownerId = extractOwnerUserId(existing, meta);
        if (!ownerId || !limitation.userIds.includes(ownerId)) {
          throw new Error(`403 Forbidden: Target ${meta.singular} does not belong to an allowed user scope`);
        }
      }
    }

    await sdk.ok(sdkMethod.call(sdk, id));
    return { message: `Successfully deleted ${meta.singular} "${id}"` };
  }

  throw new Error(`Unknown or unhandled operation: "${action}"`);
};

// --- Helper Functions ---

/**
 * Extracts the owning user ID for a Looker resource without falling back to the
 * resource's own `id` on non-user objects (preventing ID collision bypasses on unowned/global resources).
 */
function extractOwnerUserId(item: any, meta: TargetMeta): string {
  if (!item || !meta.userIdParamName) return '';
  const direct = item[meta.userIdParamName];
  if (direct !== undefined && direct !== null && String(direct) !== '') {
    return String(direct);
  }
  if (meta.userIdParamName !== 'id' && item.user?.id !== undefined && item.user?.id !== null && String(item.user.id) !== '') {
    return String(item.user.id);
  }
  return '';
}

/**
 * Validates and constructs a Looker mutation body from untrusted payload input,
 * enforcing `opConfig.fields` as a strict allowlist (fail-closed when omitted)
 * and applying admin-configured `opConfig.values` last.
 */
function buildMutationBody(
  rawPayload: any,
  opConfig: { fields?: string[]; values?: Record<string, any> },
  meta: TargetMeta,
  action: string,
  workflowId: string
): Record<string, any> {
  const bodySource = rawPayload?.body !== undefined ? rawPayload.body : rawPayload;
  if (bodySource !== undefined && (bodySource === null || typeof bodySource !== 'object' || Array.isArray(bodySource))) {
    throw new Error(`Invalid payload body for operation "${action}" on workflow "${workflowId}"`);
  }

  const input = bodySource || {};
  const configuredFields = opConfig.fields;
  const allowAll = Array.isArray(configuredFields) && configuredFields.includes('*');
  const allowedSet = new Set(
    (Array.isArray(configuredFields) ? configuredFields : []).filter(
      f => f !== 'id' && f !== meta.idParamName
    )
  );

  const sanitized: Record<string, any> = {};
  const blockedKeys: string[] = [];

  for (const key of Object.keys(input)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      blockedKeys.push(key);
      continue;
    }
    if (key === 'id' || key === meta.idParamName) {
      continue;
    }
    if (!allowAll && !allowedSet.has(key)) {
      blockedKeys.push(key);
      continue;
    }
    sanitized[key] = input[key];
  }

  if (blockedKeys.length > 0) {
    throw new Error(
      `403 Forbidden: Field(s) "${blockedKeys.join(', ')}" are not permitted for operation "${action}" on workflow "${workflowId}"`
    );
  }

  const forcedValues = opConfig.values || {};
  const result = { ...sanitized, ...forcedValues };
  delete result.id;
  delete result[meta.idParamName];
  return result;
}

async function resolveLimitation(
  context: WorkflowContext,
  isUserOwnedResource: boolean
): Promise<UserIdLimitationResult> {
  const userLimitationConfig = context.parameters?.user_id_limitation;
  const defaultMode: UserIdLimitationMode =
    userLimitationConfig || isUserOwnedResource ? 'self' : 'none';
  if (context.helpers?.resolveUserIdLimitation) {
    return await context.helpers.resolveUserIdLimitation(userLimitationConfig, defaultMode);
  }
  return await resolveUserIdLimitation(context.sdk, context.userId, userLimitationConfig, defaultMode);
}

