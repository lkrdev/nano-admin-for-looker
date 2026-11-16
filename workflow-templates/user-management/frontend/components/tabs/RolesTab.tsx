import React, { useEffect, useState } from 'react';
import {
  cardStyle,
  pillStyle,
  primaryBtnStyle
} from '../../styles';

export interface RolesTabProps {
  userId: string;
  callBackend: (action: string, payload?: any) => Promise<any>;
  addLog: (msg: string) => void;
  onUserUpdated: () => void;
}

export const RolesTab: React.FC<RolesTabProps> = ({
  userId,
  callBackend,
  addLog,
  onUserUpdated
}) => {
  // 1. Hook Declarations
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [rolesData, setRolesData] = useState<any | null>(null);
  const [selectedDirectRoleIds, setSelectedDirectRoleIds] = useState<string[]>([]);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const roles = rolesData?.roles || [];
  const allowEdit = Boolean(rolesData?.allow_edit);

  useEffect(handleFetchRoles, [userId]);

  // 2. Returned Component JSX
  if (loading) {
    return <div style={cardStyle}>Loading role assignments...</div>;
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

      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>
              Role Assignments (Direct vs. Group-Inherited)
            </h3>
            <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#64748b' }}>
              Direct role edits are bounded by your own effective permissions and models. Any existing out-of-scope direct roles on the user are preserved automatically.
            </p>
          </div>
          {allowEdit && (
            <button onClick={handleSaveRoles} disabled={saving} style={primaryBtnStyle}>
              {saving ? 'Saving Roles...' : 'Save Direct Roles'}
            </button>
          )}
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', textAlign: 'left', color: '#475569' }}>
              <th style={{ padding: '8px 12px' }}>Direct Assignment</th>
              <th style={{ padding: '8px 12px' }}>Role Name</th>
              <th style={{ padding: '8px 12px' }}>Inherited via Groups</th>
              <th style={{ padding: '8px 12px' }}>Policy Status</th>
            </tr>
          </thead>
          <tbody>
            {roles.map((r: any) => {
              const isChecked = selectedDirectRoleIds.includes(r.id);
              const isInherited = Array.isArray(r.inherited_from_groups) && r.inherited_from_groups.length > 0;
              return (
                <tr key={r.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '10px 12px' }}>
                    <input
                      type="checkbox"
                      checked={isChecked}
                      disabled={!allowEdit || !r.assignable || saving}
                      onChange={() => handleToggleRole(r.id)}
                    />
                  </td>
                  <td style={{ padding: '10px 12px', fontWeight: 600 }}>
                    {r.name} <span style={{ color: '#94a3b8', fontWeight: 400 }}>(ID: {r.id})</span>
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    {isInherited ? (
                      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                        {r.inherited_from_groups.map((g: any) => (
                          <span key={g.id} style={pillStyle('#eff6ff', '#1d4ed8')}>
                            via {g.name}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span style={{ color: '#94a3b8', fontSize: '12px' }}>—</span>
                    )}
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    {r.assignable ? (
                      <span style={pillStyle('#ecfdf5', '#059669')}>Assignable</span>
                    ) : r.is_admin_role ? (
                      <span style={pillStyle('#fef2f2', '#dc2626')}>Blocked (Admin Role)</span>
                    ) : r.is_direct ? (
                      <span style={pillStyle('#fef3c7', '#92400e')}>Preserved (Out of Scope)</span>
                    ) : (
                      <span style={pillStyle('#f1f5f9', '#64748b')}>Outside Admin Subset</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );

  // 3. Hoisted Function Implementations
  function handleFetchRoles() {
    setLoading(true);
    callBackend('get_user_roles', { user_id: userId })
      .then((res) => {
        setRolesData(res);
        const directAssignable = (res?.roles || [])
          .filter((r: any) => r.is_direct)
          .map((r: any) => r.id);
        setSelectedDirectRoleIds(directAssignable);
      })
      .catch((err) => setStatusMsg({ type: 'error', text: err?.message || String(err) }))
      .finally(() => setLoading(false));
  }

  function handleToggleRole(roleId: string) {
    setSelectedDirectRoleIds((prev) =>
      prev.includes(roleId) ? prev.filter((id) => id !== roleId) : [...prev, roleId]
    );
  }

  async function handleSaveRoles() {
    setSaving(true);
    setStatusMsg(null);
    try {
      const assignableIds = new Set<string>(
        roles.filter((r: any) => r.assignable).map((r: any) => r.id)
      );
      const desiredAssignable = selectedDirectRoleIds.filter((id) => assignableIds.has(id));
      const res = await callBackend('set_user_roles', {
        user_id: userId,
        role_ids: desiredAssignable
      });
      setStatusMsg({ type: 'success', text: res?.message || 'Updated direct roles.' });
      addLog(`Updated direct roles for user ${userId}`);
      handleFetchRoles();
      onUserUpdated();
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err?.message || String(err) });
    } finally {
      setSaving(false);
    }
  }
};
