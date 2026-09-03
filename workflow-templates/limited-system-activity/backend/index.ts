import { getTenantUserIds } from '../../../auth_utils';

export interface ExploreConfig {
  name: string;
  allow_csv_export?: boolean;
  require_date_filter?: boolean;
  max_row_limit?: number;
}

export interface UserIdLimitation {
  enabled?: boolean;
  mode?: 'own' | 'tenant_groups';
  attribute_name?: string;
}

export interface WorkflowContext {
  sdk: any;
  userId: string;
  workflowId: string;
  parameters: {
    explores?: ExploreConfig[];
    user_id_limitation?: UserIdLimitation;
  };
}

/**
 * Explicit canonical mapping table for Looker system__activity explores to their target User ID dimension field.
 */
export const CANONICAL_SYSTEM_ACTIVITY_USER_ID_FIELDS: Record<string, string> = {
  history: 'history.user_id',
  dashboard: 'dashboard.user_id',
  dashboard_performance: 'dashboard_performance.user_id',
  look: 'look.user_id',
  event: 'event.user_id',
  event_attribute: 'event.user_id',
  query: 'user.id',
  query_metrics: 'query_metrics.user_id',
  sql_query: 'sql_query.user_id',
  scheduled_plan: 'scheduled_plan.user_id',
  conversation: 'conversation.user_id',
  user: 'user.id',
  user_attribute: 'user.id',
  group: 'user.id',
  merge_query: 'merge_query.user_id'
};

export const handler = async (
  context: WorkflowContext,
  action: string,
  payload: any
): Promise<any> => {
  const allowedExplores = context.parameters?.explores || [];
  const limitation = context.parameters?.user_id_limitation || {};

  if (action === 'get_explores') {
    const validatedExplores = await fetchAndValidateExplores(context.sdk, allowedExplores, limitation);
    return { explores: validatedExplores };
  }

  if (action === 'get_explore_fields') {
    const exploreName = String(payload?.explore_name || '').trim();
    validateExploreIsAllowed(exploreName, allowedExplores);
    const fields = await fetchExploreFields(context.sdk, exploreName);
    return { explore_name: exploreName, fields };
  }

  if (action === 'run_query') {
    const exploreName = String(payload?.explore_name || '').trim();
    const exploreConfig = validateExploreIsAllowed(exploreName, allowedExplores);
    const exploreMeta = await fetchExploreMetadata(context.sdk, exploreName);

    const userIdField = findUserIdFieldInExplore(exploreMeta, exploreName);
    const userIds = await resolveUserIdFilterValues(context.sdk, context.userId, limitation);
    const queryFilters = buildEnforcedFilters(payload?.filters || {}, limitation, userIds, userIdField);

    validatePerformancePresets(exploreConfig, payload?.fields || [], queryFilters, exploreMeta);

    const rowLimit = calculateRowLimit(payload?.limit, exploreConfig.max_row_limit);

    const queryResults = await executeInlineQuery(
      context.sdk,
      'json',
      exploreName,
      payload?.fields || [],
      queryFilters,
      rowLimit
    );

    return {
      explore_name: exploreName,
      rows: queryResults,
      row_count: Array.isArray(queryResults) ? queryResults.length : 0,
      limit_applied: rowLimit
    };
  }

  if (action === 'export_csv') {
    const exploreName = String(payload?.explore_name || '').trim();
    const exploreConfig = validateExploreIsAllowed(exploreName, allowedExplores);

    if (!exploreConfig.allow_csv_export) {
      throw new Error(`CSV export is not enabled for explore "${exploreName}".`);
    }

    const exploreMeta = await fetchExploreMetadata(context.sdk, exploreName);

    const userIdField = findUserIdFieldInExplore(exploreMeta, exploreName);
    const userIds = await resolveUserIdFilterValues(context.sdk, context.userId, limitation);
    const queryFilters = buildEnforcedFilters(payload?.filters || {}, limitation, userIds, userIdField);

    validatePerformancePresets(exploreConfig, payload?.fields || [], queryFilters, exploreMeta);

    const rowLimit = calculateRowLimit(payload?.limit, exploreConfig.max_row_limit);

    const csvData = await executeInlineQuery(
      context.sdk,
      'csv',
      exploreName,
      payload?.fields || [],
      queryFilters,
      rowLimit
    );

    return {
      explore_name: exploreName,
      csv_data: csvData
    };
  }

  throw new Error(`Unknown or unsupported action "${action}" for limited-system-activity workflow.`);
};

