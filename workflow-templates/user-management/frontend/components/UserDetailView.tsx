import React, { useEffect, useMemo, useState } from 'react';
import { DetailTabId, DirectoryUser } from '../types';
import {
  cardStyle,
  getTabButtonStyle,
  pillStyle,
  secondaryBtnStyle
} from '../styles';
import { ProfileSecurityTab } from './tabs/ProfileSecurityTab';
import { GroupsTab } from './tabs/GroupsTab';
import { RolesTab } from './tabs/RolesTab';
import { UserAttributesTab } from './tabs/UserAttributesTab';
import { FolderAccessTab } from './tabs/FolderAccessTab';
import { TelemetrySchedulesTab } from './tabs/TelemetrySchedulesTab';

export interface UserDetailViewProps {
  userId: string;
  activeTab: DetailTabId;
  capabilities: any;
  inScopeUsers: DirectoryUser[];
  callBackend: (action: string, payload?: any) => Promise<any>;
  addLog: (msg: string) => void;
  onSelectTab: (tab: DetailTabId) => void;
  onBackToDirectory: () => void;
  onDirectoryRefresh: () => void;
}

export const UserDetailView: React.FC<UserDetailViewProps> = ({
  userId,
  activeTab,
  capabilities,
  inScopeUsers,
  callBackend,
  addLog,
  onSelectTab,
  onBackToDirectory,
  onDirectoryRefresh
}) => {
  // 1. Hook Declarations
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [userDetail, setUserDetail] = useState<any | null>(null);

  const visibleTabs = useMemo(computeVisibleTabs, [capabilities]);

  useEffect(handleFetchUserDetail, [userId]);

  // 2. Returned Component JSX
  if (loading && !userDetail) {
    return (
      <div style={cardStyle}>
        <div style={{ marginBottom: '12px' }}>
          <button onClick={onBackToDirectory} style={secondaryBtnStyle}>
            ← Back to User Directory
          </button>
        </div>
        <div style={{ padding: '24px 0', color: '#64748b', fontSize: '13px' }}>
          Loading user details for ID {userId}...
        </div>
      </div>
    );
  }

  if (errorMsg || !userDetail) {
    return (
      <div style={cardStyle}>
        <div style={{ marginBottom: '12px' }}>
          <button onClick={onBackToDirectory} style={secondaryBtnStyle}>
            ← Back to User Directory
          </button>
        </div>
        <div
          style={{
            padding: '12px 16px',
            borderRadius: '6px',
            background: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#991b1b',
            fontSize: '13px'
          }}
        >
          {errorMsg || `User ${userId} could not be loaded or is outside your allowed scope.`}
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Header Banner */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <button onClick={onBackToDirectory} style={secondaryBtnStyle}>
              ← Directory
            </button>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#0f172a' }}>
                  {userDetail.display_name}
                </h2>
                <span style={{ fontFamily: 'monospace', fontSize: '12px', color: '#64748b' }}>
                  (ID: {userDetail.id})
                </span>
                {userDetail.is_disabled ? (
                  <span style={pillStyle('#fef2f2', '#dc2626')}>Disabled</span>
                ) : (
                  <span style={pillStyle('#ecfdf5', '#059669')}>Active</span>
                )}
              </div>
              <div style={{ fontSize: '13px', color: '#64748b', marginTop: '2px' }}>
                {userDetail.email || 'No email address configured'}
              </div>
            </div>
          </div>

          <button onClick={handleRefreshClick} style={secondaryBtnStyle}>
            Refresh User
          </button>
        </div>

        {/* Navigation Tabs */}
        <div
          style={{
            display: 'flex',
            gap: '4px',
            borderBottom: '1px solid #e2e8f0',
            marginTop: '16px',
            flexWrap: 'wrap'
          }}
        >
          {visibleTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => onSelectTab(tab.id)}
              style={getTabButtonStyle(activeTab === tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Active Tab Content */}
      {activeTab === 'profile' && (
        <ProfileSecurityTab
          user={userDetail}
          capabilities={capabilities}
          callBackend={callBackend}
          addLog={addLog}
          onUserUpdated={handleUserMutated}
          onUserDeleted={handleUserDeleted}
        />
      )}

      {activeTab === 'groups' && (
        <GroupsTab
          userId={userId}
          callBackend={callBackend}
          addLog={addLog}
          onUserUpdated={handleUserMutated}
        />
      )}

      {activeTab === 'roles' && (
        <RolesTab
          userId={userId}
          callBackend={callBackend}
          addLog={addLog}
          onUserUpdated={handleUserMutated}
        />
      )}

      {activeTab === 'attributes' && (
        <UserAttributesTab
          userId={userId}
          callBackend={callBackend}
          addLog={addLog}
        />
      )}

      {activeTab === 'folders' && (
        <FolderAccessTab
          userId={userId}
          callBackend={callBackend}
          addLog={addLog}
        />
      )}

      {activeTab === 'telemetry' && (
        <TelemetrySchedulesTab
          userId={userId}
          inScopeUsers={inScopeUsers}
          callBackend={callBackend}
          addLog={addLog}
        />
      )}
    </div>
  );

  // 3. Hoisted Function Implementations
  function computeVisibleTabs(): Array<{ id: DetailTabId; label: string }> {
    const tabs: Array<{ id: DetailTabId; label: string }> = [
      { id: 'profile', label: 'Profile & Security' }
    ];
    if (capabilities?.groups?.allow_view !== false) {
      tabs.push({ id: 'groups', label: 'Group Memberships' });
    }
    if (capabilities?.roles?.allow_view !== false) {
      tabs.push({ id: 'roles', label: 'Role Assignments' });
    }
    if (capabilities?.user_attributes?.allow_view !== false) {
      tabs.push({ id: 'attributes', label: 'User Attributes' });
    }
    if (capabilities?.folder_access?.allow_view !== false) {
      tabs.push({ id: 'folders', label: 'Folder Access' });
    }
    if (
      capabilities?.telemetry?.allow_view_metrics !== false ||
      Boolean(capabilities?.telemetry?.allow_manage_schedules)
    ) {
      tabs.push({ id: 'telemetry', label: 'Telemetry & Schedules' });
    }
    return tabs;
  }

  function handleFetchUserDetail() {
    let mounted = true;
    async function load() {
      setLoading(true);
      setErrorMsg(null);
      try {
        const res = await callBackend('get_user_detail', { user_id: userId });
        if (mounted) {
          setUserDetail(res.user || null);
        }
      } catch (err: any) {
        if (mounted) {
          setErrorMsg(err?.message || String(err));
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }

  function handleRefreshClick() {
    handleFetchUserDetail();
  }

  function handleUserMutated() {
    handleFetchUserDetail();
    onDirectoryRefresh();
  }

  function handleUserDeleted() {
    onDirectoryRefresh();
    onBackToDirectory();
  }
};
