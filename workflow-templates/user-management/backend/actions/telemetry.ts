import {
  NormalizedUserManagementParameters,
  ResolvedScopeContext,
  WorkflowContext
} from '../types';
import { assertTargetUserInScope } from '../scope';
import { evaluateScopedFoldersForUser } from './folders';

export async function getUserTelemetryAction(
  context: WorkflowContext,
  params: NormalizedUserManagementParameters,
  scope: ResolvedScopeContext,
  payload: any
): Promise<any> {
  if (!params.telemetry.allow_view_metrics && !params.telemetry.allow_manage_schedules) {
    throw new Error('Viewing telemetry and schedules is not permitted for this workflow.');
  }

  const targetUserId = String(payload?.user_id || '').trim();
  assertTargetUserInScope(targetUserId, scope);

  const sdk = context.sdk;
  const schedules = await fetchSchedulesForUser(sdk, targetUserId);
  const activeSchedulesCount = schedules.filter((s: any) => s.enabled !== false).length;

  let queryRunCount30d = 0;
  let approximateUsageMinutes30d = 0;
  let scheduledJobRuns30d = 0;
  let caConversationCount30d = 0;
  let caQueryCount30d = 0;
  let caBillingEvents30d: number | null = null;
  let accessibleFoldersCount = 0;

  if (params.telemetry.allow_view_metrics) {
    const [historyStats, scheduleRunStats, caConvStats, caQueryStats, billingStats, scopedFolders] =
      await Promise.all([
        queryHistoryTelemetry(sdk, targetUserId),
        queryScheduleJobTelemetry(sdk, targetUserId),
        queryCaConversationTelemetry(sdk, targetUserId),
        queryCaHistoryTelemetry(sdk, targetUserId),
        queryOptionalBillingEventTelemetry(sdk, targetUserId),
        evaluateScopedFoldersForUser(context, params, scope, targetUserId).catch(() => [])
      ]);

    queryRunCount30d = historyStats.queryRunCount;
    approximateUsageMinutes30d = historyStats.usageMinutes;
    scheduledJobRuns30d = scheduleRunStats.jobRunCount;
    caConversationCount30d = caConvStats.conversationCount;
    caQueryCount30d = caQueryStats.caQueryCount;
    caBillingEvents30d = billingStats.eventsConsumed;
    accessibleFoldersCount = scopedFolders.filter((f) => Boolean(f.effective_permission)).length;
  }

  return {
    user_id: targetUserId,
    allow_view_metrics: params.telemetry.allow_view_metrics,
    allow_manage_schedules: params.telemetry.allow_manage_schedules,
    metrics: {
      query_run_count_30d: queryRunCount30d,
      approximate_usage_minutes_30d: approximateUsageMinutes30d,
      active_schedules_count: activeSchedulesCount,
      total_schedules_count: schedules.length,
      scheduled_job_runs_30d: scheduledJobRuns30d,
      ca_conversations_30d: caConversationCount30d,
      ca_queries_30d: caQueryCount30d,
      ca_billing_tokens_30d: caBillingEvents30d,
      accessible_folders_count: accessibleFoldersCount
    },
    schedules
  };
}

export async function updateUserScheduleAction(
  context: WorkflowContext,
  params: NormalizedUserManagementParameters,
  scope: ResolvedScopeContext,
  payload: any
): Promise<any> {
  if (!params.telemetry.allow_manage_schedules) {
    throw new Error('403 Forbidden: Managing scheduled plans is not permitted for this workflow.');
  }

  const targetUserId = String(payload?.user_id || '').trim();
  const planId = String(payload?.scheduled_plan_id || '').trim();
  assertTargetUserInScope(targetUserId, scope);

  if (!planId) {
    throw new Error('scheduled_plan_id is required.');
  }

  await verifyScheduleBelongsToUser(context.sdk, planId, targetUserId);

  const enabled = Boolean(payload?.enabled);
  const updated = await context.sdk.ok(
    context.sdk.update_scheduled_plan(planId, { enabled })
  );

  return {
    success: true,
    user_id: targetUserId,
    scheduled_plan_id: planId,
    enabled,
    scheduled_plan: updated,
    message: `Scheduled plan ${planId} has been ${enabled ? 'enabled' : 'disabled'}.`
  };
}

