import React, { useMemo, useState } from 'react';
import { DirectoryUser } from '../types';
import {
  cardStyle,
  inputStyle,
  pillStyle,
  primaryBtnStyle,
  secondaryBtnStyle
} from '../styles';

export interface UserDirectoryViewProps {
  label: string;
  users: DirectoryUser[];
  loading: boolean;
  capabilities: any;
  scopeInfo: any;
  onRefresh: () => void;
  onSelectUser: (userId: string) => void;
  onOpenCreateModal: () => void;
}

export const UserDirectoryView: React.FC<UserDirectoryViewProps> = ({
  label,
  users,
  loading,
  capabilities,
  scopeInfo,
  onRefresh,
  onSelectUser,
  onOpenCreateModal
}) => {
  // 1. Hook Declarations
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'disabled'>('all');
  const [groupFilter, setGroupFilter] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(15);

  const allowCreate = Boolean(capabilities?.profile?.allow_create);
  const manageableGroups = scopeInfo?.manageable_groups || [];

  const filteredUsers = useMemo(filterUsersList, [users, searchQuery, statusFilter, groupFilter]);
  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / pageSize));
  const startIndex = (currentPage - 1) * pageSize;
  const paginatedUsers = filteredUsers.slice(startIndex, startIndex + pageSize);

  // 2. Returned Component JSX
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#0f172a' }}>{label}</h2>
          <span style={{ fontSize: '12px', color: '#64748b' }}>
            {users.length} in-scope user(s) • Scope Mode: <code>{scopeInfo?.mode || 'scope_groups'}</code>
          </span>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="text"
            placeholder="Search name, email, ID..."
            value={searchQuery}
            onChange={handleSearchChange}
            style={{ ...inputStyle, width: '220px' }}
          />

          <select
            value={statusFilter}
            onChange={handleStatusFilterChange}
            style={{ ...inputStyle, width: '130px' }}
          >
            <option value="all">All Statuses</option>
            <option value="active">Active Only</option>
            <option value="disabled">Disabled Only</option>
          </select>

          {manageableGroups.length > 0 && (
            <select
              value={groupFilter}
              onChange={handleGroupFilterChange}
              style={{ ...inputStyle, width: '180px' }}
            >
              <option value="all">All Scope Groups</option>
              {manageableGroups.map((g: any) => (
                <option key={g.id} value={g.id}>
                  {g.name} {g.is_scope_group ? '(Scope)' : `(Subgroup d=${g.depth})`}
                </option>
              ))}
            </select>
          )}

          <button onClick={onRefresh} disabled={loading} style={secondaryBtnStyle}>
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>

          {allowCreate && (
            <button onClick={onOpenCreateModal} style={primaryBtnStyle}>
              + Create User
            </button>
          )}
        </div>
      </div>

      <div style={{ ...cardStyle, padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>
            Loading in-scope users...
          </div>
        ) : paginatedUsers.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>
            No matching users found in your allowed scope.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', textAlign: 'left', color: '#475569' }}>
                <th style={{ padding: '10px 14px' }}>ID</th>
                <th style={{ padding: '10px 14px' }}>User</th>
                <th style={{ padding: '10px 14px' }}>Status</th>
                <th style={{ padding: '10px 14px' }}>In-Scope Groups</th>
                <th style={{ padding: '10px 14px' }}>Direct Roles</th>
                <th style={{ padding: '10px 14px', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {paginatedUsers.map((u) => (
                <tr key={u.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '10px 14px', fontFamily: 'monospace', color: '#64748b' }}>
                    {u.id}
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    <div style={{ fontWeight: 600, color: '#0f172a' }}>{u.display_name}</div>
                    <div style={{ fontSize: '12px', color: '#64748b' }}>{u.email || 'No email'}</div>
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    {u.is_disabled ? (
                      <span style={pillStyle('#fef2f2', '#dc2626')}>Disabled</span>
                    ) : (
                      <span style={pillStyle('#ecfdf5', '#059669')}>Active</span>
                    )}
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                      {(u.manageable_groups || []).length > 0 ? (
                        u.manageable_groups.map((g) => (
                          <span
                            key={g.id}
                            style={pillStyle(
                              g.is_scope_group ? '#eff6ff' : '#f1f5f9',
                              g.is_scope_group ? '#1d4ed8' : '#334155'
                            )}
                          >
                            {g.name}
                          </span>
                        ))
                      ) : (
                        <span style={{ color: '#94a3b8', fontSize: '12px' }}>—</span>
                      )}
                    </div>
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                      {(u.direct_roles || []).length > 0 ? (
                        u.direct_roles.map((r) => (
                          <span key={r.id} style={pillStyle('#f3e8ff', '#6b21a8')}>
                            {r.name}
                          </span>
                        ))
                      ) : (
                        <span style={{ color: '#94a3b8', fontSize: '12px' }}>Inherited / None</span>
                      )}
                    </div>
                  </td>
                  <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                    <button
                      onClick={() => onSelectUser(u.id)}
                      style={primaryBtnStyle}
                    >
                      Manage User →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {filteredUsers.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', color: '#64748b' }}>
          <div>
            Showing {startIndex + 1}–{Math.min(startIndex + pageSize, filteredUsers.length)} of {filteredUsers.length} user(s)
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <select value={pageSize} onChange={handlePageSizeChange} style={{ ...inputStyle, width: '80px', padding: '4px 8px' }}>
              <option value={15}>15</option>
              <option value={30}>30</option>
              <option value={50}>50</option>
            </select>
            <button onClick={handlePrevPage} disabled={currentPage <= 1} style={secondaryBtnStyle}>
              Prev
            </button>
            <span>
              Page {currentPage} of {totalPages}
            </span>
            <button onClick={handleNextPage} disabled={currentPage >= totalPages} style={secondaryBtnStyle}>
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );

  // 3. Hoisted Function Implementations
  function filterUsersList() {
    const q = searchQuery.trim().toLowerCase();
    return users.filter((u) => {
      if (statusFilter === 'active' && u.is_disabled) return false;
      if (statusFilter === 'disabled' && !u.is_disabled) return false;
      if (groupFilter !== 'all' && !(u.group_ids || []).includes(groupFilter)) return false;

      if (!q) return true;
      return (
        u.id.toLowerCase().includes(q) ||
        u.display_name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.first_name.toLowerCase().includes(q) ||
        u.last_name.toLowerCase().includes(q)
      );
    });
  }

  function handleSearchChange(e: React.ChangeEvent<HTMLInputElement>) {
    setSearchQuery(e.target.value);
    setCurrentPage(1);
  }

  function handleStatusFilterChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setStatusFilter(e.target.value as 'all' | 'active' | 'disabled');
    setCurrentPage(1);
  }

  function handleGroupFilterChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setGroupFilter(e.target.value);
    setCurrentPage(1);
  }

  function handlePageSizeChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setPageSize(Number(e.target.value));
    setCurrentPage(1);
  }

  function handlePrevPage() {
    setCurrentPage((p) => Math.max(1, p - 1));
  }

  function handleNextPage() {
    setCurrentPage((p) => Math.min(totalPages, p + 1));
  }
};
