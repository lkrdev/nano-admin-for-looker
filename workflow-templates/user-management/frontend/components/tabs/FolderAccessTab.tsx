import React, { useEffect, useState } from 'react';
import {
  cardStyle,
  dangerBtnStyle,
  pillStyle,
  primaryBtnStyle,
  secondaryBtnStyle
} from '../../styles';

export interface FolderAccessTabProps {
  userId: string;
  callBackend: (action: string, payload?: any) => Promise<any>;
  addLog: (msg: string) => void;
}

export const FolderAccessTab: React.FC<FolderAccessTabProps> = ({
  userId,
  callBackend,
  addLog
}) => {
  // 1. Hook Declarations
  const [loading, setLoading] = useState<boolean>(true);
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [folderData, setFolderData] = useState<any | null>(null);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const folders = folderData?.folders || [];
  const allowEdit = Boolean(folderData?.allow_edit);

  useEffect(handleFetchFolders, [userId]);

  // 2. Returned Component JSX
  if (loading) {
    return <div style={cardStyle}>Loading scoped folder access...</div>;
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
        <h3 style={{ margin: '0 0 6px 0', fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>
          Scoped Folder & Content Access ({folders.length})
        </h3>
        <p style={{ margin: '0 0 14px 0', fontSize: '12px', color: '#64748b' }}>
          Shows folders accessible to your Scope Groups and their descendants. Direct user access grants are available on custom-access folders (<code>inherits: false</code>) up to your Scope Group's permission level.
        </p>

        {folders.length === 0 ? (
          <div style={{ fontSize: '13px', color: '#64748b' }}>
            No scoped folders found for your active Scope Groups.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', textAlign: 'left', color: '#475569' }}>
                <th style={{ padding: '8px 12px' }}>Folder</th>
                <th style={{ padding: '8px 12px' }}>Access Mode</th>
                <th style={{ padding: '8px 12px' }}>Effective Access</th>
                <th style={{ padding: '8px 12px' }}>Group-Inherited</th>
                <th style={{ padding: '8px 12px' }}>Direct User Grant</th>
                {allowEdit && <th style={{ padding: '8px 12px', textAlign: 'right' }}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {folders.map((f: any) => (
                <tr key={f.folder_id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '10px 12px', fontWeight: 600 }}>
                    📁 {f.folder_name} <span style={{ color: '#94a3b8', fontWeight: 400 }}>(ID: {f.folder_id})</span>
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    {f.inherits ? (
                      <span style={pillStyle('#f1f5f9', '#64748b')}>Inherits Parent</span>
                    ) : (
                      <span style={pillStyle('#eff6ff', '#1d4ed8')}>Custom Access (Max: {f.max_grantable_permission})</span>
                    )}
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    {f.effective_permission === 'edit' ? (
                      <span style={pillStyle('#ecfdf5', '#059669')}>Manage / Edit</span>
                    ) : f.effective_permission === 'view' ? (
                      <span style={pillStyle('#e0f2fe', '#0369a1')}>View</span>
                    ) : (
                      <span style={pillStyle('#f8fafc', '#94a3b8')}>None</span>
                    )}
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    {(f.group_accesses || []).length > 0 ? (
                      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                        {f.group_accesses.map((ga: any) => (
                          <span key={ga.group_id} style={pillStyle('#f3e8ff', '#6b21a8')}>
                            {ga.group_name}: {ga.permission_type}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span style={{ color: '#94a3b8', fontSize: '12px' }}>—</span>
                    )}
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    {f.direct_access ? (
                      <span style={pillStyle('#fef3c7', '#92400e')}>
                        Direct: {f.direct_access.permission_type}
                      </span>
                    ) : (
                      <span style={{ color: '#94a3b8', fontSize: '12px' }}>None</span>
                    )}
                  </td>
                  {allowEdit && (
                    <td style={{ padding: '10px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {f.editable ? (
                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                          <button
                            onClick={() => handleGrantAccess(f.folder_id, 'view')}
                            disabled={actionLoading || f.direct_access?.permission_type === 'view'}
                            style={{ ...secondaryBtnStyle, padding: '4px 8px', fontSize: '11px' }}
                          >
                            Grant View
                          </button>
                          {f.max_grantable_permission === 'edit' && (
                            <button
                              onClick={() => handleGrantAccess(f.folder_id, 'edit')}
                              disabled={actionLoading || f.direct_access?.permission_type === 'edit'}
                              style={{ ...primaryBtnStyle, padding: '4px 8px', fontSize: '11px' }}
                            >
                              Grant Edit
                            </button>
                          )}
                          {f.direct_access && (
                            <button
                              onClick={() => handleRevokeAccess(f.folder_id)}
                              disabled={actionLoading}
                              style={{ ...dangerBtnStyle, padding: '4px 8px', fontSize: '11px' }}
                            >
                              Revoke Direct
                            </button>
                          )}
                        </div>
                      ) : (
                        <span style={{ fontSize: '11px', color: '#94a3b8' }}>Inherited</span>
                      )}
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
  function handleFetchFolders() {
    setLoading(true);
    callBackend('get_user_folder_access', { user_id: userId })
      .then((res) => setFolderData(res))
      .catch((err) => setStatusMsg({ type: 'error', text: err?.message || String(err) }))
      .finally(() => setLoading(false));
  }

  async function handleGrantAccess(folderId: string, permissionType: 'view' | 'edit') {
    setActionLoading(true);
    setStatusMsg(null);
    try {
      const res = await callBackend('set_user_folder_access', {
        user_id: userId,
        folder_id: folderId,
        permission_type: permissionType
      });
      setStatusMsg({ type: 'success', text: res?.message || 'Updated folder access.' });
      addLog(`Granted ${permissionType} on folder ${folderId} for user ${userId}`);
      handleFetchFolders();
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err?.message || String(err) });
    } finally {
      setActionLoading(false);
    }
  }

  async function handleRevokeAccess(folderId: string) {
    setActionLoading(true);
    setStatusMsg(null);
    try {
      const res = await callBackend('remove_user_folder_access', {
        user_id: userId,
        folder_id: folderId
      });
      setStatusMsg({ type: 'success', text: res?.message || 'Revoked direct folder access.' });
      addLog(`Revoked direct folder access on folder ${folderId} for user ${userId}`);
      handleFetchFolders();
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err?.message || String(err) });
    } finally {
      setActionLoading(false);
    }
  }
};
