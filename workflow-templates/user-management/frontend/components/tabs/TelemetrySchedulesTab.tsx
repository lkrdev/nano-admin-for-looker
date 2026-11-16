import React, { useEffect, useState } from 'react';
import { DirectoryUser } from '../../types';
import {
  cardStyle,
  dangerBtnStyle,
  inputStyle,
  pillStyle,
  primaryBtnStyle,
  secondaryBtnStyle
} from '../../styles';

export interface TelemetrySchedulesTabProps {
  userId: string;
  inScopeUsers: DirectoryUser[];
  callBackend: (action: string, payload?: any) => Promise<any>;
  addLog: (msg: string) => void;
}

export const TelemetrySchedulesTab: React.FC<TelemetrySchedulesTabProps> = ({
  userId,
  inScopeUsers,
  callBackend,
  addLog
}) => {
  // 1. Hook Declarations
  const [loading, setLoading] = useState<boolean>(true);
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [telemetryData, setTelemetryData] = useState<any | null>(null);
  const [reassignTargets, setReassignTargets] = useState<Record<string, string>>({});
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const metrics = telemetryData?.metrics || {};
  const schedules = telemetryData?.schedules || [];
  const allowViewMetrics = Boolean(telemetryData?.allow_view_metrics);
  const allowManageSchedules = Boolean(telemetryData?.allow_manage_schedules);
  const activeCandidateOwners = inScopeUsers.filter((u) => !u.is_disabled && u.id !== userId);

  useEffect(handleFetchTelemetry, [userId]);

  // 2. Returned Component JSX
  if (loading) {
    return <div style={cardStyle}>Loading user telemetry & scheduled plans...</div>;
  }

  return (
    <div>
      {statusMsg && (
        <div
          style={{
            padding: '10px 14px',
            borderRadius: '6px',
            marginBottom: '16px',
            fontSize: '13px',
            background: statusMsg.type === 'error' ? '#fef2f2' : '#f0fdf4',
            border: `1px solid ${statusMsg.type === 'error' ? '#fecaca' : '#bbf7d0'}`,
            color: statusMsg.type === 'error' ? '#991b1b' : '#166534'
          }}
        >
          {statusMsg.text}
        </div>
      )}

      {allowViewMetrics && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '16px' }}>
          <div style={{ ...cardStyle, marginBottom: 0, borderTop: '3px solid #2563eb' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#64748b' }}>30-Day Query Volume</div>
            <div style={{ fontSize: '24px', fontWeight: 800, color: '#0f172a', margin: '4px 0' }}>
              {metrics.query_run_count_30d ?? 0}
            </div>
            <div style={{ fontSize: '11px', color: '#64748b' }}>
              ~{metrics.approximate_usage_minutes_30d ?? 0} mins runtime
            </div>
          </div>

          <div style={{ ...cardStyle, marginBottom: 0, borderTop: '3px solid #059669' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#64748b' }}>Active Schedules</div>
            <div style={{ fontSize: '24px', fontWeight: 800, color: '#0f172a', margin: '4px 0' }}>
              {metrics.active_schedules_count ?? 0}
            </div>
            <div style={{ fontSize: '11px', color: '#64748b' }}>
              {metrics.total_schedules_count ?? 0} total schedule(s)
            </div>
          </div>

          <div style={{ ...cardStyle, marginBottom: 0, borderTop: '3px solid #7c3aed' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#64748b' }}>Scheduled Plan Runs (30d)</div>
            <div style={{ fontSize: '24px', fontWeight: 800, color: '#0f172a', margin: '4px 0' }}>
              {metrics.scheduled_job_runs_30d ?? 0}
            </div>
            <div style={{ fontSize: '11px', color: '#64748b' }}>
              Executed job runs
            </div>
          </div>

          <div style={{ ...cardStyle, marginBottom: 0, borderTop: '3px solid #d97706' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#64748b' }}>CA Usage (30d)</div>
            <div style={{ fontSize: '24px', fontWeight: 800, color: '#0f172a', margin: '4px 0' }}>
              {metrics.ca_queries_30d ?? 0} <span style={{ fontSize: '12px', fontWeight: 500 }}>queries</span>
            </div>
            <div style={{ fontSize: '11px', color: '#64748b' }}>
              {metrics.ca_conversations_30d ?? 0} conv(s)
              {metrics.ca_billing_tokens_30d !== null && metrics.ca_billing_tokens_30d !== undefined
                ? ` • ${metrics.ca_billing_tokens_30d} billing events`
                : ''}
            </div>
          </div>

          <div style={{ ...cardStyle, marginBottom: 0, borderTop: '3px solid #0284c7' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#64748b' }}>Scoped Folder Access</div>
            <div style={{ fontSize: '24px', fontWeight: 800, color: '#0f172a', margin: '4px 0' }}>
              {metrics.accessible_folders_count ?? 0}
            </div>
            <div style={{ fontSize: '11px', color: '#64748b' }}>
              Accessible scoped folders
            </div>
          </div>
        </div>
      )}

      <div style={cardStyle}>
        <h3 style={{ margin: '0 0 6px 0', fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>
          User-Owned Scheduled Plans ({schedules.length})
        </h3>
        <p style={{ margin: '0 0 14px 0', fontSize: '12px', color: '#64748b' }}>
          Inspect and manage scheduled deliveries owned by this user. Reassignment is restricted to active users within your allowed scope.
        </p>

        {schedules.length === 0 ? (
          <div style={{ fontSize: '13px', color: '#64748b' }}>
            No scheduled plans owned by this user.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', textAlign: 'left', color: '#475569' }}>
                <th style={{ padding: '8px 12px' }}>Schedule Name</th>
                <th style={{ padding: '8px 12px' }}>Status</th>
                <th style={{ padding: '8px 12px' }}>Schedule / Trigger</th>
                {allowManageSchedules && <th style={{ padding: '8px 12px' }}>Reassign Owner</th>}
                {allowManageSchedules && <th style={{ padding: '8px 12px', textAlign: 'right' }}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {schedules.map((sp: any) => (
                <tr key={sp.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '10px 12px', fontWeight: 600 }}>
                    {sp.name} <span style={{ color: '#94a3b8', fontWeight: 400 }}>(ID: {sp.id})</span>
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    {sp.enabled ? (
                      <span style={pillStyle('#ecfdf5', '#059669')}>Enabled</span>
                    ) : (
                      <span style={pillStyle('#f1f5f9', '#64748b')}>Disabled</span>
                    )}
                  </td>
                  <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontSize: '12px', color: '#475569' }}>
                    {sp.crontab || sp.datagroup || 'Custom'}
                  </td>
                  {allowManageSchedules && (
                    <td style={{ padding: '10px 12px' }}>
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        <select
                          value={reassignTargets[sp.id] || ''}
                          onChange={(e) => handleReassignTargetChange(sp.id, e.target.value)}
                          disabled={actionLoading}
                          style={{ ...inputStyle, width: '170px', padding: '4px 8px', fontSize: '12px' }}
                        >
                          <option value="">Select user...</option>
                          {activeCandidateOwners.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.display_name} ({u.id})
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() => handleReassignSchedule(sp.id)}
                          disabled={actionLoading || !reassignTargets[sp.id]}
                          style={{ ...primaryBtnStyle, padding: '4px 8px', fontSize: '11px' }}
                        >
                          Reassign
                        </button>
                      </div>
                    </td>
                  )}
                  {allowManageSchedules && (
                    <td style={{ padding: '10px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                        <button
                          onClick={() => handleToggleSchedule(sp.id, !sp.enabled)}
                          disabled={actionLoading}
                          style={{ ...secondaryBtnStyle, padding: '4px 8px', fontSize: '11px' }}
                        >
                          {sp.enabled ? 'Disable' : 'Enable'}
                        </button>
                        <button
                          onClick={() => handleDeleteSchedule(sp.id)}
                          disabled={actionLoading}
                          style={{ ...dangerBtnStyle, padding: '4px 8px', fontSize: '11px' }}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );

  // 3. Hoisted Function Implementations
  function handleFetchTelemetry() {
    setLoading(true);
    callBackend('get_user_telemetry', { user_id: userId })
      .then((res) => setTelemetryData(res))
      .catch((err) => setStatusMsg({ type: 'error', text: err?.message || String(err) }))
      .finally(() => setLoading(false));
  }

  function handleReassignTargetChange(planId: string, targetUid: string) {
    setReassignTargets((prev) => ({
      ...prev,
      [planId]: targetUid
    }));
  }

  async function handleToggleSchedule(planId: string, enabled: boolean) {
    setActionLoading(true);
    setStatusMsg(null);
    try {
      const res = await callBackend('update_user_schedule', {
        user_id: userId,
        scheduled_plan_id: planId,
        enabled
      });
      setStatusMsg({ type: 'success', text: res?.message || 'Updated schedule.' });
      addLog(`Updated scheduled plan ${planId} enabled=${enabled}`);
      handleFetchTelemetry();
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err?.message || String(err) });
    } finally {
      setActionLoading(false);
    }
  }

  async function handleDeleteSchedule(planId: string) {
    setActionLoading(true);
    setStatusMsg(null);
    try {
      const res = await callBackend('delete_user_schedule', {
        user_id: userId,
        scheduled_plan_id: planId
      });
      setStatusMsg({ type: 'success', text: res?.message || 'Deleted schedule.' });
      addLog(`Deleted scheduled plan ${planId}`);
      handleFetchTelemetry();
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err?.message || String(err) });
    } finally {
      setActionLoading(false);
    }
  }

  async function handleReassignSchedule(planId: string) {
    const newOwnerId = reassignTargets[planId];
    if (!newOwnerId) return;
    setActionLoading(true);
    setStatusMsg(null);
    try {
      const res = await callBackend('reassign_user_schedule', {
        user_id: userId,
        scheduled_plan_id: planId,
        new_owner_user_id: newOwnerId
      });
      setStatusMsg({ type: 'success', text: res?.message || 'Reassigned schedule.' });
      addLog(`Reassigned scheduled plan ${planId} to user ${newOwnerId}`);
      handleFetchTelemetry();
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err?.message || String(err) });
    } finally {
      setActionLoading(false);
    }
  }
};