export async function deleteUserScheduleAction(
  context: WorkflowContext,
  params: NormalizedUserManagementParameters,
  scope: ResolvedScopeContext,
  payload: any
): Promise<any> {
  if (!params.telemetry.allow_manage_schedules) {
    throw new Error('403 Forbidden: Managing scheduled plans is not permitted for this workflow.');
  }

  const targetUserId = String(payload?.user_id || '').trim();
  const planId = String(payload?.scheduled_plan_id || '').trim();
  assertTargetUserInScope(targetUserId, scope);

  if (!planId) {
    throw new Error('scheduled_plan_id is required.');
  }

  await verifyScheduleBelongsToUser(context.sdk, planId, targetUserId);
  await context.sdk.ok(context.sdk.delete_scheduled_plan(planId));

  return {
    success: true,
    user_id: targetUserId,
    scheduled_plan_id: planId,
    message: `Deleted scheduled plan ${planId}.`
  };
}

export async function reassignUserScheduleAction(
  context: WorkflowContext,
  params: NormalizedUserManagementParameters,
  scope: ResolvedScopeContext,
  payload: any
): Promise<any> {
  if (!params.telemetry.allow_manage_schedules) {
    throw new Error('403 Forbidden: Managing scheduled plans is not permitted for this workflow.');
  }

  const targetUserId = String(payload?.user_id || '').trim();
  const newOwnerUserId = String(payload?.new_owner_user_id || '').trim();
  const planId = String(payload?.scheduled_plan_id || '').trim();

  assertTargetUserInScope(targetUserId, scope);
  assertTargetUserInScope(newOwnerUserId, scope);

  if (!planId) {
    throw new Error('scheduled_plan_id is required.');
  }

  await verifyScheduleBelongsToUser(context.sdk, planId, targetUserId);

  const updated = await context.sdk.ok(
    context.sdk.update_scheduled_plan(planId, { user_id: newOwnerUserId })
  );

  return {
    success: true,
    user_id: targetUserId,
    new_owner_user_id: newOwnerUserId,
    scheduled_plan_id: planId,
    scheduled_plan: updated,
    message: `Reassigned scheduled plan ${planId} from user ${targetUserId} to user ${newOwnerUserId}.`
  };
}

// --- Hoisted Pure Helpers ---

async function fetchSchedulesForUser(sdk: any, userId: string): Promise<any[]> {
  let rawPlans: any[] = [];
  try {
    if (typeof sdk.scheduled_plans_for_user === 'function') {
      rawPlans = await sdk.ok(sdk.scheduled_plans_for_user({ user_id: userId }));
    } else if (typeof sdk.all_scheduled_plans === 'function') {
      rawPlans = await sdk.ok(sdk.all_scheduled_plans({ user_id: userId }));
    }
  } catch (err) {
    rawPlans = [];
  }

  return (rawPlans || [])
    .filter((p: any) => String(p.user_id ?? p.user?.id ?? userId) === userId)
    .map((p: any) => ({
      id: String(p.id),
      name: p.name || p.title || `Schedule ${p.id}`,
      enabled: p.enabled !== false,
      crontab: p.crontab || '',
      datagroup: p.datagroup || '',
      dashboard_id: p.dashboard_id ? String(p.dashboard_id) : null,
      look_id: p.look_id ? String(p.look_id) : null,
      next_run_at: p.next_run_at || null,
      last_run_at: p.last_run_at || null,
      user_id: String(p.user_id ?? p.user?.id ?? userId)
    }));
}

async function verifyScheduleBelongsToUser(
  sdk: any,
  planId: string,
  expectedUserId: string
): Promise<void> {
  if (typeof sdk.scheduled_plan === 'function') {
    const plan = await sdk.ok(sdk.scheduled_plan(planId));
    const ownerId = String(plan?.user_id ?? plan?.user?.id ?? '');
    if (ownerId && ownerId !== expectedUserId) {
      throw new Error(
        `403 Forbidden: Scheduled plan ${planId} belongs to user ${ownerId}, not ${expectedUserId}.`
      );
    }
    return;
  }

  const userPlans = await fetchSchedulesForUser(sdk, expectedUserId);
  const found = userPlans.some((p) => p.id === planId);
  if (!found) {
    throw new Error(
      `403 Forbidden: Scheduled plan ${planId} does not belong to user ${expectedUserId}.`
    );
  }
}

