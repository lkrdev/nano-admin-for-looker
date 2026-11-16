import React, { useEffect, useMemo, useState } from 'react';

export interface GroupDetailModalProps {
  groupId: string;
  onClose: () => void;
  onGroupUpdated: () => void;
  onSelectGroup: (groupId: string) => void;
  callBackend: (action: string, payload?: any) => Promise<any>;
  addLog: (msg: string) => void;
}

export const GroupDetailModal: React.FC<GroupDetailModalProps> = ({
  groupId,
  onClose,
  onGroupUpdated,
  onSelectGroup,
  callBackend,
  addLog
}) => {
  // 1. Hook Declarations
  const [loading, setLoading] = useState<boolean>(true);
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [details, setDetails] = useState<any | null>(null);
  const [activeSection, setActiveSection] = useState<'members' | 'owners' | 'subgroups'>('members');

  const [memberSearch, setMemberSearch] = useState<string>('');
  const [addUserSearch, setAddUserSearch] = useState<string>('');
  const [selectedUserIdToAdd, setSelectedUserIdToAdd] = useState<string>('');

  const [ownerTypeToAdd, setOwnerTypeToAdd] = useState<'user' | 'group'>('user');
  const [selectedOwnerIdToAdd, setSelectedOwnerIdToAdd] = useState<string>('');

  const [selectedExistingSubgroupId, setSelectedExistingSubgroupId] = useState<string>('');
  const [newSubgroupName, setNewSubgroupName] = useState<string>('');

  const members = details?.members || [];
  const addableUsers = details?.addable_users || [];
  const eligibleUsers = details?.eligible_users || [];
  const allGroups = details?.all_groups || [];
  const subgroups = details?.subgroups || [];
  const addableChildGroups = details?.addable_child_groups || [];
  const owners = details?.group?.owners || [];
  const capabilities = details?.capabilities?.memberships || {};
  const limitationMode = details?.capabilities?.user_id_limitation?.mode || 'exclude_privileged';

  const filteredMembers = useMemo(filterCurrentMembers, [members, memberSearch]);
  const filteredAddableUsers = useMemo(filterCandidateUsers, [addableUsers, addUserSearch]);

  useEffect(handleLoadGroupDetails, [groupId]);

  // 2. Returned Component JSX
  return (
    <div style={backdropStyle}>
      <div style={modalContainerStyle}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: '#0f172a' }}>
                {details?.group?.name || `Group ${groupId}`}
              </h2>
              <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', background: '#f1f5f9', color: '#475569', fontWeight: 600 }}>
                ID: {groupId}
              </span>
              {details?.group?.is_direct_owner ? (
                <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', background: '#dcfce7', color: '#166534', fontWeight: 600 }}>
                  Direct Owner
                </span>
              ) : (
                <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', background: '#e0f2fe', color: '#0369a1', fontWeight: 600 }}>
                  Subgroup (Depth {details?.group?.depth || 1})
                </span>
              )}
            </div>
            <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#64748b' }}>
              User Discovery Limitation: <code>{limitationMode}</code>
            </p>
          </div>
          <button onClick={onClose} style={closeButtonStyle}>
            Close
          </button>
        </div>

        {errorMsg && (
          <div style={{ padding: '10px 14px', borderRadius: '6px', background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', fontSize: '12px', marginBottom: '14px' }}>
            {errorMsg}
          </div>
        )}

        {/* Section Tabs */}
        <div style={{ display: 'flex', gap: '6px', borderBottom: '1px solid #e2e8f0', marginBottom: '16px' }}>
          <button
            onClick={handleSelectMembersTab}
            style={getTabBtnStyle(activeSection === 'members')}
          >
            Members ({members.length})
          </button>
          <button
            onClick={handleSelectOwnersTab}
            style={getTabBtnStyle(activeSection === 'owners')}
          >
            Group Owners ({owners.length})
          </button>
          <button
            onClick={handleSelectSubgroupsTab}
            style={getTabBtnStyle(activeSection === 'subgroups')}
          >
            Subgroups ({subgroups.length})
          </button>
        </div>

        {loading ? (
          <div style={{ padding: '32px', textAlign: 'center', fontSize: '13px', color: '#64748b' }}>
            Loading group details...
          </div>
        ) : (
          <div style={{ flex: 1, overflowY: 'auto', paddingRight: '4px' }}>
            {/* Section 1: Members */}
            {activeSection === 'members' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {capabilities.allow_add_users && (
                  <div style={cardBoxStyle}>
                    <div style={{ fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '8px' }}>
                      Add Existing User to Group
                    </div>
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                      <input
                        type="text"
                        placeholder="Filter eligible users by name, email, or ID..."
                        value={addUserSearch}
                        onChange={handleAddUserSearchChange}
                        style={{ ...inputStyle, flex: 1 }}
                      />
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <select
                        value={selectedUserIdToAdd}
                        onChange={handleSelectedUserChange}
                        style={{ ...inputStyle, flex: 1 }}
                      >
                        <option value="">-- Select User ({filteredAddableUsers.length} available) --</option>
                        {filteredAddableUsers.map((u: any) => (
                          <option key={u.id} value={u.id}>
                            {u.name} {u.email ? `(${u.email})` : ''} [ID: {u.id}]
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={handleAddUser}
                        disabled={actionLoading || !selectedUserIdToAdd}
                        style={primaryBtnStyle}
                      >
                        Add Member
                      </button>
                    </div>
                  </div>
                )}

                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 700, color: '#1e293b' }}>
                      Current Group Members ({filteredMembers.length})
                    </span>
                    <input
                      type="text"
                      placeholder="Filter current members..."
                      value={memberSearch}
                      onChange={handleMemberSearchChange}
                      style={{ ...inputStyle, width: '220px' }}
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
                                {capabilities.allow_remove_users && (
                                  <button
                                    onClick={() => handleRemoveUser(m.id)}
                                    disabled={actionLoading}
                                    style={dangerBtnOutlineStyle}
                                  >
                                    Remove
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <div style={{ padding: '16px', textAlign: 'center', fontSize: '12px', color: '#94a3b8' }}>
                        No members in this group.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Section 2: Group Owners */}
            {activeSection === 'owners' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {capabilities.allow_edit_owners && (
                  <div style={cardBoxStyle}>
                    <div style={{ fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '8px' }}>
                      Add Group Owner
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
                          ? eligibleUsers.map((u: any) => (
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
                )}

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
                              {capabilities.allow_edit_owners && (
                                <button
                                  onClick={() => handleRemoveOwner(o.type, o.id)}
                                  disabled={actionLoading}
                                  style={dangerBtnOutlineStyle}
                                >
                                  Remove Owner
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div style={{ padding: '16px', textAlign: 'center', fontSize: '12px', color: '#94a3b8' }}>
                      No direct owners configured on this group (inherited via parent group).
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Section 3: Subgroups */}
            {activeSection === 'subgroups' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {capabilities.allow_add_existing_groups && (
                  <div style={cardBoxStyle}>
                    <div style={{ fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '8px' }}>
                      Add Existing Group as Child Subgroup
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <select
                        value={selectedExistingSubgroupId}
                        onChange={handleSelectedExistingSubgroupChange}
                        style={{ ...inputStyle, flex: 1 }}
                      >
                        <option value="">-- Select Existing Group ({addableChildGroups.length} available) --</option>
                        {addableChildGroups.map((g: any) => (
                          <option key={g.id} value={g.id}>
                            {g.name} (ID: {g.id})
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={handleAddExistingSubgroup}
                        disabled={actionLoading || !selectedExistingSubgroupId}
                        style={primaryBtnStyle}
                      >
                        Attach Subgroup
                      </button>
                    </div>
                  </div>
                )}

                {capabilities.allow_create_subgroups && (
                  <div style={cardBoxStyle}>
                    <div style={{ fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '8px' }}>
                      Create New Child Subgroup
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <input
                        type="text"
                        placeholder="New child group name..."
                        value={newSubgroupName}
                        onChange={handleNewSubgroupNameChange}
                        style={{ ...inputStyle, flex: 1 }}
                      />
                      <button
                        onClick={handleCreateNewSubgroup}
                        disabled={actionLoading || !newSubgroupName.trim()}
                        style={primaryBtnStyle}
                      >
                        Create & Attach
                      </button>
                    </div>
                  </div>
                )}

                <div style={{ border: '1px solid #e2e8f0', borderRadius: '6px', overflow: 'hidden' }}>
                  {subgroups.length > 0 ? (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                      <thead>
                        <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', textAlign: 'left', color: '#64748b' }}>
                          <th style={{ padding: '8px 12px' }}>Child Subgroup</th>
                          <th style={{ padding: '8px 12px' }}>ID</th>
                          <th style={{ padding: '8px 12px' }}>Members</th>
                          <th style={{ padding: '8px 12px', textAlign: 'right' }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {subgroups.map((sg: any) => (
                          <tr key={sg.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                            <td style={{ padding: '8px 12px', fontWeight: 600, color: '#0f172a' }}>
                              {sg.name}
                            </td>
                            <td style={{ padding: '8px 12px', color: '#64748b' }}>
                              <code>{sg.id}</code>
                            </td>
                            <td style={{ padding: '8px 12px', color: '#475569' }}>
                              {sg.user_count} member(s)
                            </td>
                            <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                              <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                                <button
                                  onClick={() => onSelectGroup(sg.id)}
                                  style={secondaryBtnSmallStyle}
                                >
                                  Inspect Subgroup
                                </button>
                                {capabilities.allow_remove_child_groups && (
                                  <button
                                    onClick={() => handleRemoveSubgroup(sg.id)}
                                    disabled={actionLoading}
                                    style={dangerBtnOutlineStyle}
                                  >
                                    Detach
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div style={{ padding: '16px', textAlign: 'center', fontSize: '12px', color: '#94a3b8' }}>
                      No child subgroups attached to this group.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );

  // 3. Hoisted Function Implementations
  function filterCurrentMembers() {
    if (!memberSearch.trim()) return members;
    const term = memberSearch.toLowerCase();
    return members.filter(
      (m: any) =>
        String(m.name || '').toLowerCase().includes(term) ||
        String(m.email || '').toLowerCase().includes(term) ||
        String(m.id || '').toLowerCase().includes(term)
    );
  }

  function filterCandidateUsers() {
    if (!addUserSearch.trim()) return addableUsers;
    const term = addUserSearch.toLowerCase();
    return addableUsers.filter(
      (u: any) =>
        String(u.name || '').toLowerCase().includes(term) ||
        String(u.email || '').toLowerCase().includes(term) ||
        String(u.id || '').toLowerCase().includes(term)
    );
  }

  function handleLoadGroupDetails() {
    setLoading(true);
    setErrorMsg(null);
    callBackend('get_group_details', { group_id: groupId })
      .then((res) => {
        setDetails(res);
        setLoading(false);
      })
      .catch((err) => {
        setErrorMsg(err.message || 'Failed to load group details.');
        setLoading(false);
      });
  }

  function handleSelectMembersTab() {
    setActiveSection('members');
  }

  function handleSelectOwnersTab() {
    setActiveSection('owners');
  }

  function handleSelectSubgroupsTab() {
    setActiveSection('subgroups');
  }

  function handleMemberSearchChange(e: React.ChangeEvent<HTMLInputElement>) {
    setMemberSearch(e.target.value);
  }

  function handleAddUserSearchChange(e: React.ChangeEvent<HTMLInputElement>) {
    setAddUserSearch(e.target.value);
  }

  function handleSelectedUserChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setSelectedUserIdToAdd(e.target.value);
  }

  function handleAddUser() {
    if (!selectedUserIdToAdd) return;
    setActionLoading(true);
    setErrorMsg(null);
    callBackend('add_user_to_group', { group_id: groupId, user_id: selectedUserIdToAdd })
      .then(() => {
        addLog(`Added user ${selectedUserIdToAdd} to group ${groupId}`);
        setSelectedUserIdToAdd('');
        handleLoadGroupDetails();
        onGroupUpdated();
      })
      .catch((err) => setErrorMsg(err.message || 'Failed to add user to group.'))
      .finally(() => setActionLoading(false));
  }

  function handleRemoveUser(userId: string) {
    setActionLoading(true);
    setErrorMsg(null);
    callBackend('remove_user_from_group', { group_id: groupId, user_id: userId })
      .then(() => {
        addLog(`Removed user ${userId} from group ${groupId}`);
        handleLoadGroupDetails();
        onGroupUpdated();
      })
      .catch((err) => setErrorMsg(err.message || 'Failed to remove user from group.'))
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
    callBackend('update_group_owner', {
      group_id: groupId,
      operation: 'add',
      owner_type: ownerTypeToAdd,
      owner_id: selectedOwnerIdToAdd
    })
      .then(() => {
        addLog(`Added ${ownerTypeToAdd} owner ${selectedOwnerIdToAdd} on group ${groupId}`);
        setSelectedOwnerIdToAdd('');
        handleLoadGroupDetails();
        onGroupUpdated();
      })
      .catch((err) => setErrorMsg(err.message || 'Failed to add group owner.'))
      .finally(() => setActionLoading(false));
  }

  function handleRemoveOwner(ownerType: 'user' | 'group', ownerId: string) {
    setActionLoading(true);
    setErrorMsg(null);
    callBackend('update_group_owner', {
      group_id: groupId,
      operation: 'remove',
      owner_type: ownerType,
      owner_id: ownerId
    })
      .then(() => {
        addLog(`Removed ${ownerType} owner ${ownerId} from group ${groupId}`);
        handleLoadGroupDetails();
        onGroupUpdated();
      })
      .catch((err) => setErrorMsg(err.message || 'Failed to remove group owner.'))
      .finally(() => setActionLoading(false));
  }

  function handleSelectedExistingSubgroupChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setSelectedExistingSubgroupId(e.target.value);
  }

  function handleAddExistingSubgroup() {
    if (!selectedExistingSubgroupId) return;
    setActionLoading(true);
    setErrorMsg(null);
    callBackend('add_child_group', {
      parent_group_id: groupId,
      child_group_id: selectedExistingSubgroupId
    })
      .then(() => {
        addLog(`Attached subgroup ${selectedExistingSubgroupId} to group ${groupId}`);
        setSelectedExistingSubgroupId('');
        handleLoadGroupDetails();
        onGroupUpdated();
      })
      .catch((err) => setErrorMsg(err.message || 'Failed to attach child subgroup.'))
      .finally(() => setActionLoading(false));
  }

  function handleNewSubgroupNameChange(e: React.ChangeEvent<HTMLInputElement>) {
    setNewSubgroupName(e.target.value);
  }

  function handleCreateNewSubgroup() {
    if (!newSubgroupName.trim()) return;
    setActionLoading(true);
    setErrorMsg(null);
    callBackend('create_child_group', {
      parent_group_id: groupId,
      group_name: newSubgroupName.trim()
    })
      .then(() => {
        addLog(`Created subgroup "${newSubgroupName.trim()}" under group ${groupId}`);
        setNewSubgroupName('');
        handleLoadGroupDetails();
        onGroupUpdated();
      })
      .catch((err) => setErrorMsg(err.message || 'Failed to create child subgroup.'))
      .finally(() => setActionLoading(false));
  }

  function handleRemoveSubgroup(childGroupId: string) {
    setActionLoading(true);
    setErrorMsg(null);
    callBackend('remove_child_group', {
      parent_group_id: groupId,
      child_group_id: childGroupId
    })
      .then(() => {
        addLog(`Detached subgroup ${childGroupId} from group ${groupId}`);
        handleLoadGroupDetails();
        onGroupUpdated();
      })
      .catch((err) => setErrorMsg(err.message || 'Failed to remove child subgroup.'))
      .finally(() => setActionLoading(false));
  }
};

const backdropStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  background: 'rgba(15, 23, 42, 0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000
};

const modalContainerStyle: React.CSSProperties = {
  background: '#ffffff',
  borderRadius: '10px',
  padding: '24px',
  width: '720px',
  maxWidth: '94vw',
  maxHeight: '85vh',
  display: 'flex',
  flexDirection: 'column',
  boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.15)'
};

const closeButtonStyle: React.CSSProperties = {
  border: '1px solid #cbd5e1',
  background: '#ffffff',
  borderRadius: '6px',
  padding: '6px 12px',
  fontSize: '12px',
  fontWeight: 600,
  color: '#475569',
  cursor: 'pointer'
};

const cardBoxStyle: React.CSSProperties = {
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

const dangerBtnOutlineStyle: React.CSSProperties = {
  padding: '4px 8px',
  borderRadius: '4px',
  border: '1px solid #dc2626',
  background: '#ffffff',
  color: '#dc2626',
  fontSize: '11px',
  fontWeight: 600,
  cursor: 'pointer'
};

function getTabBtnStyle(active: boolean): React.CSSProperties {
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
