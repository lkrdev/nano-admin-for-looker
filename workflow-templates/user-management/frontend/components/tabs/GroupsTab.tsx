import React, { useEffect, useState } from 'react';
import {
  cardStyle,
  dangerBtnStyle,
  pillStyle,
  primaryBtnStyle,
  secondaryBtnStyle
} from '../../styles';

export interface GroupsTabProps {
  userId: string;
  callBackend: (action: string, payload?: any) => Promise<any>;
  addLog: (msg: string) => void;
  onUserUpdated: () => void;
}

export const GroupsTab: React.FC<GroupsTabProps> = ({
  userId,
  callBackend,
  addLog,
  onUserUpdated
}) => {
  // 1. Hook Declarations
  const [loading, setLoading] = useState<boolean>(true);
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [groupsData, setGroupsData] = useState<any | null>(null);
  const [pendingFinalRemovalGroup, setPendingFinalRemovalGroup] = useState<any | null>(null);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error' | 'warning'; text: string } | null>(null);

  const manageableGroups = groupsData?.manageable_groups || [];
  const externalGroups = groupsData?.external_groups || [];
  const allowEdit = Boolean(groupsData?.allow_edit);

  useEffect(handleFetchGroups, [userId]);

  // 2. Returned Component JSX
  if (loading) {
    return <div style={cardStyle}>Loading group memberships...</div>;
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
            background:
              statusMsg.type === 'error'
                ? '#fef2f2'
                : statusMsg.type === 'warning'
                ? '#fffbeb'
                : '#f0fdf4',
            border: `1px solid ${
              statusMsg.type === 'error'
                ? '#fecaca'
                : statusMsg.type === 'warning'
                ? '#fde68a'
                : '#bbf7d0'
            }`,
            color:
              statusMsg.type === 'error'
                ? '#991b1b'
                : statusMsg.type === 'warning'
                ? '#92400e'
                : '#166534'
          }}
        >
          {statusMsg.text}
        </div>
      )}

      {/* Confirmation Banner when removing from final shared Scope Group */}
      {pendingFinalRemovalGroup && (
        <div
          style={{
            padding: '14px 18px',
            borderRadius: '8px',
            background: '#fffbeb',
            border: '1px solid #fcd34d',
            marginBottom: '16px'
          }}
        >
          <strong style={{ display: 'block', fontSize: '13px', color: '#92400e', marginBottom: '4px' }}>
            Warning: Removing User from Final Shared Scope Group
          </strong>
          <p style={{ margin: '0 0 10px 0', fontSize: '12px', color: '#78350f' }}>
            Removing this user from <strong>{pendingFinalRemovalGroup.name}</strong> will leave them in zero of your active Scope Groups. Once removed, you will no longer be able to view or manage this user within this workflow.
          </p>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={() => setPendingFinalRemovalGroup(null)} style={secondaryBtnStyle}>
              Cancel
            </button>
            <button
              onClick={() => executeRemoveGroup(pendingFinalRemovalGroup.id)}
              disabled={actionLoading}
              style={{ ...dangerBtnStyle, background: '#d97706', color: '#ffffff', borderColor: '#d97706' }}
            >
              Confirm Removal Anyway
            </button>
          </div>
        </div>
      )}

      <div style={cardStyle}>
        <h3 style={{ margin: '0 0 6px 0', fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>
          Manageable Scope Groups & Child Groups ({manageableGroups.length})
        </h3>
        <p style={{ margin: '0 0 14px 0', fontSize: '12px', color: '#64748b' }}>
          You can manage membership in your active Scope Groups and any direct or indirect child groups within their hierarchy.
        </p>

        {manageableGroups.length === 0 ? (
          <div style={{ fontSize: '13px', color: '#64748b' }}>
            No manageable groups found in your scope hierarchy.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', textAlign: 'left', color: '#475569' }}>
                <th style={{ padding: '8px 12px' }}>Group Name</th>
                <th style={{ padding: '8px 12px' }}>Hierarchy Level</th>
                <th style={{ padding: '8px 12px' }}>Membership Status</th>
                {allowEdit && <th style={{ padding: '8px 12px', textAlign: 'right' }}>Action</th>}
              </tr>
            </thead>
            <tbody>
              {manageableGroups.map((g: any) => (
                <tr key={g.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '10px 12px', fontWeight: 600 }}>
                    {g.name} <span style={{ color: '#94a3b8', fontWeight: 400 }}>(ID: {g.id})</span>
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    {g.is_scope_group ? (
                      <span style={pillStyle('#eff6ff', '#1d4ed8')}>Active Scope Group</span>
                    ) : (
                      <span style={pillStyle('#f1f5f9', '#475569')}>Child Subgroup (Depth {g.depth})</span>
                    )}
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    {g.is_member ? (
                      <span style={pillStyle('#ecfdf5', '#059669')}>Member</span>
                    ) : (
                      <span style={pillStyle('#f8fafc', '#94a3b8')}>Not a Member</span>
                    )}
                  </td>
                  {allowEdit && (
                    <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                      {g.is_member ? (
                        <button
                          onClick={() => handleRequestRemoveGroup(g)}
                          disabled={actionLoading}
                          style={{ ...dangerBtnStyle, padding: '4px 10px', fontSize: '12px' }}
                        >
                          Remove from Group
                        </button>
                      ) : (
                        <button
                          onClick={() => handleAddGroup(g.id)}
                          disabled={actionLoading}
                          style={{ ...primaryBtnStyle, padding: '4px 10px', fontSize: '12px' }}
                        >
                          + Add to Group
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {externalGroups.length > 0 && (
        <div style={cardStyle}>
          <h3 style={{ margin: '0 0 6px 0', fontSize: '14px', fontWeight: 700, color: '#475569' }}>
            Other Group Memberships (Read-Only Outside Your Scope)
          </h3>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px' }}>
            {externalGroups.map((eg: any) => (
              <span key={eg.id} style={pillStyle('#f1f5f9', '#64748b')}>
                🔒 {eg.name} (ID: {eg.id})
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  // 3. Hoisted Function Implementations
  function handleFetchGroups() {
    setLoading(true);
    callBackend('get_user_groups', { user_id: userId })
      .then((res) => setGroupsData(res))
      .catch((err) => setStatusMsg({ type: 'error', text: err?.message || String(err) }))
      .finally(() => setLoading(false));
  }

  async function handleAddGroup(groupId: string) {
    setActionLoading(true);
    setStatusMsg(null);
    try {
      const res = await callBackend('add_user_to_group', { user_id: userId, group_id: groupId });
      setStatusMsg({ type: 'success', text: res?.message || 'Added user to group.' });
      addLog(`Added user ${userId} to group ${groupId}`);
      handleFetchGroups();
      onUserUpdated();
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err?.message || String(err) });
    } finally {
      setActionLoading(false);
    }
  }

  function handleRequestRemoveGroup(group: any) {
    if (group.would_remove_from_final_scope) {
      setPendingFinalRemovalGroup(group);
      return;
    }
    executeRemoveGroup(group.id);
  }

  async function executeRemoveGroup(groupId: string) {
    setActionLoading(true);
    setPendingFinalRemovalGroup(null);
    setStatusMsg(null);
    try {
      const res = await callBackend('remove_user_from_group', { user_id: userId, group_id: groupId });
      if (res?.warning) {
        setStatusMsg({ type: 'warning', text: res.warning });
      } else {
        setStatusMsg({ type: 'success', text: res?.message || 'Removed user from group.' });
      }
      addLog(`Removed user ${userId} from group ${groupId}`);
      handleFetchGroups();
      onUserUpdated();
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err?.message || String(err) });
    } finally {
      setActionLoading(false);
    }
  }
};
