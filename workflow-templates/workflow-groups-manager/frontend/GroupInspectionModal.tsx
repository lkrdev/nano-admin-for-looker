import React, { useEffect, useMemo, useState } from 'react';

export interface GroupInspectionModalProps {
  groupId: string;
  hostOrigin: string;
  onClose: () => void;
  onGroupUpdated: () => void;
  onInspectGroup: (groupId: string) => void;
  navigateToLookerPath: (path: string, event?: React.MouseEvent) => void;
  callBackend: (action: string, payload?: any) => Promise<any>;
  addLog: (msg: string) => void;
}

export const GroupInspectionModal: React.FC<GroupInspectionModalProps> = ({
  groupId,
  hostOrigin,
  onClose,
  onGroupUpdated,
  onInspectGroup,
  navigateToLookerPath,
  callBackend,
  addLog
}) => {
  // 1. Hook Declarations
  const [loading, setLoading] = useState<boolean>(true);
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [data, setData] = useState<any | null>(null);
  const [activeTab, setActiveTab] = useState<'members' | 'owners' | 'subgroups'>('members');

  const [memberSearch, setMemberSearch] = useState<string>('');
  const [selectedUserIdToAdd, setSelectedUserIdToAdd] = useState<string>('');
  const [ownerTypeToAdd, setOwnerTypeToAdd] = useState<'user' | 'group'>('user');
  const [selectedOwnerIdToAdd, setSelectedOwnerIdToAdd] = useState<string>('');

  const members = data?.members || [];
  const owners = data?.group?.owners || [];
  const subgroups = data?.subgroups || [];
  const allUsers = data?.all_users || [];
  const allGroups = data?.all_groups || [];

  const filteredMembers = useMemo(filterMembersList, [members, memberSearch]);
  const addableUsers = useMemo(computeAddableUsers, [allUsers, members]);

  useEffect(handleFetchGroupInspection, [groupId]);

  // 2. Returned Component JSX
  return (
    <div style={backdropStyle}>
      <div style={modalStyle}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>
                {data?.group?.name || `Group ${groupId}`}
              </h3>
              <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', background: '#f1f5f9', color: '#475569', fontWeight: 600 }}>
                ID: <code>{groupId}</code>
              </span>
            </div>
            <div style={{ marginTop: '4px', fontSize: '12px', color: '#64748b' }}>
              {members.length} member(s) • {owners.length} owner(s) • {subgroups.length} subgroup(s)
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <a
              href={hostOrigin ? `${hostOrigin}/admin/groups/${groupId}` : `/admin/groups/${groupId}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => navigateToLookerPath(`/admin/groups/${groupId}`, e)}
              style={secondaryLinkBtnStyle}
            >
              Looker Group Admin
            </a>
            <button onClick={onClose} style={closeBtnStyle}>
              Close
            </button>
          </div>
        </div>

        {errorMsg && (
          <div style={{ padding: '10px 14px', borderRadius: '6px', background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', fontSize: '12px', marginBottom: '12px' }}>
            {errorMsg}
          </div>
        )}

        {/* Section Tabs */}
        <div style={{ display: 'flex', gap: '6px', borderBottom: '1px solid #e2e8f0', marginBottom: '16px' }}>
          <button
            onClick={handleSelectMembers}
            style={getSubTabStyle(activeTab === 'members')}
          >
            Members ({members.length})
          </button>
          <button
            onClick={handleSelectOwners}
            style={getSubTabStyle(activeTab === 'owners')}
          >
            Group Owners ({owners.length})
          </button>
          <button
            onClick={handleSelectSubgroups}
            style={getSubTabStyle(activeTab === 'subgroups')}
          >
            Subgroups ({subgroups.length})
          </button>
        </div>

        {loading ? (
          <div style={{ padding: '32px', textAlign: 'center', fontSize: '13px', color: '#64748b' }}>
            Inspecting group details...
          </div>
        ) : (
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {/* Members Tab */}
            {activeTab === 'members' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div style={actionBoxStyle}>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                    Add User to Group
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <select
                      value={selectedUserIdToAdd}
                      onChange={handleSelectedUserChange}
                      style={{ ...inputStyle, flex: 1 }}
                    >
                      <option value="">-- Select User ({addableUsers.length} available) --</option>
                      {addableUsers.map((u: any) => (
                        <option key={u.id} value={u.id}>
                          {u.name} {u.email ? `(${u.email})` : ''} [ID: {u.id}]
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={handleAddMember}
                      disabled={actionLoading || !selectedUserIdToAdd}
                      style={primaryBtnStyle}
                    >
                      Add Member
                    </button>
                  </div>
                </div>

                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: '#334155' }}>
                      Current Members ({filteredMembers.length})
                    </span>
                    <input
                      type="text"
                      placeholder="Filter members..."
                      value={memberSearch}
                      onChange={handleMemberSearchChange}
                      style={{ ...inputStyle, width: '200px' }}
                    />
                  </div>
                  <div style={{ border: '1px solid #e2e8f0', borderRadius: '6px', overflow: 'hidden' }}>
                    {filteredMembers.length > 0 ? (
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                        <thead>
                          <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', textAlign: 'left', color: '#64748b' }}>
                            <th style={{ padding: '8px 12px' }}>User</th>
                            <th style={{ padding: '8px 12px' }}>ID</th>
                            <th style={{ padding: '8px 12px', textAlign: 'right' }}>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredMembers.map((m: any) => (
                            <tr key={m.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                              <td style={{ padding: '8px 12px' }}>
                                <div style={{ fontWeight: 600, color: '#0f172a' }}>{m.name}</div>
                                {m.email && <div style={{ fontSize: '11px', color: '#64748b' }}>{m.email}</div>}
                              </td>
                              <td style={{ padding: '8px 12px', color: '#64748b' }}>
                                <code>{m.id}</code>
                              </td>
                              <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                                <button
                                  onClick={() => handleRemoveMember(m.id)}
                                  disabled={actionLoading}
                                  style={dangerBtnSmallStyle}
                                >
                                  Remove
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <div style={{ padding: '16px', textAlign: 'center', fontSize: '12px', color: '#94a3b8' }}>
                        No members found in this group.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Group Owners Tab */}
            {activeTab === 'owners' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div style={actionBoxStyle}>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                    Assign Group Owner (<code>{data?.group?.ownership_attribute_name || 'nano_admin_group_owners'}</code>)
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <select
                      value={ownerTypeToAdd}
                      onChange={handleOwnerTypeChange}
                      style={{ ...inputStyle, width: '130px' }}
                    >
                      <option value="user">User (u:id)</option>
                      <option value="group">Group (g:id)</option>
                    </select>
                    <select
                      value={selectedOwnerIdToAdd}
                      onChange={handleSelectedOwnerIdChange}
                      style={{ ...inputStyle, flex: 1 }}
                    >
                      <option value="">
                        {ownerTypeToAdd === 'user' ? '-- Select Owner User --' : '-- Select Owner Group --'}
                      </option>
                      {ownerTypeToAdd === 'user'
                        ? allUsers.map((u: any) => (
                            <option key={u.id} value={u.id}>
                              {u.name} {u.email ? `(${u.email})` : ''} [u:{u.id}]
                            </option>
                          ))
                        : allGroups.map((g: any) => (
                            <option key={g.id} value={g.id}>
                              {g.name} [g:{g.id}]
                            </option>
                          ))}
                    </select>
                    <button
                      onClick={handleAddOwner}
                      disabled={actionLoading || !selectedOwnerIdToAdd}
                      style={primaryBtnStyle}
                    >
                      Add Owner
                    </button>
                  </div>
                </div>

                <div style={{ border: '1px solid #e2e8f0', borderRadius: '6px', overflow: 'hidden' }}>
                  {owners.length > 0 ? (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                      <thead>
                        <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', textAlign: 'left', color: '#64748b' }}>
                          <th style={{ padding: '8px 12px' }}>Owner</th>
                          <th style={{ padding: '8px 12px' }}>Specifier</th>
                          <th style={{ padding: '8px 12px', textAlign: 'right' }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {owners.map((o: any) => (
                          <tr key={`${o.type}:${o.id}`} style={{ borderBottom: '1px solid #f1f5f9' }}>
                            <td style={{ padding: '8px 12px' }}>
                              <div style={{ fontWeight: 600, color: '#0f172a' }}>
                                {o.name}
                                <span style={{ marginLeft: '6px', fontSize: '10px', padding: '1px 6px', borderRadius: '4px', background: o.type === 'group' ? '#eff6ff' : '#f0fdf4', color: o.type === 'group' ? '#1d4ed8' : '#166534' }}>
                                  {o.type === 'group' ? 'GROUP' : 'USER'}
                                </span>
                              </div>
                              {o.email && <div style={{ fontSize: '11px', color: '#64748b' }}>{o.email}</div>}
                            </td>
                            <td style={{ padding: '8px 12px' }}>
                              <code>{o.type === 'group' ? `g:${o.id}` : `u:${o.id}`}</code>
                            </td>
                            <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                              <button
                                onClick={() => handleRemoveOwner(o.type, o.id)}
                                disabled={actionLoading}
                                style={dangerBtnSmallStyle}
                              >
                                Remove Owner
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div style={{ padding: '16px', textAlign: 'center', fontSize: '12px', color: '#94a3b8' }}>
                      No group owners configured on this group.
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Subgroups Tab */}
            {activeTab === 'subgroups' && (
              <div style={{ border: '1px solid #e2e8f0', borderRadius: '6px', overflow: 'hidden' }}>
                {subgroups.length > 0 ? (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                    <thead>
                      <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', textAlign: 'left', color: '#64748b' }}>
                        <th style={{ padding: '8px 12px' }}>Subgroup Name</th>
                        <th style={{ padding: '8px 12px' }}>ID</th>
                        <th style={{ padding: '8px 12px' }}>Members</th>
                        <th style={{ padding: '8px 12px', textAlign: 'right' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {subgroups.map((sg: any) => (
                        <tr key={sg.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '8px 12px', fontWeight: 600, color: '#0f172a' }}>{sg.name}</td>
                          <td style={{ padding: '8px 12px', color: '#64748b' }}>
                            <code>{sg.id}</code>
                          </td>
                          <td style={{ padding: '8px 12px', color: '#475569' }}>{sg.user_count} member(s)</td>
                          <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                            <button
                              onClick={() => onInspectGroup(sg.id)}
                              style={secondaryBtnSmallStyle}
                            >
                              Inspect Subgroup
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div style={{ padding: '16px', textAlign: 'center', fontSize: '12px', color: '#94a3b8' }}>
                    No direct child subgroups found for this group.
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );

  // 3. Hoisted Function Implementations
  function filterMembersList() {
    if (!memberSearch.trim()) return members;
    const term = memberSearch.toLowerCase();
    return members.filter(
      (m: any) =>
        String(m.name || '').toLowerCase().includes(term) ||
        String(m.email || '').toLowerCase().includes(term) ||
        String(m.id || '').toLowerCase().includes(term)
    );
  }

  function computeAddableUsers() {
    const memberIdSet = new Set<string>(members.map((m: any) => String(m.id)));
    return allUsers.filter((u: any) => !memberIdSet.has(String(u.id)));
  }

  function handleFetchGroupInspection() {
    setLoading(true);
    setErrorMsg(null);
    callBackend('inspect_group', { group_id: groupId })
      .then((res) => {
        setData(res);
        setLoading(false);
      })
      .catch((err) => {
        setErrorMsg(err.message || 'Failed to inspect group.');
        setLoading(false);
      });
  }

  function handleSelectMembers() {
    setActiveTab('members');
  }

  function handleSelectOwners() {
    setActiveTab('owners');
  }

  function handleSelectSubgroups() {
    setActiveTab('subgroups');
  }

  function handleMemberSearchChange(e: React.ChangeEvent<HTMLInputElement>) {
    setMemberSearch(e.target.value);
  }

  function handleSelectedUserChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setSelectedUserIdToAdd(e.target.value);
  }

  function handleAddMember() {
    if (!selectedUserIdToAdd) return;
    setActionLoading(true);
    setErrorMsg(null);
    callBackend('manage_group_members', {
      group_id: groupId,
      user_id: selectedUserIdToAdd,
      operation: 'add'
    })
      .then(() => {
        addLog(`Added user ${selectedUserIdToAdd} to group ${groupId}`);
        setSelectedUserIdToAdd('');
        handleFetchGroupInspection();
        onGroupUpdated();
      })
      .catch((err) => setErrorMsg(err.message || 'Failed to add member to group.'))
      .finally(() => setActionLoading(false));
  }

  function handleRemoveMember(userId: string) {
    setActionLoading(true);
    setErrorMsg(null);
    callBackend('manage_group_members', {
      group_id: groupId,
      user_id: userId,
      operation: 'remove'
    })
      .then(() => {
        addLog(`Removed user ${userId} from group ${groupId}`);
        handleFetchGroupInspection();
        onGroupUpdated();
      })
      .catch((err) => setErrorMsg(err.message || 'Failed to remove member from group.'))
      .finally(() => setActionLoading(false));
  }

  function handleOwnerTypeChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setOwnerTypeToAdd(e.target.value as 'user' | 'group');
    setSelectedOwnerIdToAdd('');
  }

  function handleSelectedOwnerIdChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setSelectedOwnerIdToAdd(e.target.value);
  }

  function handleAddOwner() {
    if (!selectedOwnerIdToAdd) return;
    setActionLoading(true);
    setErrorMsg(null);
    callBackend('update_group_owners', {
      group_id: groupId,
      operation: 'add',
      owner_type: ownerTypeToAdd,
      owner_id: selectedOwnerIdToAdd
    })
      .then(() => {
        addLog(`Added ${ownerTypeToAdd} owner ${selectedOwnerIdToAdd} to group ${groupId}`);
        setSelectedOwnerIdToAdd('');
        handleFetchGroupInspection();
        onGroupUpdated();
      })
      .catch((err) => setErrorMsg(err.message || 'Failed to update group owners.'))
      .finally(() => setActionLoading(false));
  }

  function handleRemoveOwner(ownerType: 'user' | 'group', ownerId: string) {
    setActionLoading(true);
    setErrorMsg(null);
    callBackend('update_group_owners', {
      group_id: groupId,
      operation: 'remove',
      owner_type: ownerType,
      owner_id: ownerId
    })
      .then(() => {
        addLog(`Removed ${ownerType} owner ${ownerId} from group ${groupId}`);
        handleFetchGroupInspection();
        onGroupUpdated();
      })
      .catch((err) => setErrorMsg(err.message || 'Failed to remove group owner.'))
      .finally(() => setActionLoading(false));
  }
};

const backdropStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  background: 'rgba(15,23,42,0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000
};

const modalStyle: React.CSSProperties = {
  background: '#ffffff',
  borderRadius: '10px',
  padding: '24px',
  width: '680px',
  maxWidth: '94vw',
  maxHeight: '85vh',
  display: 'flex',
  flexDirection: 'column',
  boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.15)'
};

const actionBoxStyle: React.CSSProperties = {
  padding: '12px 14px',
  borderRadius: '8px',
  background: '#f8fafc',
  border: '1px solid #e2e8f0'
};

const inputStyle: React.CSSProperties = {
  padding: '7px 10px',
  borderRadius: '6px',
  border: '1px solid #cbd5e1',
  fontSize: '12px'
};

const primaryBtnStyle: React.CSSProperties = {
  padding: '7px 14px',
  borderRadius: '6px',
  background: '#2563eb',
  color: '#ffffff',
  border: 'none',
  fontSize: '12px',
  fontWeight: 600,
  cursor: 'pointer'
};

const secondaryBtnSmallStyle: React.CSSProperties = {
  padding: '4px 8px',
  borderRadius: '4px',
  border: '1px solid #cbd5e1',
  background: '#ffffff',
  color: '#334155',
  fontSize: '11px',
  fontWeight: 600,
  cursor: 'pointer'
};

const secondaryLinkBtnStyle: React.CSSProperties = {
  padding: '6px 10px',
  borderRadius: '6px',
  border: '1px solid #cbd5e1',
  background: '#f8fafc',
  color: '#334155',
  fontSize: '12px',
  fontWeight: 600,
  textDecoration: 'none'
};

const closeBtnStyle: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: '6px',
  border: '1px solid #cbd5e1',
  background: '#ffffff',
  color: '#475569',
  fontSize: '12px',
  fontWeight: 600,
  cursor: 'pointer'
};

const dangerBtnSmallStyle: React.CSSProperties = {
  padding: '4px 8px',
  borderRadius: '4px',
  border: '1px solid #dc2626',
  background: '#ffffff',
  color: '#dc2626',
  fontSize: '11px',
  fontWeight: 600,
  cursor: 'pointer'
};

function getSubTabStyle(active: boolean): React.CSSProperties {
  return {
    padding: '8px 14px',
    background: 'transparent',
    border: 'none',
    borderBottom: active ? '2px solid #2563eb' : '2px solid transparent',
    color: active ? '#2563eb' : '#64748b',
    fontWeight: active ? 700 : 500,
    fontSize: '13px',
    cursor: 'pointer'
  };
}
