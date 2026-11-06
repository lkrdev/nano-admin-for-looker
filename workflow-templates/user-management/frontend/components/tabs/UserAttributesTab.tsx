import React, { useEffect, useState } from 'react';
import {
  cardStyle,
  dangerBtnStyle,
  inputStyle,
  pillStyle,
  primaryBtnStyle
} from '../../styles';

export interface UserAttributesTabProps {
  userId: string;
  callBackend: (action: string, payload?: any) => Promise<any>;
  addLog: (msg: string) => void;
}

export const UserAttributesTab: React.FC<UserAttributesTabProps> = ({
  userId,
  callBackend,
  addLog
}) => {
  // 1. Hook Declarations
  const [loading, setLoading] = useState<boolean>(true);
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [attrsData, setAttrsData] = useState<any | null>(null);
  const [draftValues, setDraftValues] = useState<Record<string, string>>({});
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const attributes = attrsData?.attributes || [];
  const allowEdit = Boolean(attrsData?.allow_edit);

  useEffect(handleFetchAttributes, [userId]);

  // 2. Returned Component JSX
  if (loading) {
    return <div style={cardStyle}>Loading user attributes...</div>;
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
          User Attribute Values & Overrides
        </h3>
        <p style={{ margin: '0 0 14px 0', fontSize: '12px', color: '#64748b' }}>
          Manage user-level attribute overrides allowed by workflow policy. Hidden attributes can be set as write-only values.
        </p>

        {attributes.length === 0 ? (
          <div style={{ fontSize: '13px', color: '#64748b' }}>No user attributes available.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', textAlign: 'left', color: '#475569' }}>
                <th style={{ padding: '8px 12px' }}>Attribute</th>
                <th style={{ padding: '8px 12px' }}>Source</th>
                <th style={{ padding: '8px 12px' }}>Rule</th>
                <th style={{ padding: '8px 12px' }}>Value</th>
                {allowEdit && <th style={{ padding: '8px 12px', textAlign: 'right' }}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {attributes.map((attr: any) => (
                <tr key={attr.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '10px 12px' }}>
                    <div style={{ fontWeight: 600 }}>{attr.label}</div>
                    <div style={{ fontSize: '11px', color: '#64748b' }}>
                      <code>{attr.name}</code> {attr.value_is_hidden && '• [Hidden Value]'}
                    </div>
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <span
                      style={pillStyle(
                        attr.has_user_override ? '#eff6ff' : '#f1f5f9',
                        attr.has_user_override ? '#1d4ed8' : '#475569'
                      )}
                    >
                      {attr.source}
                    </span>
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    {!attr.editable ? (
                      <span style={pillStyle('#f1f5f9', '#64748b')}>Read-Only</span>
                    ) : attr.rule === 'must_match_admin' ? (
                      <span style={pillStyle('#e0e7ff', '#3730a3')}>Must Match Admin</span>
                    ) : attr.rule === 'must_match_scope_group' ? (
                      <span style={pillStyle('#ecfdf5', '#059669')}>Match Scope Group</span>
                    ) : attr.rule === 'allowed_values' ? (
                      <span style={pillStyle('#fef3c7', '#92400e')}>Allowed List</span>
                    ) : (
                      <span style={pillStyle('#f0fdf4', '#166534')}>Any Value</span>
                    )}
                  </td>
                  <td style={{ padding: '10px 12px', minWidth: '200px' }}>
                    {attr.editable ? (
                      Array.isArray(attr.allowed_values) ? (
                        <select
                          value={draftValues[attr.id] ?? ''}
                          onChange={(e) => handleDraftChange(attr.id, e.target.value)}
                          disabled={actionLoading}
                          style={{ ...inputStyle, padding: '5px 8px', fontSize: '12px' }}
                        >
                          <option value="">— Select —</option>
                          {attr.allowed_values.map((v: string) => (
                            <option key={v} value={v}>
                              {v}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type={attr.value_is_hidden ? 'password' : 'text'}
                          value={draftValues[attr.id] ?? ''}
                          placeholder={attr.value_is_hidden ? '•••••••• (Write new value)' : 'Enter value...'}
                          onChange={(e) => handleDraftChange(attr.id, e.target.value)}
                          disabled={actionLoading}
                          style={{ ...inputStyle, padding: '5px 8px', fontSize: '12px' }}
                        />
                      )
                    ) : (
                      <span style={{ color: '#334155', fontFamily: 'monospace', fontSize: '12px' }}>
                        {attr.value_is_hidden ? '••••••••' : attr.current_value ?? '—'}
                      </span>
                    )}
                  </td>
                  {allowEdit && (
                    <td style={{ padding: '10px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {attr.editable && (
                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                          <button
                            onClick={() => handleSaveAttribute(attr.id)}
                            disabled={actionLoading}
                            style={{ ...primaryBtnStyle, padding: '4px 10px', fontSize: '12px' }}
                          >
                            Save
                          </button>
                          {attr.has_user_override && attr.rule !== 'must_match_admin' && (
                            <button
                              onClick={() => handleDeleteAttributeOverride(attr.id)}
                              disabled={actionLoading}
                              style={{ ...dangerBtnStyle, padding: '4px 10px', fontSize: '12px' }}
                            >
                              Reset Override
                            </button>
                          )}
                        </div>
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
  function handleFetchAttributes() {
    setLoading(true);
    callBackend('get_user_attributes', { user_id: userId })
      .then((res) => {
        setAttrsData(res);
        const initialDrafts: Record<string, string> = {};
        for (const a of res?.attributes || []) {
          initialDrafts[a.id] = a.value_is_hidden ? '' : String(a.current_value ?? '');
        }
        setDraftValues(initialDrafts);
      })
      .catch((err) => setStatusMsg({ type: 'error', text: err?.message || String(err) }))
      .finally(() => setLoading(false));
  }

  function handleDraftChange(attrId: string, val: string) {
    setDraftValues((prev) => ({
      ...prev,
      [attrId]: val
    }));
  }

  async function handleSaveAttribute(attrId: string) {
    setActionLoading(true);
    setStatusMsg(null);
    try {
      const val = draftValues[attrId] ?? '';
      const res = await callBackend('set_user_attribute', {
        user_id: userId,
        attribute_id: attrId,
        value: val
      });
      setStatusMsg({ type: 'success', text: res?.message || 'Attribute updated.' });
      addLog(`Set user attribute ${attrId} on user ${userId}`);
      handleFetchAttributes();
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err?.message || String(err) });
    } finally {
      setActionLoading(false);
    }
  }

  async function handleDeleteAttributeOverride(attrId: string) {
    setActionLoading(true);
    setStatusMsg(null);
    try {
      const res = await callBackend('delete_user_attribute', {
        user_id: userId,
        attribute_id: attrId
      });
      setStatusMsg({ type: 'success', text: res?.message || 'Removed user attribute override.' });
      addLog(`Deleted user attribute override ${attrId} on user ${userId}`);
      handleFetchAttributes();
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err?.message || String(err) });
    } finally {
      setActionLoading(false);
    }
  }
};
