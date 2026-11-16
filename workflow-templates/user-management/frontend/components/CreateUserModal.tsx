import React, { useEffect, useState } from 'react';
import {
  inputStyle,
  labelStyle,
  primaryBtnStyle,
  secondaryBtnStyle
} from '../styles';

export interface CreateUserModalProps {
  isOpen: boolean;
  scopeInfo: any;
  capabilities: any;
  creationAttributes: any[];
  onClose: () => void;
  onCreateSubmit: (payload: any) => Promise<void>;
}

export const CreateUserModal: React.FC<CreateUserModalProps> = ({
  isOpen,
  scopeInfo,
  capabilities,
  creationAttributes,
  onClose,
  onCreateSubmit
}) => {
  // 1. Hook Declarations
  const [firstName, setFirstName] = useState<string>('');
  const [lastName, setLastName] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [attributeValues, setAttributeValues] = useState<Record<string, string>>({});
  const [sendWelcomeEmail, setSendWelcomeEmail] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const activeScopeGroups = scopeInfo?.active_scope_groups || [];
  const manageableGroups = scopeInfo?.manageable_groups || [];
  const isScopeGroupsMode = (scopeInfo?.mode || 'scope_groups') === 'scope_groups';
  const allowEmailCreds = Boolean(capabilities?.credentials?.allow_email_credentials);
  const allowPasswordReset = Boolean(capabilities?.credentials?.allow_password_reset);

  useEffect(handleInitDefaults, [isOpen, activeScopeGroups, creationAttributes]);

  // 2. Returned Component JSX
  if (!isOpen) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(15, 23, 42, 0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000
      }}
    >
      <div
        onClick={handleStopPropagation}
        style={{
          background: '#ffffff',
          borderRadius: '10px',
          width: '540px',
          maxWidth: '94vw',
          maxHeight: '88vh',
          overflowY: 'auto',
          padding: '24px',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>
            Create New User
          </h3>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: '16px', color: '#64748b' }}>
            ✕
          </button>
        </div>

        {errorMsg && (
          <div style={{ padding: '10px 12px', borderRadius: '6px', background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', fontSize: '12px', marginBottom: '14px' }}>
            {errorMsg}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
          <div>
            <label style={labelStyle}>First Name</label>
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="Jane"
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Last Name</label>
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Doe"
              style={inputStyle}
            />
          </div>
        </div>

        <div style={{ marginBottom: '14px' }}>
          <label style={labelStyle}>
            Email Address {allowEmailCreds ? '(Creates Email Credential)' : '(For Pre-Check Verification)'}
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="jane.doe@example.com"
            style={inputStyle}
          />
        </div>

        {isScopeGroupsMode && (
          <div style={{ marginBottom: '14px' }}>
            <label style={labelStyle}>
              Assign to Scope Group(s) <span style={{ color: '#dc2626' }}>*</span>
            </label>
            <p style={{ margin: '0 0 6px 0', fontSize: '11px', color: '#64748b' }}>
              New users must be assigned to at least one of your active Scope Groups upon creation.
            </p>
            <div style={{ maxHeight: '140px', overflowY: 'auto', border: '1px solid #cbd5e1', borderRadius: '6px', padding: '8px' }}>
              {manageableGroups.map((g: any) => (
                <label key={g.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0', fontSize: '12px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={selectedGroupIds.includes(g.id)}
                    onChange={() => handleToggleGroup(g.id)}
                  />
                  <span style={{ fontWeight: g.is_scope_group ? 700 : 500 }}>
                    {g.name}
                  </span>
                  <span style={{ fontSize: '11px', color: '#64748b' }}>
                    {g.is_scope_group ? '[Active Scope Group]' : `[Subgroup depth ${g.depth}]`}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

        {creationAttributes && creationAttributes.length > 0 && (
          <div style={{ marginBottom: '14px', borderTop: '1px solid #e2e8f0', paddingTop: '12px' }}>
            <label style={labelStyle}>Initial User Attributes</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '6px' }}>
              {creationAttributes.map((attr: any) => (
                <div key={attr.id}>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: '#334155', display: 'block', marginBottom: '2px' }}>
                    {attr.label} (<code>{attr.name}</code>)
                    {attr.rule === 'must_match_admin' && <span style={{ color: '#2563eb', marginLeft: '6px' }}>[Matches Admin]</span>}
                    {attr.rule === 'must_match_scope_group' && <span style={{ color: '#059669', marginLeft: '6px' }}>[Scope Group Value]</span>}
                  </label>
                  {Array.isArray(attr.allowed_values) && attr.allowed_values.length > 0 ? (
                    <select
                      value={attributeValues[attr.name] ?? ''}
                      onChange={(e) => handleAttributeChange(attr.name, e.target.value)}
                      disabled={attr.rule === 'must_match_admin'}
                      style={inputStyle}
                    >
                      {attr.rule !== 'must_match_admin' && <option value="">— Select value —</option>}
                      {attr.allowed_values.map((val: string) => (
                        <option key={val} value={val}>
                          {val}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={attr.value_is_hidden ? 'password' : 'text'}
                      value={attributeValues[attr.name] ?? ''}
                      onChange={(e) => handleAttributeChange(attr.name, e.target.value)}
                      placeholder={attr.value_is_hidden ? 'Enter hidden value...' : 'Optional initial value...'}
                      style={inputStyle}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {allowEmailCreds && allowPasswordReset && (
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', marginBottom: '16px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={sendWelcomeEmail}
              onChange={(e) => setSendWelcomeEmail(e.target.checked)}
            />
            <span>Send password setup / welcome email upon creation</span>
          </label>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
          <button onClick={onClose} disabled={submitting} style={secondaryBtnStyle}>
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={submitting} style={primaryBtnStyle}>
            {submitting ? 'Creating User...' : 'Create User'}
          </button>
        </div>
      </div>
    </div>
  );

  // 3. Hoisted Function Implementations
  function handleInitDefaults() {
    if (!isOpen) return;
    setFirstName('');
    setLastName('');
    setEmail('');
    setErrorMsg(null);
    setSendWelcomeEmail(false);

    if (activeScopeGroups.length > 0) {
      setSelectedGroupIds([activeScopeGroups[0].id]);
    } else {
      setSelectedGroupIds([]);
    }

    const initialAttrs: Record<string, string> = {};
    for (const attr of creationAttributes || []) {
      if (attr.rule === 'must_match_admin' && Array.isArray(attr.allowed_values) && attr.allowed_values.length > 0) {
        initialAttrs[attr.name] = attr.allowed_values[0];
      } else if (attr.rule === 'must_match_scope_group' && Array.isArray(attr.allowed_values) && attr.allowed_values.length === 1) {
        initialAttrs[attr.name] = attr.allowed_values[0];
      }
    }
    setAttributeValues(initialAttrs);
  }

  function handleStopPropagation(e: React.MouseEvent) {
    e.stopPropagation();
  }

  function handleToggleGroup(groupId: string) {
    setSelectedGroupIds((prev) =>
      prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId]
    );
  }

  function handleAttributeChange(attrName: string, val: string) {
    setAttributeValues((prev) => ({
      ...prev,
      [attrName]: val
    }));
  }

  async function handleSubmit() {
    setErrorMsg(null);
    if (!firstName.trim() && !lastName.trim() && !email.trim()) {
      setErrorMsg('Please enter at least a first/last name or email address.');
      return;
    }

    if (isScopeGroupsMode) {
      const hasActiveScope = selectedGroupIds.some((gid) =>
        activeScopeGroups.some((sg: any) => sg.id === gid)
      );
      if (!hasActiveScope) {
        setErrorMsg('You must select at least one Active Scope Group for the new user.');
        return;
      }
    }

    setSubmitting(true);
    try {
      await onCreateSubmit({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        email: email.trim(),
        group_ids: selectedGroupIds,
        user_attributes: attributeValues,
        send_welcome_email: sendWelcomeEmail
      });
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || String(err));
    } finally {
      setSubmitting(false);
    }
  }
};
