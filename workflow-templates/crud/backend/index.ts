import { LookerNodeSDK } from '@looker/sdk-node';

export interface WorkflowContext {
  sdk: LookerNodeSDK;
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

export const handler = async (
  context: WorkflowContext,
  action: string,
  payload: any
): Promise<any> => {
  const target = context.parameters.target_object;
  const operations = context.parameters.supported_operations || [];
  
  // Verify that the requested action is one of the supported operations configured
  const isSupported = operations.some(op => op.name === action);
  if (!isSupported) {
    throw new Error(`Operation "${action}" is not permitted for workflow "${context.workflowId}"`);
  }

  const opConfig = operations.find(op => op.name === action);
  const allowedFields = opConfig?.fields || [];

  console.log(`[CRUD Backend] Executing "${action}" on "${target}" for workflow: ${context.workflowId}`);

  // Illustrative response logic
  if (action === 'list') {
    if (target === 'users') {
      const allUsers = [
        { id: '1', name: 'Alice Smith', email: 'alice@example.com', is_disabled: false },
        { id: '2', name: 'Bob Jones', email: 'bob@example.com', is_disabled: false },
        { id: '3', name: 'HR Audit Service', email: 'hr-audit@example.com', is_disabled: false }
      ];
      // Filter fields based on configuration
      return allUsers.map(user => {
        const filtered: Record<string, any> = {};
        allowedFields.forEach(f => {
          if (f in user) {
            filtered[f] = user[user.hasOwnProperty(f) ? (f as keyof typeof user) : 'id'];
          }
        });
        // Default to returning id/name/email if fields filter is empty or contains '*'
        return allowedFields.includes('*') || allowedFields.length === 0 ? user : filtered;
      });
    } else if (target === 'connections') {
      const allConnections = [
        { name: 'bigquery_production', dialect: 'bigquery', host: 'google.com' },
        { name: 'snowflake_analytics', dialect: 'snowflake', host: 'snowflakecomputing.com' }
      ];
      return allConnections.map(conn => {
        if (allowedFields.includes('*') || allowedFields.length === 0) return conn;
        const filtered: Record<string, any> = {};
        allowedFields.forEach(f => {
          if (f in conn) {
            filtered[f] = conn[f as keyof typeof conn];
          }
        });
        return filtered;
      });
    }
    return { message: `List action on unsupported target: ${target}` };
  }

  if (action === 'update') {
    const forcedValues = opConfig?.values || {};
    return {
      message: `Successfully executed UPDATE operation on target object "${target}"`,
      timestamp: new Date().toISOString(),
      applied_filters: payload,
      applied_values: forcedValues
    };
  }

  if (action === 'create') {
    return {
      message: `Successfully executed CREATE operation on target object "${target}"`,
      timestamp: new Date().toISOString(),
      payload
    };
  }

  if (action === 'read') {
    return {
      message: `Successfully read detail for target object "${target}"`,
      target_object: target,
      allowed_fields: allowedFields
    };
  }

  return {
    message: `Generic execution of action "${action}" on target "${target}"`,
    workflowId: context.workflowId,
    parameters: context.parameters
  };
};
