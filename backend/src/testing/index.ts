import { resolveUserIdLimitation, getScopeGroupUserIds, parseYaml, UserIdLimitation } from '../auth_utils';
import { wrapLookerSDKWithLogging } from '../looker_logging_sdk';

export interface SDKCallRecord {
  method: string;
  args: any[];
  timestamp: number;
}

export interface MockSDKOptions {
  users?: Record<string, any>;
  userGroups?: Record<string, string[]>;
  scopeGroups?: Record<string, string[]>;
  userAttributes?: Array<{ id: string; name: string }>;
  groupAttributeValues?: Record<string, Array<{ group_id: string; value: string }>>;
  explores?: Record<string, any>;
  runningQueries?: any[];
  inlineQueryResults?: any;
  customHandlers?: Record<string, (...args: any[]) => any>;
}

export function createMockLookerSDK(options: MockSDKOptions = {}): any {
  const calls: SDKCallRecord[] = [];

  const baseSdk: any = {
    calls,
    ok: async (promise: any) => await promise,

    user: async (id: string) => {
      calls.push({ method: 'user', args: [id], timestamp: Date.now() });
      if (options.customHandlers?.user) {
        return options.customHandlers.user(id);
      }
      const groupIds = options.userGroups?.[id] || ['scope_group_1'];
      const mockUser = options.users?.[id] || { id, name: `User ${id}` };
      return { ...mockUser, group_ids: groupIds };
    },

    all_users: async (params?: any) => {
      calls.push({ method: 'all_users', args: [params], timestamp: Date.now() });
      if (options.customHandlers?.all_users) {
        return options.customHandlers.all_users(params);
      }
      if (options.users) {
        return Object.values(options.users);
      }
      return [
        { id: '1', name: 'User 1' },
        { id: '2', name: 'User 2' },
        { id: '3', name: 'User 3' }
      ];
    },

    all_user_attributes: async (params?: any) => {
      calls.push({ method: 'all_user_attributes', args: [params], timestamp: Date.now() });
      return (
        options.userAttributes || [
          { id: 'attr_100', name: 'nano_admin_is_workflow_scope_group' }
        ]
      );
    },

    all_user_attribute_group_values: async (attrId: string) => {
      calls.push({ method: 'all_user_attribute_group_values', args: [attrId], timestamp: Date.now() });
      return (
        options.groupAttributeValues?.[attrId] || [
          { group_id: 'scope_group_1', value: 'yes' }
        ]
      );
    },

    all_group_users: async (params: { group_id: string; fields?: string }) => {
      calls.push({ method: 'all_group_users', args: [params], timestamp: Date.now() });
      const groupId = params.group_id;
      const userIds = options.scopeGroups?.[groupId] || ['1', '2'];
      return userIds.map(id => ({ id }));
    },

    lookml_model_explore: async (params: { lookml_model_name: string; explore_name: string }) => {
      calls.push({ method: 'lookml_model_explore', args: [params], timestamp: Date.now() });
      const exploreName = params.explore_name;
      if (options.explores?.[exploreName]) {
        return options.explores[exploreName];
      }
      return {
        name: exploreName,
        label: exploreName,
        fields: {
          dimensions: [{ name: `${exploreName}.user_id`, label: 'User ID' }]
        }
      };
    },

    run_inline_query: async (params: any) => {
      calls.push({ method: 'run_inline_query', args: [params], timestamp: Date.now() });
      if (options.customHandlers?.run_inline_query) {
        return options.customHandlers.run_inline_query(params);
      }
      return options.inlineQueryResults !== undefined ? options.inlineQueryResults : [{ id: 1 }];
    },

    all_running_queries: async () => {
      calls.push({ method: 'all_running_queries', args: [], timestamp: Date.now() });
      return options.runningQueries || [];
    },

    kill_query: async (queryTaskId: string) => {
      calls.push({ method: 'kill_query', args: [queryTaskId], timestamp: Date.now() });
      return {};
    },

    create_user: async (body: any) => {
      calls.push({ method: 'create_user', args: [body], timestamp: Date.now() });
      return { id: 'new_user_1', ...body };
    },

    update_user: async (id: string, body: any) => {
      calls.push({ method: 'update_user', args: [id, body], timestamp: Date.now() });
      return { id, ...body };
    },

    delete_user: async (id: string) => {
      calls.push({ method: 'delete_user', args: [id], timestamp: Date.now() });
      return {};
    }
  };

  return wrapLookerSDKWithLogging(baseSdk);
}

export interface TestContextOptions {
  userId?: string;
  workflowId?: string;
  parameters?: Record<string, any>;
  sdkOptions?: MockSDKOptions;
  sdk?: any;
}

export function createTestContext(options: TestContextOptions = {}) {
  const userId = options.userId || '1';
  const workflowId = options.workflowId || 'test-workflow';
  const sdk = options.sdk || createMockLookerSDK(options.sdkOptions);
  const parameters = options.parameters || {};

  return {
    sdk,
    userId,
    workflowId,
    parameters,
    helpers: {
      getScopeGroupUserIds: (attributeName?: string) => getScopeGroupUserIds(sdk, userId, attributeName),
      resolveUserIdLimitation: (limitation?: UserIdLimitation) => resolveUserIdLimitation(sdk, userId, limitation)
    }
  };
}

export function parseMockWorkflowConfig(yamlString: string): any {
  return parseYaml(yamlString);
}
