import React, { useEffect, useState } from 'react';
import { LookerExtensionSDK } from '@looker/extension-sdk';
import './App.css';
import { BUILD_HASH, BUILD_TIMESTAMP } from './build_hash';
import { BACKEND_URL } from './config';

interface AppProps {
  extensionSDK: any;
}

const WrenchIcon: React.FC<{ size?: number; color?: string; style?: React.CSSProperties }> = ({
  size = 16,
  color = 'currentColor',
  style
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ display: 'inline-block', verticalAlign: 'middle', ...style }}
  >
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
  </svg>
);

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; error: any }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }
  componentDidCatch(error: any, errorInfo: any) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '16px', color: '#ea4335' }}>
          <strong>⚠️ Failed to load workflow UI:</strong>
          <p style={{ fontSize: '13px', margin: '4px 0 0 0' }}>{this.state.error?.message || String(this.state.error)}</p>
        </div>
      );
    }
    return this.props.children;
  }
}

interface WorkflowLoaderProps {
  workflow: any;
  coreSDK: any;
  extensionSDK: any;
  addLog: (msg: string) => void;
  callWorkflowBackend: (workflowId: string, action: string, payload?: any) => Promise<any>;
}

const WorkflowLoader: React.FC<WorkflowLoaderProps> = ({
  workflow,
  coreSDK,
  extensionSDK,
  addLog,
  callWorkflowBackend
}) => {
  const LazyComponent = React.useMemo(() => {
    const template = workflow.template;
    return React.lazy(() => import(`./workflow-templates/${template}/frontend`) as any);
  }, [workflow.template]);

  const handleCallBackend = (action: string, payload?: any) => {
    return callWorkflowBackend(workflow.id, action, payload);
  };

  return (
    <React.Suspense fallback={<div>Loading workflow interface...</div>}>
      <LazyComponent
        workflowId={workflow.id}
        label={workflow.label}
        parameters={workflow.parameters || {}}
        coreSDK={coreSDK}
        extensionSDK={extensionSDK}
        addLog={addLog}
        callBackend={handleCallBackend}
      />
    </React.Suspense>
  );
};

