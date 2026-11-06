import React, { useEffect, useState } from 'react';
import { DetailTabId, DirectoryUser, WorkflowComponentProps } from './types';
import { UserDirectoryView } from './components/UserDirectoryView';
import { UserDetailView } from './components/UserDetailView';
import { CreateUserModal } from './components/CreateUserModal';

const VALID_DETAIL_TABS: DetailTabId[] = [
  'profile',
  'groups',
  'roles',
  'attributes',
  'folders',
  'telemetry'
];

export const UserManagementWorkflow: React.FC<WorkflowComponentProps> = ({
  workflowId,
  label,
  subRoute,
  onNavigateSubRoute,
  addLog,
  callBackend
}) => {
  // 1. Hook Declarations
  const [users, setUsers] = useState<DirectoryUser[]>([]);
  const [loadingDirectory, setLoadingDirectory] = useState<boolean>(false);
  const [scopeInfo, setScopeInfo] = useState<any | null>(null);
  const [capabilities, setCapabilities] = useState<any | null>(null);
  const [creationAttributes, setCreationAttributes] = useState<any[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<DetailTabId>('profile');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState<boolean>(false);

  useEffect(handleSyncSubRoute, [subRoute]);
  useEffect(handleLoadDirectory, [workflowId]);

  // 2. Returned Component JSX
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {selectedUserId ? (
        <UserDetailView
          userId={selectedUserId}
          activeTab={activeTab}
          capabilities={capabilities}
          inScopeUsers={users}
          callBackend={callBackend}
          addLog={addLog}
          onSelectTab={handleSelectTab}
          onBackToDirectory={handleBackToDirectory}
          onDirectoryRefresh={fetchDirectory}
        />
      ) : (
        <UserDirectoryView
          label={label}
          users={users}
          loading={loadingDirectory}
          capabilities={capabilities}
          scopeInfo={scopeInfo}
          onRefresh={fetchDirectory}
          onSelectUser={handleSelectUser}
          onOpenCreateModal={handleOpenCreateModal}
        />
      )}

      <CreateUserModal
        isOpen={isCreateModalOpen}
        scopeInfo={scopeInfo}
        capabilities={capabilities}
        creationAttributes={creationAttributes}
        onClose={handleCloseCreateModal}
        onCreateSubmit={handleCreateUserSubmit}
      />
    </div>
  );

  // 3. Hoisted Function Implementations
  function handleSyncSubRoute() {
    if (!subRoute) {
      setSelectedUserId(null);
      return;
    }

    const parts = subRoute.split('/').filter(Boolean);
    if (parts[0] === 'user' && parts[1]) {
      setSelectedUserId(parts[1]);
      if (parts[2] && VALID_DETAIL_TABS.includes(parts[2] as DetailTabId)) {
        setActiveTab(parts[2] as DetailTabId);
      } else {
        setActiveTab('profile');
      }
    } else {
      setSelectedUserId(null);
    }
  }

  function handleLoadDirectory() {
    fetchDirectory();
  }

  async function fetchDirectory() {
    setLoadingDirectory(true);
    try {
      const res = await callBackend('list_users');
      setUsers(res.users || []);
      setScopeInfo(res.scope_info || res.scope || null);
      setCapabilities(res.capabilities || null);
      setCreationAttributes(res.creation_attributes || []);
    } catch (err: any) {
      addLog(`Error loading user directory: ${err?.message || String(err)}`);
    } finally {
      setLoadingDirectory(false);
    }
  }

  function handleSelectUser(userId: string) {
    setSelectedUserId(userId);
    setActiveTab('profile');
    if (onNavigateSubRoute) {
      onNavigateSubRoute(`user/${userId}/profile`);
    }
  }

  function handleSelectTab(tab: DetailTabId) {
    setActiveTab(tab);
    if (selectedUserId && onNavigateSubRoute) {
      onNavigateSubRoute(`user/${selectedUserId}/${tab}`);
    }
  }

  function handleBackToDirectory() {
    setSelectedUserId(null);
    if (onNavigateSubRoute) {
      onNavigateSubRoute('');
    }
  }

  function handleOpenCreateModal() {
    setIsCreateModalOpen(true);
  }

  function handleCloseCreateModal() {
    setIsCreateModalOpen(false);
  }

  async function handleCreateUserSubmit(payload: any) {
    const res = await callBackend('create_user', payload);
    const createdId = res?.user?.id;
    addLog(`Created user ID ${createdId}`);
    if (Array.isArray(res?.warnings) && res.warnings.length > 0) {
      for (const w of res.warnings) {
        addLog(`Warning during user creation: ${w}`);
      }
    }
    await fetchDirectory();
    if (createdId) {
      handleSelectUser(String(createdId));
    }
  }
};

export default UserManagementWorkflow;
