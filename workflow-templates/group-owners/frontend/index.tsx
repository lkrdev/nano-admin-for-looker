import React, { useEffect, useMemo, useState } from 'react';
import { GroupDetailModal } from './components/GroupDetailModal';

export interface WorkflowComponentProps {
  workflowId: string;
  label: string;
  parameters: any;
  subRoute?: string;
  onNavigateSubRoute?: (subPath: string) => void;
  coreSDK: any;
  extensionSDK: any;
  addLog: (msg: string) => void;
  callBackend: (action: string, payload?: any) => Promise<any>;
}

export const GroupOwnersWorkflow: React.FC<WorkflowComponentProps> = ({
  label,
  addLog,
  callBackend
}) => {
  // 1. Hook Declarations
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [data, setData] = useState<any | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [expandedGroupIds, setExpandedGroupIds] = useState<string[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);

  const rootGroups = data?.groups || [];
  const flattenedRows = useMemo(buildVisibleRows, [rootGroups, expandedGroupIds, searchQuery]);

  useEffect(handleFetchOwnedGroups, []);

  // 2. Returned Component JSX
  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: '#64748b', fontFamily: 'Inter, system-ui, sans-serif' }}>
        <p style={{ margin: 0, fontSize: '13px', fontWeight: 500 }}>Loading owned Looker groups...</p>
      </div>
    );
  }

  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto', fontFamily: 'Inter, system-ui, sans-serif', color: '#1e293b' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#0f172a' }}>
            {label || 'Group Owners Management'}
          </h1>
          <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#64748b' }}>
            Manage memberships, group owners, and child subgroups for groups you own (<code>{data?.ownership_attribute_name || 'nano_admin_group_owners'}</code>).
          </p>
        </div>
        <button onClick={handleFetchOwnedGroups} style={secondaryButtonStyle}>
          Refresh Groups
        </button>
      </div>

      {errorMsg && (
        <div style={{ padding: '12px 16px', borderRadius: '8px', background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', marginBottom: '20px', fontSize: '13px' }}>
          <strong>Error:</strong> {errorMsg}
        </div>
      )}

      {/* Search Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', gap: '12px' }}>
        <input
          type="text"
          placeholder="Search owned groups or subgroups by name or ID..."
          value={searchQuery}
          onChange={handleSearchChange}
          style={{
            flex: 1,
            padding: '8px 12px',
            borderRadius: '6px',
            border: '1px solid #cbd5e1',
            fontSize: '13px'
          }}
        />
        <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>
          {data?.direct_owned_count || 0} Direct Owned Group(s) • {data?.total_manageable_count || 0} Total Manageable
        </span>
      </div>

      {/* Expandable Groups Table */}
      <div style={{ borderRadius: '8px', border: '1px solid #e2e8f0', background: '#ffffff', overflow: 'hidden' }}>
        {flattenedRows.length > 0 ? (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', textAlign: 'left', color: '#64748b' }}>
                <th style={{ padding: '12px' }}>Group Name</th>
                <th style={{ padding: '12px' }}>Group ID</th>
                <th style={{ padding: '12px' }}>Ownership</th>
                <th style={{ padding: '12px' }}>Owners</th>
                <th style={{ padding: '12px' }}>Members</th>
                <th style={{ padding: '12px' }}>Subgroups</th>
                <th style={{ padding: '12px', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {flattenedRows.map((row: any) => {
                const hasSubgroups = Array.isArray(row.subgroups) && row.subgroups.length > 0;
                const isExpanded = expandedGroupIds.includes(row.id) || Boolean(searchQuery.trim());
                return (
                  <tr
                    key={`${row.parentPath}-${row.id}`}
                    style={{
                      borderBottom: '1px solid #f1f5f9',
                      background: row.depth > 0 ? '#fcfdff' : '#ffffff'
                    }}
                  >
                    <td style={{ padding: '12px', paddingLeft: `${12 + row.depth * 24}px`, fontWeight: 600 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {hasSubgroups ? (
                          <button
                            onClick={() => handleToggleExpand(row.id)}
                            title={isExpanded ? 'Collapse subgroups' : 'Expand subgroups'}
                            style={{
                              border: '1px solid #cbd5e1',
                              background: '#f8fafc',
                              borderRadius: '4px',
                              width: '20px',
                              height: '20px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              cursor: 'pointer',
                              fontSize: '11px',
                              color: '#334155'
                            }}
                          >
                            {isExpanded ? '▾' : '▸'}
                          </button>
                        ) : (
                          <span style={{ display: 'inline-block', width: '20px', textAlign: 'center', color: '#cbd5e1' }}>
                            {row.depth > 0 ? '└' : '•'}
                          </span>
                        )}
                        <span>{row.name}</span>
                      </div>
                    </td>
                    <td style={{ padding: '12px', color: '#64748b' }}>
                      <code>{row.id}</code>
                    </td>
                    <td style={{ padding: '12px' }}>
                      {row.is_direct_owner ? (
                        <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', background: '#dcfce7', color: '#166534', fontWeight: 600 }}>
                          Direct Owner
                        </span>
                      ) : (
                        <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', background: '#e0f2fe', color: '#0369a1', fontWeight: 600 }}>
                          Subgroup (Level {row.depth})
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '12px', color: '#475569' }}>
                      {row.owner_count > 0 ? `${row.owner_count} owner(s)` : 'Inherited'}
                    </td>
                    <td style={{ padding: '12px', color: '#475569' }}>
                      {row.user_count} member(s)
                    </td>
                    <td style={{ padding: '12px', color: '#475569' }}>
                      {hasSubgroups ? `${row.subgroups.length} subgroup(s)` : '—'}
                    </td>
                    <td style={{ padding: '12px', textAlign: 'right' }}>
                      <button
                        onClick={() => handleOpenGroupModal(row.id)}
                        style={primaryButtonStyle}
                      >
                        Manage Group
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div style={{ padding: '32px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>
            No owned Looker groups found for your account.
          </div>
        )}
      </div>

      {/* Group Detail Modal */}
      {selectedGroupId && (
        <GroupDetailModal
          groupId={selectedGroupId}
          onClose={handleCloseGroupModal}
          onGroupUpdated={handleFetchOwnedGroups}
          onSelectGroup={handleOpenGroupModal}
          callBackend={callBackend}
          addLog={addLog}
        />
      )}
    </div>
  );

  // 3. Hoisted Function Implementations
  function buildVisibleRows() {
    const rows: any[] = [];
    const term = searchQuery.trim().toLowerCase();

    function nodeMatchesOrHasMatchingChild(node: any): boolean {
      const selfMatches =
        !term ||
        String(node.name || '').toLowerCase().includes(term) ||
        String(node.id || '').toLowerCase().includes(term);
      if (selfMatches) return true;
      return (node.subgroups || []).some(nodeMatchesOrHasMatchingChild);
    }

    function traverse(node: any, parentPath: string) {
      if (!nodeMatchesOrHasMatchingChild(node)) return;
      rows.push({
        ...node,
        parentPath
      });
      const isExpanded = expandedGroupIds.includes(node.id) || Boolean(term);
      if (isExpanded && Array.isArray(node.subgroups)) {
        for (const child of node.subgroups) {
          traverse(child, `${parentPath}/${node.id}`);
        }
      }
    }

    for (const root of rootGroups) {
      traverse(root, 'root');
    }

    return rows;
  }

  function handleFetchOwnedGroups() {
    setLoading(true);
    setErrorMsg(null);
    callBackend('list_owned_groups')
      .then((res) => {
        setData(res);
        setLoading(false);
      })
      .catch((err) => {
        setErrorMsg(err.message || 'Failed to load owned groups.');
        setLoading(false);
      });
  }

  function handleSearchChange(e: React.ChangeEvent<HTMLInputElement>) {
    setSearchQuery(e.target.value);
  }

  function handleToggleExpand(groupId: string) {
    setExpandedGroupIds((prev) =>
      prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId]
    );
  }

  function handleOpenGroupModal(groupId: string) {
    setSelectedGroupId(groupId);
  }

  function handleCloseGroupModal() {
    setSelectedGroupId(null);
  }
};

export default GroupOwnersWorkflow;

const primaryButtonStyle: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: '6px',
  background: '#2563eb',
  color: '#ffffff',
  border: 'none',
  fontSize: '12px',
  fontWeight: 600,
  cursor: 'pointer'
};

const secondaryButtonStyle: React.CSSProperties = {
  padding: '8px 14px',
  borderRadius: '6px',
  background: '#ffffff',
  color: '#334155',
  border: '1px solid #cbd5e1',
  fontSize: '13px',
  fontWeight: 600,
  cursor: 'pointer'
};
