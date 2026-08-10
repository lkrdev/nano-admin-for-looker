import { LookerNodeSDK } from '@looker/sdk-node';

export interface WorkflowContext {
  sdk: any;
  userId: string;
  workflowId: string;
  parameters: {
    target_object: string;
    supported_operations: Array<{
      name: string;
      fields?: string[];
      values?: Record<string, any>;
    }>;
  };
}

interface TargetMeta {
  singular: string;
  idParamName: string;
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
  const target = context.parameters.target_object;
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
    // Looker SDK signatures are inconsistent: some take a request object containing fields,
    // some take fields directly as a positional string argument, and some take no fields parameter.
    const objectBasedTargets = ['users', 'groups', 'roles', 'scheduled_plans'];
    const positionalTargets = ['connections', 'folders', 'looks', 'dashboards'];

    if (objectBasedTargets.includes(target)) {
      const listParams = fields ? { fields } : {};
      return await sdk.ok(sdkMethod.call(sdk, listParams));
    } else if (positionalTargets.includes(target)) {
      return await sdk.ok(sdkMethod.call(sdk, fields));
    } else {
      // For targets like permissions that do not support fields selection
      return await sdk.ok(sdkMethod.call(sdk));
    }
  }

  // 2. READ Operation
  if (action === 'read') {
    const id = String(payload?.id || '').trim();
    if (!id) {
      throw new Error(`Object ID is required for operation "read" on target "${target}"`);
    }
    return await sdk.ok(sdkMethod.call(sdk, id, fields));
  }

  // 3. CREATE Operation
  if (action === 'create') {
    const forcedValues = opConfig.values || {};
    const bodyPayload = payload?.body || payload || {};
    const createBody = { ...bodyPayload, ...forcedValues };
    
    // Remove ID properties in case they were passed during creation
    delete createBody.id;
    delete createBody[meta.idParamName];

    return await sdk.ok(sdkMethod.call(sdk, createBody));
  }

  // 4. UPDATE Operation
  if (action === 'update') {
    const id = String(payload?.id || '').trim();
    if (!id) {
      throw new Error(`Object ID is required for operation "update" on target "${target}"`);
    }
    const forcedValues = opConfig.values || {};
    const bodyPayload = payload?.body || payload || {};
    const updateBody = { ...bodyPayload, ...forcedValues };
    
    // Remove ID fields from body update payload to prevent API rejection
    delete updateBody.id;
    delete updateBody[meta.idParamName];

    return await sdk.ok(sdkMethod.call(sdk, id, updateBody));
  }

  // 5. DELETE Operation
  if (action === 'delete') {
    const id = String(payload?.id || '').trim();
    if (!id) {
      throw new Error(`Object ID is required for operation "delete" on target "${target}"`);
    }
    await sdk.ok(sdkMethod.call(sdk, id));
    return { message: `Successfully deleted ${meta.singular} "${id}"` };
  }

  throw new Error(`Unknown or unhandled operation: "${action}"`);
};