export const App: React.FC<AppProps> = ({ extensionSDK }) => {
  // 1. Hook Declarations (State & Memos)
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [gcfStatus, setGcfStatus] = useState<'idle' | 'checking' | 'connected' | 'offline' | 'auth_error' | 'other_error' | 'error'>('idle');
  const [workflows, setWorkflows] = useState<any[]>([]);
  const [indexFileLoaded, setIndexFileLoaded] = useState<boolean>(true);
  const [activeWorkflowId, setActiveWorkflowId] = useState<string | null>(null);
  const [hashMismatch, setHashMismatch] = useState<boolean>(false);
  const [backendHash, setBackendHash] = useState<string>('');
  const [backendTimestamp, setBackendTimestamp] = useState<string>('');
  const [dropdownOpen, setDropdownOpen] = useState<boolean>(false);

  const coreSDK = React.useMemo(() => LookerExtensionSDK.create40Client(extensionSDK), [extensionSDK]);

  // Status Badge Logic
  const isGcfError = gcfStatus === 'offline' || gcfStatus === 'auth_error' || gcfStatus === 'other_error' || gcfStatus === 'error';
  const isGcfWarning = gcfStatus === 'checking' || gcfStatus === 'idle';
  const topLevelStatusClass = isGcfError ? 'error' : (isGcfWarning ? 'warning' : 'success');

  // Grouping Available vs Unavailable Workflows
  const availableWorkflows = workflows.filter(w => w.authorized !== false);
  const unavailableWorkflows = workflows.filter(w => w.authorized === false);
  const availablePageWorkflows = availableWorkflows.filter(w => getMountType(w) === 'page');

  const activeWorkflow = workflows.find(w => w.id === activeWorkflowId);

  // 2. Effects
  useEffect(handleInitialize, [extensionSDK, coreSDK]);
  useEffect(handleHistorySync, [workflows]);

  // 3. Returned Component JSX
  if (loading) {
    return (
      <div className="loading-container">
        <div className="spinner"></div>
        <p>Initializing Control Center...</p>
      </div>
    );
  }

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="header-info">
          <h1>Looker Nano-Admin Control Center</h1>
        </div>
        
        {/* Header Controls: Wrench IDE Button & User status badge with dropdown */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            className="btn-ide-link"
            onClick={handleOpenIdeConfig}
            title={indexFileLoaded ? "Edit index.md in Looker IDE" : "Open nano_admin Project in Looker IDE"}
            aria-label="Edit Configuration in Looker IDE"
          >
            <WrenchIcon size={18} />
          </button>

          <div className="user-dropdown-container">
            <div className="user-badge" onClick={handleToggleDropdown}>
              {currentUser && (
                <>
                  <span className={`status-dot ${topLevelStatusClass}`}></span>
                  <span>{currentUser.display_name}</span>
                  <span className="dropdown-arrow">▼</span>
                </>
              )}
            </div>
          {dropdownOpen && (
            <div className="status-dropdown-menu">
              <div className="dropdown-header">System Status</div>
              <div className="status-row">
                <span>Looker SDK Integration</span>
                <span className="badge badge-success">Connected</span>
              </div>
              <div className="status-row">
                <span>Backend Status</span>
                {gcfStatus === 'idle' && <span className="badge badge-neutral">Idle</span>}
                {gcfStatus === 'checking' && <span className="badge badge-neutral pulse">Checking...</span>}
                {gcfStatus === 'connected' && <span className="badge badge-success">Online</span>}
                {gcfStatus === 'offline' && <span className="badge badge-error">Offline</span>}
                {gcfStatus === 'auth_error' && <span className="badge badge-error">Auth Error</span>}
                {gcfStatus === 'other_error' && <span className="badge badge-error">Error</span>}
                {gcfStatus === 'error' && <span className="badge badge-error">Offline / Error</span>}
              </div>

              <div className="dropdown-divider"></div>
              <div className="dropdown-header">Build Details</div>

              <div className="status-row">
                <span>Frontend Hash</span>
                <span className="status-mono">{BUILD_HASH.substring(0, 8)}</span>
              </div>
              <div className="status-row">
                <span>Frontend Built</span>
                <span className="status-text">{formatTimestamp(BUILD_TIMESTAMP)}</span>
              </div>

              <div className="status-row">
                <span>Backend Hash</span>
                <span className="status-mono">{backendHash ? backendHash.substring(0, 8) : '—'}</span>
              </div>
              <div className="status-row">
                <span>Backend Built</span>
                <span className="status-text">{backendTimestamp ? formatTimestamp(backendTimestamp) : '—'}</span>
              </div>

              <div className="dropdown-divider"></div>
              <div className="dropdown-user-details">
                {currentUser?.email}
              </div>
            </div>
          )}
        </div>
      </div>
    </header>

      {hashMismatch && (
        <div className="warning-banner" style={{
          background: 'rgba(234, 67, 53, 0.1)',
          border: '1px solid rgba(234, 67, 53, 0.3)',
          color: '#ea4335',
          padding: '12px 16px',
          borderRadius: '8px',
          marginBottom: '24px',
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
          fontSize: '14px'
        }}>
          <strong style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            ⚠️ Workspace Out-Of-Sync Warning
          </strong>
          <span>
            The local Extension bundle build hash (<code>{BUILD_HASH.substring(0, 8)}</code>) does not match the deployed backend build hash (<code>{backendHash ? backendHash.substring(0, 8) : 'unknown'}</code>).
          </span>
          <span style={{ fontSize: '12px', marginTop: '4px', opacity: 0.8 }}>
            Please deploy the backend Cloud Function (<code>npm run backend:deploy</code>) or rebuild the extension bundle (<code>npm run extension:build</code>) to sync them.
          </span>
        </div>
      )}

      {/* Main Content Area: Switch between Dashboard View and Dedicated Page View */}
      {activeWorkflowId && activeWorkflow ? (
        <div className="page-view-section">
          {/* Shared Navigation Header / Interactive Breadcrumb */}
          <nav className="workflow-nav-bar">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '15px' }}>
              <button
                onClick={handleBackToNanoAdmin}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  color: 'var(--primary-color)',
                  fontWeight: '600',
                  cursor: 'pointer',
                  fontSize: '15px'
                }}
              >
                Nano Admin
              </button>
              <span style={{ color: 'var(--text-muted)' }}>/</span>
              <span style={{ fontWeight: '600', color: '#1a202c' }}>{activeWorkflow.label}</span>
            </div>

            {/* Quick Page Tab Switcher */}
            {availablePageWorkflows.length > 1 && (
              <div style={{ display: 'flex', gap: '6px' }}>
                {availablePageWorkflows.map(wf => (
                  <button
                    key={wf.id}
                    onClick={() => handleNavigateToWorkflow(wf.id)}
                    style={{
                      padding: '6px 12px',
                      borderRadius: '20px',
                      fontSize: '12px',
                      fontWeight: '600',
                      cursor: 'pointer',
                      border: 'none',
                      background: wf.id === activeWorkflowId ? 'var(--primary-color)' : 'rgba(0,0,0,0.05)',
                      color: wf.id === activeWorkflowId ? 'white' : 'var(--text-muted)'
                    }}
                  >
                    {wf.label}
                  </button>
                ))}
              </div>
            )}
          </nav>

          {/* Full Page Workflow Component Container */}
          <div className="page-workflow-container">
            <ErrorBoundary>
              <WorkflowLoader
                workflow={activeWorkflow}
                coreSDK={coreSDK}
                extensionSDK={extensionSDK}
                addLog={addLog}
                callWorkflowBackend={callWorkflowBackend}
              />
            </ErrorBoundary>
          </div>
        </div>
      ) : (
        /* Dashboard View */
        <>
          <section className="main-actions-section">
            <h2 style={{ fontSize: '20px', fontWeight: '600', marginBottom: '16px' }}>Available Actions</h2>
            
            {availableWorkflows.length === 0 ? (
              <div className="card" style={{ padding: '36px 24px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div style={{ fontSize: '36px', marginBottom: '12px' }}>⚙️</div>
                <h3 style={{ margin: '0 0 8px 0', fontSize: '18px', fontWeight: '600', color: 'var(--text-main)' }}>
                  No Workflows Configured Yet
                </h3>
                <p className="card-description" style={{ margin: '0 0 20px 0', maxWidth: '520px', color: 'var(--text-muted)', lineHeight: '1.5', textAlign: 'center' }}>
                  {indexFileLoaded
                    ? "No active administrative workflows found in index.md. Add workflow definitions to your project configuration to make them available here."
                    : "Could not locate index.md in the nano_admin Looker project. Create or configure index.md in your project root to define administrative workflows."}
                </p>
                <button
                  className="btn btn-primary"
                  onClick={handleOpenIdeConfig}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
                >
                  <WrenchIcon size={16} color="#ffffff" />
                  <span>{indexFileLoaded ? 'Configure index.md in Looker IDE →' : 'Open nano_admin Project in IDE →'}</span>
                </button>
              </div>
            ) : (
              <div className="dashboard-grid">
                {availableWorkflows.map((workflow, idx) => {
                  const mountType = getMountType(workflow);

                  if (mountType === 'card') {
                    // Card Mode: Component renders inline directly in card
                    return (
                      <section key={`wf-avail-${idx}`} className="card">
                        <div style={{ marginBottom: '12px' }}>
                          <h3 style={{ margin: 0 }}>{workflow.label}</h3>
                        </div>
                        <ErrorBoundary>
                          <WorkflowLoader
                            workflow={workflow}
                            coreSDK={coreSDK}
                            extensionSDK={extensionSDK}
                            addLog={addLog}
                            callWorkflowBackend={callWorkflowBackend}
                          />
                        </ErrorBoundary>
                      </section>
                    );
                  }

                  // Page Mode: Render preview card with "Open Workflow" launch action
                  return (
                    <section key={`wf-avail-${idx}`} className="card">
                      <div style={{ marginBottom: '12px' }}>
                        <h3 style={{ margin: 0 }}>{workflow.label}</h3>
                      </div>
                      <p className="card-description">
                        {getWorkflowDescription(workflow)}
                      </p>
                      <button
                        className="btn btn-primary"
                        onClick={() => handleNavigateToWorkflow(workflow.id)}
                        style={{ alignSelf: 'flex-start', marginTop: '12px' }}
                      >
                        Open Workflow →
                      </button>
                    </section>
                  );
                })}
              </div>
            )}
          </section>

          {/* Restricted Actions Section */}
          {unavailableWorkflows.length > 0 && (
            <section className="restricted-actions-section" style={{ marginTop: '48px', opacity: 0.6 }}>
              <h2 style={{ fontSize: '18px', fontWeight: '500', color: 'var(--text-muted)', marginBottom: '16px' }}>
                Restricted Actions
              </h2>
              <div className="dashboard-grid">
                {unavailableWorkflows.map((workflow, idx) => (
                  <section key={`wf-unavail-${idx}`} className="card card-disabled" style={{ cursor: 'not-allowed' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                      <h3 style={{ margin: 0, color: 'var(--text-muted)' }}>{workflow.label}</h3>
                      <span className="badge badge-error" style={{ fontSize: '10px' }}>Access Denied</span>
                    </div>
                    <p className="card-description" style={{ color: 'var(--text-muted)' }}>
                      You do not have authorization to view or execute this workflow.
                    </p>
                  </section>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );

  // 4. Hoisted Function Definitions
  function handleInitialize() {
    fetchUserAndWorkflows();
  }

  function handleHistorySync() {
    const handlePopState = () => {
      const hash = window.location.hash.replace(/^#\/?/, '');
      if (!hash) {
        setActiveWorkflowId(null);
      } else {
        const matchingWf = workflows.find(w => w.id === hash);
        if (matchingWf) {
          setActiveWorkflowId(matchingWf.id);
        } else {
          setActiveWorkflowId(null);
        }
      }
    };

    window.addEventListener('popstate', handlePopState);
    window.addEventListener('hashchange', handlePopState);

    // Deep-linking resolution on initial load
    const initialHash = window.location.hash.replace(/^#\/?/, '');
    if (initialHash && workflows.length > 0) {
      const matchingWf = workflows.find(w => w.id === initialHash);
      if (matchingWf) {
        setActiveWorkflowId(matchingWf.id);
      }
    }

    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('hashchange', handlePopState);
    };
  }

  function handleToggleDropdown() {
    setDropdownOpen(prev => !prev);
  }

  function handleNavigateToWorkflow(workflowId: string) {
    const routePath = `/${workflowId}`;
    const hashUrl = `#${routePath}`;

    if (window.location.hash !== hashUrl) {
      window.location.hash = hashUrl;
    }
    if (extensionSDK?.clientRouteChanged) {
      extensionSDK.clientRouteChanged(routePath);
    }
    setActiveWorkflowId(workflowId);
  }

  function handleBackToNanoAdmin() {
    if (window.location.hash !== '' && window.location.hash !== '#/') {
      window.location.hash = '#/';
    }
    if (extensionSDK?.clientRouteChanged) {
      extensionSDK.clientRouteChanged('/');
    }
    setActiveWorkflowId(null);
  }

  function handleOpenIdeConfig() {
    const idePath = indexFileLoaded
      ? '/projects/nano_admin/files/index.md'
      : '/projects/nano_admin';
    try {
      if (extensionSDK && typeof extensionSDK.updateLocation === 'function') {
        extensionSDK.updateLocation(idePath);
      } else {
        window.open(idePath, '_blank');
      }
    } catch (e) {
      console.warn('Failed to navigate using extensionSDK.updateLocation, falling back to window.open:', e);
      window.open(idePath, '_blank');
    }
  }

  function getWorkflowDescription(workflow: any): string {
    if (workflow.description) {
      return workflow.description;
    }
    const target = workflow.parameters?.target_object;
    if (target) {
      const humanTarget = target
        .replace(/_/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .toLowerCase();
      return `Manage ${humanTarget} records and settings.`;
    }
    if (workflow.template === 'kill-queries') {
      const threshold = workflow.parameters?.min_runtime_seconds || 600;
      return `Scan and terminate active queries running longer than ${threshold}s.`;
    }
    return `Manage ${workflow.label}.`;
  }

  function getMountType(wf: any): 'page' | 'card' {
    if (wf.mount_type) return wf.mount_type;
    if (wf.parameters?.mount_type) return wf.parameters.mount_type;
    return wf.template === 'crud' ? 'page' : 'card';
  }

  function checkBuildHash(data: any) {
    if (data && data.build_hash) {
      setBackendHash(data.build_hash);
      if (data.build_timestamp) {
        setBackendTimestamp(data.build_timestamp);
      }
      if (data.build_hash !== BUILD_HASH) {
        setHashMismatch(true);
      } else {
        setHashMismatch(false);
      }
    }
  }

  function formatTimestamp(tsString: string): string {
    if (!tsString) return '—';
    try {
      const date = new Date(tsString);
      if (isNaN(date.getTime())) return tsString;
      return date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return tsString;
    }
  }

  function addLog(message: string) {
    console.log(`[Nano Admin] ${message}`);
  }

  async function fetchUserAndWorkflows() {
    let userId = '';
    let meInfo: any = null;
    try {
      addLog('Connecting to Looker Extension SDK...');
      meInfo = await coreSDK.ok(coreSDK.me());
      setCurrentUser(meInfo);
      userId = String(meInfo.id);
      addLog(`Authenticated as Looker User: ${meInfo.display_name} (${meInfo.email})`);
    } catch (error) {
      console.error(error);
      addLog(`Error fetching user data from Looker: ${String(error)}`);
    }

    addLog('Initiating backend call to fetch registered workflows...');
    setGcfStatus('checking');
    try {
      const payload = {
        action: 'get_workflows'
      };
      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `looker-attribute-challenge ${extensionSDK.createSecretKeyTag('nano_admin_challenge')}`,
        'X-Looker-User-ID': userId
      };
      
      let response = await extensionSDK.serverProxy(BACKEND_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });

      if (response.status === 401) {
        addLog('Challenge required or expired. Retrying workflows fetch...');
        const errData = response.body;
        checkBuildHash(errData);
        response = await extensionSDK.serverProxy(BACKEND_URL, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload)
        });
      }

      if (!response.ok) {
        const err = new Error(`HTTP Error: ${response.status}`);
        (err as any).status = response.status;
        throw err;
      }

      const data = response.body;
      setGcfStatus('connected');
      checkBuildHash(data);
      if (data.index_file_loaded !== undefined) {
        setIndexFileLoaded(data.index_file_loaded);
      }
      if (data.workflows) {
        setWorkflows(data.workflows);
      }
      addLog(`Backend responded successfully: Loaded ${data.workflows?.length || 0} workflows.`);
    } catch (error: any) {
      console.error(error);
      if (error.status === 401) {
        setGcfStatus('auth_error');
      } else if (error.status) {
        setGcfStatus('other_error');
      } else {
        setGcfStatus('offline');
      }
      addLog(`Backend connection failed: ${String(error)}`);
    } finally {
      setLoading(false);
    }
  }

  async function callWorkflowBackend(workflowId: string, workflowAction: string, payload?: any) {
    addLog(`Initiating backend call for workflow '${workflowId}' action '${workflowAction}'...`);
    setGcfStatus('checking');
    try {
      const requestPayload = {
        action: 'execute_workflow',
        workflowId,
        workflowAction,
        payload
      };
      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `looker-attribute-challenge ${extensionSDK.createSecretKeyTag('nano_admin_challenge')}`,
        'X-Looker-User-ID': currentUser ? String(currentUser.id) : ''
      };

      let response = await extensionSDK.serverProxy(BACKEND_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestPayload)
      });

      if (response.status === 401) {
        addLog('Challenge required or expired. Retrying workflow execution...');
        const errData = response.body;
        checkBuildHash(errData);
        response = await extensionSDK.serverProxy(BACKEND_URL, {
          method: 'POST',
          headers,
          body: JSON.stringify(requestPayload)
        });
      }

      if (!response.ok) {
        if (response.status === 403) {
          const errData = response.body;
          const err = new Error(errData.error || 'Forbidden');
          (err as any).status = 403;
          throw err;
        }
        const err = new Error(`HTTP Error: ${response.status}`);
        (err as any).status = response.status;
        throw err;
      }

      const data = response.body;
      setGcfStatus('connected');
      checkBuildHash(data);
      addLog(`Backend responded successfully for workflow: ${data.message || 'Success'}`);
      return data.result;
    } catch (error: any) {
      console.error(error);
      if (error.status === 401) {
        setGcfStatus('auth_error');
      } else if (error.status) {
        setGcfStatus('other_error');
      } else {
        setGcfStatus('offline');
      }
      addLog(`Backend connection failed: ${String(error)}`);
      throw error;
    }
  }
};

export default App;