// --- Hoisted Pure Helper Functions ---

async function fetchAndValidateExplores(
  sdk: any,
  allowedExplores: ExploreConfig[],
  limitation: UserIdLimitation
): Promise<Array<ExploreConfig & { label: string; description: string; user_id_field: string; has_user_id: boolean; valid: boolean }>> {
  console.log(`[Limited-System-Activity] Validating ${allowedExplores.length} configured explores...`);
  const results = [];

  for (const config of allowedExplores) {
    try {
      const meta = await fetchExploreMetadata(sdk, config.name);
      const userIdField = findUserIdFieldInExplore(meta, config.name);
      const hasUserId = Boolean(userIdField);

      results.push({
        ...config,
        label: meta.label || config.name.charAt(0).toUpperCase() + config.name.slice(1),
        description: meta.description || `Explore ${config.name} in system__activity`,
        user_id_field: userIdField,
        has_user_id: hasUserId,
        valid: true
      });
    } catch (err: any) {
      console.warn(`[Limited-System-Activity] Could not fetch metadata for explore "${config.name}":`, err);
      const fallbackField = CANONICAL_SYSTEM_ACTIVITY_USER_ID_FIELDS[config.name] || 'user.id';
      results.push({
        ...config,
        label: config.name.charAt(0).toUpperCase() + config.name.slice(1),
        description: `System Activity explore ${config.name}`,
        user_id_field: fallbackField,
        has_user_id: true,
        valid: true
      });
    }
  }

  return results;
}

async function fetchExploreMetadata(sdk: any, exploreName: string): Promise<any> {
  return await sdk.ok(
    sdk.lookml_model_explore({
      lookml_model_name: 'system__activity',
      explore_name: exploreName
    })
  );
}

function validateExploreIsAllowed(exploreName: string, allowedExplores: ExploreConfig[]): ExploreConfig {
  if (!exploreName) {
    throw new Error('Explore name is required.');
  }
  const match = allowedExplores.find(e => e.name === exploreName);
  if (!match) {
    throw new Error(`Explore "${exploreName}" is not permitted for this workflow.`);
  }
  return match;
}

function findUserIdFieldInExplore(exploreMeta: any, exploreName: string): string {
  // 1. Explicit canonical mapping lookup
  const canonicalField = CANONICAL_SYSTEM_ACTIVITY_USER_ID_FIELDS[exploreName];
  const dimensions = exploreMeta?.fields?.dimensions || exploreMeta?.dimensions || [];

  if (canonicalField) {
    const match = dimensions.find((dim: any) => String(dim.name || '').toLowerCase() === canonicalField.toLowerCase());
    if (match) {
      return match.name;
    }
    // Return canonical mapping even if metadata search is incomplete
    return canonicalField;
  }

  // 2. Heuristic fallback search for unlisted explores
  for (const dim of dimensions) {
    const name = String(dim.name || '').toLowerCase();
    const label = String(dim.label || dim.label_short || '').toLowerCase();
    if (
      name === 'user.id' ||
      name.endsWith('.user_id') ||
      name.endsWith('_user_id') ||
      name === `${exploreName}.user_id` ||
      (name.includes('user') && (name.endsWith('.id') || label.includes('user id')))
    ) {
      return dim.name;
    }
  }

  return 'user.id';
}