async function queryHistoryTelemetry(
  sdk: any,
  userId: string
): Promise<{ queryRunCount: number; usageMinutes: number }> {
  if (typeof sdk.run_inline_query !== 'function') {
    return { queryRunCount: 0, usageMinutes: 0 };
  }
  try {
    const rows = await sdk.ok(
      sdk.run_inline_query({
        result_format: 'json',
        body: {
          model: 'system__activity',
          view: 'history',
          fields: ['history.query_run_count', 'history.approximate_usage_in_minutes'],
          filters: {
            'history.user_id': userId,
            'history.created_date': '30 days'
          },
          limit: 1
        }
      })
    );
    const first = Array.isArray(rows) && rows.length > 0 ? rows[0] : {};
    return {
      queryRunCount: Number(first['history.query_run_count'] ?? first['history.count'] ?? 0) || 0,
      usageMinutes: Number(first['history.approximate_usage_in_minutes'] ?? 0) || 0
    };
  } catch (err) {
    return { queryRunCount: 0, usageMinutes: 0 };
  }
}

async function queryScheduleJobTelemetry(
  sdk: any,
  userId: string
): Promise<{ jobRunCount: number }> {
  if (typeof sdk.run_inline_query !== 'function') {
    return { jobRunCount: 0 };
  }
  try {
    const rows = await sdk.ok(
      sdk.run_inline_query({
        result_format: 'json',
        body: {
          model: 'system__activity',
          view: 'scheduled_plan',
          fields: ['scheduled_job.count'],
          filters: {
            'scheduled_plan.user_id': userId,
            'scheduled_job.created_date': '30 days'
          },
          limit: 1
        }
      })
    );
    const first = Array.isArray(rows) && rows.length > 0 ? rows[0] : {};
    return {
      jobRunCount: Number(first['scheduled_job.count'] ?? 0) || 0
    };
  } catch (err) {
    return { jobRunCount: 0 };
  }
}

async function queryCaConversationTelemetry(
  sdk: any,
  userId: string
): Promise<{ conversationCount: number }> {
  if (typeof sdk.run_inline_query !== 'function') {
    return { conversationCount: 0 };
  }
  try {
    const rows = await sdk.ok(
      sdk.run_inline_query({
        result_format: 'json',
        body: {
          model: 'system__activity',
          view: 'conversation',
          fields: ['conversation.count'],
          filters: {
            'conversation.user_id': userId,
            'conversation.created_date': '30 days'
          },
          limit: 1
        }
      })
    );
    const first = Array.isArray(rows) && rows.length > 0 ? rows[0] : {};
    return {
      conversationCount: Number(first['conversation.count'] ?? 0) || 0
    };
  } catch (err) {
    return { conversationCount: 0 };
  }
}

async function queryCaHistoryTelemetry(
  sdk: any,
  userId: string
): Promise<{ caQueryCount: number }> {
  if (typeof sdk.run_inline_query !== 'function') {
    return { caQueryCount: 0 };
  }
  try {
    const rows = await sdk.ok(
      sdk.run_inline_query({
        result_format: 'json',
        body: {
          model: 'system__activity',
          view: 'history',
          fields: ['history.query_run_count'],
          filters: {
            'history.user_id': userId,
            'history.created_date': '30 days',
            'query_api_client_context.is_conversational_analytics_query': 'Yes'
          },
          limit: 1
        }
      })
    );
    const first = Array.isArray(rows) && rows.length > 0 ? rows[0] : {};
    return {
      caQueryCount: Number(first['history.query_run_count'] ?? 0) || 0
    };
  } catch (err) {
    return { caQueryCount: 0 };
  }
}

async function queryOptionalBillingEventTelemetry(
  sdk: any,
  userId: string
): Promise<{ eventsConsumed: number | null }> {
  if (typeof sdk.run_inline_query !== 'function') {
    return { eventsConsumed: null };
  }
  try {
    const rows = await sdk.ok(
      sdk.run_inline_query({
        result_format: 'json',
        body: {
          model: 'system__activity',
          view: 'billing_event',
          fields: ['billing_event.count_events_consumed'],
          filters: {
            'billing_event.user_id': userId,
            'billing_event.event_date': '30 days'
          },
          limit: 1
        }
      })
    );
    const first = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    if (!first || first['billing_event.count_events_consumed'] === undefined) {
      return { eventsConsumed: null };
    }
    return {
      eventsConsumed: Number(first['billing_event.count_events_consumed']) || 0
    };
  } catch (err) {
    // Graceful fallback when looker_billing dataset is not configured on the instance
    return { eventsConsumed: null };
  }
}
