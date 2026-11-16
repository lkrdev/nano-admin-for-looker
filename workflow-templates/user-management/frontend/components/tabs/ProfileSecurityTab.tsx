import React, { useEffect, useState } from 'react';
import {
  cardStyle,
  dangerBtnStyle,
  inputStyle,
  labelStyle,
  pillStyle,
  primaryBtnStyle,
  secondaryBtnStyle
} from '../../styles';

export interface ProfileSecurityTabProps {
  user: any;
  capabilities: any;
  callBackend: (action: string, payload?: any) => Promise<any>;
  addLog: (msg: string) => void;
  onUserUpdated: () => void;
  onUserDeleted: () => void;
}

export const ProfileSecurityTab: React.FC<ProfileSecurityTabProps> = ({
  user,
  capabilities,
  callBackend,
  addLog,
  onUserUpdated,
  onUserDeleted
}) => {
  // 1. Hook Declarations
  const [firstName, setFirstName] = useState<string>(user?.first_name || '');
  const [lastName, setLastName] = useState<string>(user?.last_name || '');
  const [email, setEmail] = useState<string>(user?.email || '');
  const [credData, setCredData] = useState<any | null>(null);
  const [loadingCreds, setLoadingCreds] = useState<boolean>(false);
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState<boolean>(false);

  const profileCaps = capabilities?.profile || {};
  const credCaps = capabilities?.credentials || {};

  useEffect(handleSyncUserFields, [user]);
  useEffect(handleFetchCredentials, [user?.id]);

  // 2. Returned Component JSX
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

      {/* Profile Section */}
      <div style={cardStyle}>
        <h3 style={{ margin: '0 0 12px 0', fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>
          Profile Information
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
          <div>
            <label style={labelStyle}>First Name</label>
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              disabled={!profileCaps.allow_update_name || actionLoading}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Last Name</label>
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              disabled={!profileCaps.allow_update_name || actionLoading}
              style={inputStyle}
            />
          </div>
        </div>

        <div style={{ marginBottom: '14px' }}>
          <label style={labelStyle}>
            Email Address {!profileCaps.allow_update_email && <span style={{ color: '#64748b', fontWeight: 400 }}>(Locked by workflow policy)</span>}
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={!profileCaps.allow_update_email || actionLoading}
            style={inputStyle}
          />
        </div>

        {(profileCaps.allow_update_name || profileCaps.allow_update_email) && (
          <button onClick={handleSaveProfile} disabled={actionLoading} style={primaryBtnStyle}>
            {actionLoading ? 'Saving...' : 'Save Profile Changes'}
          </button>
        )}
      </div>

      {/* Account Status & Lifecycle Section */}
      <div style={cardStyle}>
        <h3 style={{ margin: '0 0 12px 0', fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>
          Account Status & Lifecycle
        </h3>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#1e293b', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>Current Status:</span>
              {user?.is_disabled ? (
                <span style={pillStyle('#fef2f2', '#dc2626')}>Disabled</span>
              ) : (
                <span style={pillStyle('#ecfdf5', '#059669')}>Active</span>
              )}
            </div>
            <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#64748b' }}>
              Disabling an account immediately blocks Looker UI and API access while preserving user history.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            {profileCaps.allow_disable && (
              <button
                onClick={handleToggleDisabled}
                disabled={actionLoading}
                style={user?.is_disabled ? primaryBtnStyle : secondaryBtnStyle}
              >
                {user?.is_disabled ? 'Enable Account' : 'Disable Account'}
              </button>
            )}

            {profileCaps.allow_delete && (
              <button
                onClick={() => setConfirmDeleteOpen(true)}
                disabled={actionLoading}
                style={dangerBtnStyle}
              >
                Delete User
              </button>
            )}
          </div>
        </div>

        {confirmDeleteOpen && (
          <div style={{ marginTop: '14px', padding: '12px', borderRadius: '6px', background: '#fff1f2', border: '1px solid #fecdd3' }}>
            <strong style={{ fontSize: '13px', color: '#9f1239', display: 'block', marginBottom: '6px' }}>
              Confirm Permanent User Deletion
            </strong>
            <p style={{ margin: '0 0 10px 0', fontSize: '12px', color: '#881337' }}>
              Are you sure you want to permanently delete <strong>{user?.display_name}</strong> (ID: {user?.id})? This action cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={() => setConfirmDeleteOpen(false)} style={secondaryBtnStyle}>
                Cancel
              </button>
              <button onClick={handleConfirmDelete} disabled={actionLoading} style={{ ...dangerBtnStyle, background: '#dc2626', color: '#ffffff' }}>
                Permanently Delete
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Authentication Credentials & 2FA Section */}
      <div style={cardStyle}>
        <h3 style={{ margin: '0 0 12px 0', fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>
          Authentication & Security Actions
        </h3>
        {loadingCreds ? (
          <p style={{ fontSize: '13px', color: '#64748b', margin: 0 }}>Loading credentials & sessions...</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #f1f5f9', paddingBottom: '10px' }}>
              <div>
                <div style={{ fontSize: '13px', fontWeight: 600 }}>Email / Password Credentials</div>
                <div style={{ fontSize: '12px', color: '#64748b' }}>
                  {credData?.email_credentials
                    ? `Configured (${credData.email_credentials.email}) • Last login: ${credData.email_credentials.logged_in_at || 'Never'}`
                    : 'No password-based email credentials configured (SSO or unprovisioned)'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                {credCaps.allow_password_reset && credData?.email_credentials && (
                  <button onClick={handleSendPasswordReset} disabled={actionLoading} style={secondaryBtnStyle}>
                    Send Password Reset Email
                  </button>
                )}
                {credCaps.allow_email_credentials && !credData?.email_credentials && user?.email && (
                  <button onClick={handleCreateEmailCreds} disabled={actionLoading} style={secondaryBtnStyle}>
                    Create Email Credential
                  </button>
                )}
                {credCaps.allow_email_credentials && credData?.email_credentials && (
                  <button onClick={handleDeleteEmailCreds} disabled={actionLoading} style={dangerBtnStyle}>
                    Remove Email Credential
                  </button>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #f1f5f9', paddingBottom: '10px' }}>
              <div>
                <div style={{ fontSize: '13px', fontWeight: 600 }}>Two-Factor Authentication (TOTP)</div>
                <div style={{ fontSize: '12px', color: '#64748b' }}>
                  {credData?.has_totp ? 'Enrolled in 2FA/TOTP' : 'Not enrolled in 2FA/TOTP'}
                </div>
              </div>
              {credCaps.allow_totp_reset && credData?.has_totp && (
                <button onClick={handleResetTotp} disabled={actionLoading} style={dangerBtnStyle}>
                  Reset 2FA / TOTP
                </button>
              )}
            </div>

            <div>
              <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                Active Sessions ({(credData?.sessions || []).length})
              </div>
              {(credData?.sessions || []).length === 0 ? (
                <div style={{ fontSize: '12px', color: '#64748b' }}>No active UI sessions found.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {(credData?.sessions || []).map((s: any) => (
                    <div
                      key={s.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '8px 12px',
                        borderRadius: '6px',
                        background: '#f8fafc',
                        border: '1px solid #e2e8f0',
                        fontSize: '12px'
                      }}
                    >
                      <span>
                        <strong>{s.browser || 'Session'}</strong> on {s.operating_system || 'Unknown OS'} • IP: <code>{s.ip_address || '—'}</code> ({s.credentials_type || 'web'})
                      </span>
                      {credCaps.allow_session_revoke && (
                        <button
                          onClick={() => handleRevokeSession(s.id)}
                          disabled={actionLoading}
                          style={{ ...dangerBtnStyle, padding: '4px 10px', fontSize: '11px' }}
                        >
                          Revoke
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  // 3. Hoisted Function Implementations
  function handleSyncUserFields() {
    setFirstName(user?.first_name || '');
    setLastName(user?.last_name || '');
    setEmail(user?.email || '');
  }

  function handleFetchCredentials() {
    if (!user?.id) return;
    setLoadingCreds(true);
    callBackend('get_user_credentials', { user_id: user.id })
      .then((res) => setCredData(res))
      .catch(() => setCredData(null))
      .finally(() => setLoadingCreds(false));
  }

  async function handleSaveProfile() {
    setActionLoading(true);
    setStatusMsg(null);
    try {
      const payload: Record<string, any> = { user_id: user.id };
      if (profileCaps.allow_update_name) {
        payload.first_name = firstName;
        payload.last_name = lastName;
      }
      if (profileCaps.allow_update_email && email !== user.email) {
        payload.email = email;
      }
      const res = await callBackend('update_user_profile', payload);
      setStatusMsg({ type: 'success', text: res?.message || 'Profile updated.' });
      addLog(`Updated profile for user ${user.id}`);
      onUserUpdated();
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err?.message || String(err) });
    } finally {
      setActionLoading(false);
    }
  }

  async function handleToggleDisabled() {
    setActionLoading(true);
    setStatusMsg(null);
    try {
      const res = await callBackend('set_user_disabled', {
        user_id: user.id,
        is_disabled: !user.is_disabled
      });
      setStatusMsg({ type: 'success', text: res?.message || 'Account status updated.' });
      addLog(`Set is_disabled=${!user.is_disabled} for user ${user.id}`);
      onUserUpdated();
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err?.message || String(err) });
    } finally {
      setActionLoading(false);
    }
  }

  async function handleConfirmDelete() {
    setActionLoading(true);
    setStatusMsg(null);
    try {
      await callBackend('delete_user', { user_id: user.id });
      addLog(`Deleted user ${user.id}`);
      onUserDeleted();
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err?.message || String(err) });
      setActionLoading(false);
    }
  }

  async function handleSendPasswordReset() {
    setActionLoading(true);
    setStatusMsg(null);
    try {
      const res = await callBackend('send_password_reset', { user_id: user.id });
      setStatusMsg({ type: 'success', text: res?.message || 'Password reset email sent.' });
      addLog(`Sent password reset email to user ${user.id}`);
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err?.message || String(err) });
    } finally {
      setActionLoading(false);
    }
  }

  async function handleCreateEmailCreds() {
    setActionLoading(true);
    setStatusMsg(null);
    try {
      const res = await callBackend('create_email_credentials', {
        user_id: user.id,
        email: user.email
      });
      setStatusMsg({ type: 'success', text: res?.message || 'Created email credentials.' });
      handleFetchCredentials();
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err?.message || String(err) });
    } finally {
      setActionLoading(false);
    }
  }

  async function handleDeleteEmailCreds() {
    setActionLoading(true);
    setStatusMsg(null);
    try {
      const res = await callBackend('delete_email_credentials', { user_id: user.id });
      setStatusMsg({ type: 'success', text: res?.message || 'Removed email credentials.' });
      handleFetchCredentials();
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err?.message || String(err) });
    } finally {
      setActionLoading(false);
    }
  }

  async function handleResetTotp() {
    setActionLoading(true);
    setStatusMsg(null);
    try {
      const res = await callBackend('reset_totp', { user_id: user.id });
      setStatusMsg({ type: 'success', text: res?.message || '2FA/TOTP reset.' });
      handleFetchCredentials();
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err?.message || String(err) });
    } finally {
      setActionLoading(false);
    }
  }

  async function handleRevokeSession(sessionId: string) {
    setActionLoading(true);
    setStatusMsg(null);
    try {
      const res = await callBackend('revoke_session', {
        user_id: user.id,
        session_id: sessionId
      });
      setStatusMsg({ type: 'success', text: res?.message || 'Session revoked.' });
      handleFetchCredentials();
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err?.message || String(err) });
    } finally {
      setActionLoading(false);
    }
  }
};