async function resolveUserIdFilterValues(
  sdk: any,
  currentUserId: string,
  limitation: UserIdLimitation
): Promise<string[]> {
  if (!limitation.enabled) {
    return [];
  }

  const mode = limitation.mode || 'own';

  if (mode === 'own') {
    return [currentUserId];
  }

  if (mode === 'tenant_groups') {
    const attributeName = limitation.attribute_name || 'tenant';
    const tenantUserIds = await getTenantUserIds(sdk, currentUserId, attributeName);
    return tenantUserIds;
  }

  return [currentUserId];
}

function buildEnforcedFilters(
  userFilters: Record<string, string>,
  limitation: UserIdLimitation,
  userIds: string[],
  userIdFieldName: string = 'user.id'
): Record<string, string> {
  const filters: Record<string, string> = { ...userFilters };

  if (limitation.enabled) {
    const fieldName = userIdFieldName || 'user.id';
    if (userIds.length === 0) {
      filters[fieldName] = '-*'; // Matches no users if no tenant user IDs found
    } else {
      filters[fieldName] = userIds.join(',');
    }
  }

  return filters;
}

function validatePerformancePresets(
  exploreConfig: ExploreConfig,
  selectedFields: string[],
  filters: Record<string, string>,
  exploreMeta: any
): void {
  if (exploreConfig.require_date_filter) {
    const dateFieldNames = findDateFieldsInExplore(exploreMeta);
    const hasDateFilter = Object.keys(filters).some(filterField =>
      dateFieldNames.includes(filterField)
    );

    if (!hasDateFilter) {
      throw new Error(`Explore "${exploreConfig.name}" requires a filter on a date/time field (e.g. ${dateFieldNames.slice(0, 3).join(', ')}) before running a query.`);
    }
  }
}

function findDateFieldsInExplore(exploreMeta: any): string[] {
  const dimensions = exploreMeta?.fields?.dimensions || exploreMeta?.dimensions || [];
  return dimensions
    .filter((dim: any) => {
      const type = String(dim.type || '').toLowerCase();
      return type.includes('date') || type.includes('time') || type.includes('timestamp');
    })
    .map((dim: any) => dim.name);
}

function calculateRowLimit(userLimit?: number, maxRowLimit?: number): number {
  const parsedUserLimit = typeof userLimit === 'number' && userLimit > 0 ? userLimit : 500;

  if (typeof maxRowLimit === 'number' && maxRowLimit > 0) {
    return Math.min(parsedUserLimit, maxRowLimit);
  }

  return parsedUserLimit;
}

async function fetchExploreFields(sdk: any, exploreName: string): Promise<any> {
  const meta = await fetchExploreMetadata(sdk, exploreName);
  const fields = meta.fields || {};

  const mapField = (f: any, category: 'dimension' | 'measure') => ({
    name: f.name,
    label: f.label_short || f.label || f.name,
    group_label: f.group_label || f.view_label || meta.label,
    description: f.description || '',
    type: f.type,
    category,
    is_date: String(f.type || '').toLowerCase().includes('date') || String(f.type || '').toLowerCase().includes('time')
  });

  const dimensions = (fields.dimensions || []).map((f: any) => mapField(f, 'dimension'));
  const measures = (fields.measures || []).map((f: any) => mapField(f, 'measure'));

  return {
    dimensions,
    measures
  };
}

async function executeInlineQuery(
  sdk: any,
  resultFormat: 'json' | 'csv',
  exploreName: string,
  fields: string[],
  filters: Record<string, string>,
  limit: number
): Promise<any> {
  console.log(`[Limited-System-Activity] Executing inline query on system__activity/${exploreName}...`);
  return await sdk.ok(
    sdk.run_inline_query({
      result_format: resultFormat,
      body: {
        model: 'system__activity',
        view: exploreName,
        fields,
        filters,
        limit
      }
    })
  );
}
