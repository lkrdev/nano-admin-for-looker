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

const templateComponentCache: Record<string, React.LazyExoticComponent<React.ComponentType<any>>> = {};

function getTemplateComponent(template: string): React.LazyExoticComponent<React.ComponentType<any>> {
  if (!templateComponentCache[template]) {
    templateComponentCache[template] = React.lazy(
      () => import(`./workflow-templates/${template}/frontend`) as any
    );
  }
  return templateComponentCache[template];
}

interface WorkflowLoaderProps {
  workflow: any;
  subRoute?: string | null;
  coreSDK: any;
  extensionSDK: any;
  addLog: (msg: string) => void;
  callWorkflowBackend: (workflowId: string, action: string, payload?: any) => Promise<any>;
  onNavigateSubRoute?: (subPath: string) => void;
}

const WorkflowLoader: React.FC<WorkflowLoaderProps> = ({
  workflow,
  subRoute,
  coreSDK,
  extensionSDK,
  addLog,
  callWorkflowBackend,
  onNavigateSubRoute
}) => {
  const LazyComponent = getTemplateComponent(workflow.template);

  const handleCallBackend = (action: string, payload?: any) => {
    return callWorkflowBackend(workflow.id, action, payload);
  };

  return (
    <React.Suspense fallback={<div style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}>Loading workflow interface...</div>}>
      <LazyComponent
        workflowId={workflow.id}
        label={workflow.label}
        parameters={workflow.parameters || {}}
        subRoute={subRoute || ''}
        onNavigateSubRoute={onNavigateSubRoute}
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
  const [indexParseError, setIndexParseError] = useState<string | null>(null);
  const [activeWorkflowId, setActiveWorkflowId] = useState<string | null>(null);
  const [activeSubRoute, setActiveSubRoute] = useState<string | null>(null);
  const [hashMismatch, setHashMismatch] = useState<boolean>(false);
  const [backendHash, setBackendHash] = useState<string>('');
  const [backendTimestamp, setBackendTimestamp] = useState<string>('');
  const [dropdownOpen, setDropdownOpen] = useState<boolean>(false);
  const [wrenchDropdownOpen, setWrenchDropdownOpen] = useState<boolean>(false);
  const [validatingDev, setValidatingDev] = useState<boolean>(false);
  const [devValidationResult, setDevValidationResult] = useState<any | null>(null);
  const [showValidationModal, setShowValidationModal] = useState<boolean>(false);

  const coreSDK = React.useMemo(() => LookerExtensionSDK.createClient(extensionSDK), [extensionSDK]);

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
          <div className="wrench-dropdown-container" style={{ position: 'relative' }}>
            <button
              className="btn-ide-link"
              onClick={handleToggleWrenchDropdown}
              title="Developer Configuration Tools"
              aria-label="Developer Configuration Tools"
              style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
            >
              <WrenchIcon size={18} />
              <span style={{ fontSize: '10px' }}>▼</span>
            </button>

            {wrenchDropdownOpen && (
              <div
                className="status-dropdown-menu"
                style={{
                  position: 'absolute',
                  right: 0,
                  top: 'calc(100% + 6px)',
                  background: '#ffffff',
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
                  padding: '6px 0',
                  minWidth: '220px',
                  zIndex: 100
                }}
              >
                <div
                  onClick={handleOpenIdeFromMenu}
                  style={{
                    padding: '10px 14px',
                    fontSize: '13px',
                    color: '#1e293b',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontWeight: 500
                  }}
                >
                  <span>📝</span>
                  <span>Edit index.md in Looker IDE</span>
                </div>

                <div
                  onClick={handleValidateDevIndexFromMenu}
                  style={{
                    padding: '10px 14px',
                    fontSize: '13px',
                    color: '#1e293b',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontWeight: 500,
                    borderTop: '1px solid #f1f5f9'
                  }}
                >
                  <span>🧪</span>
                  <span>Validate Dev index.md</span>
                </div>
              </div>
            )}
          </div>

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
          <nav className="workflow-nav-bar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '15px' }}>
              <button
                onClick={() => navigateTo('/')}
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
              {activeSubRoute ? (
                <button
                  onClick={() => navigateTo(`/${activeWorkflow.id}`)}
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
                  {activeWorkflow.label}
                </button>
              ) : (
                <span style={{ fontWeight: '600', color: '#1a202c' }}>{activeWorkflow.label}</span>
              )}
              {activeSubRoute && (
                <>
                  <span style={{ color: 'var(--text-muted)' }}>/</span>
                  <span style={{ fontWeight: '600', color: '#1a202c' }}>{activeSubRoute}</span>
                </>
              )}
            </div>

            {/* Right-aligned Policy Badges */}
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
              {activeWorkflow.parameters?.user_id_limitation?.enabled && (
                <span style={{ background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 500 }}>
                  🔒 User ID Enforced ({activeWorkflow.parameters.user_id_limitation.mode || 'own'})
                </span>
              )}
              {(() => {
                const rawCfg = (activeWorkflow.parameters?.explores || []).find((e: any) => e.name === activeSubRoute);
                if (!rawCfg) return null;
                const expCfg = normalizeExploreConfig(rawCfg, activeSubRoute || undefined);
                return (
                  <>
                    {expCfg.required_filter_fields && expCfg.required_filter_fields.length > 0 && (
                      <span style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 500 }}>
                        📅 Filter: {expCfg.required_filter_fields[0]}
                      </span>
                    )}
                    {expCfg.max_row_limit && (
                      <span style={{ background: '#e0f2fe', color: '#075985', border: '1px solid #bae6fd', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 500 }}>
                        ⚡ Limit: {expCfg.max_row_limit}
                      </span>
                    )}
                  </>
                );
              })()}
            </div>
          </nav>

          {/* Full Page Workflow Component Container */}
          <div className="page-workflow-container">
            <ErrorBoundary>
              <WorkflowLoader
                key={activeWorkflow.id}
                workflow={activeWorkflow}
                subRoute={activeSubRoute}
                coreSDK={coreSDK}
                extensionSDK={extensionSDK}
                addLog={addLog}
                callWorkflowBackend={callWorkflowBackend}
                onNavigateSubRoute={(subPath) => navigateTo(`/${activeWorkflow.id}/${subPath}`)}
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
              indexParseError ? (
                <div className="card" style={{ padding: '28px 24px', borderLeft: '4px solid #ea4335', background: '#ffffff' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                    <span style={{ fontSize: '24px' }}>⚠️</span>
                    <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '600', color: '#ea4335' }}>
                      Invalid Production index.md Configuration
                    </h3>
                  </div>
                  <p style={{ margin: '0 0 12px 0', color: '#374151', fontSize: '14px', lineHeight: '1.5' }}>
                    The production configuration file <code>index.md</code> in Looker project <code>nano_admin</code> was found, but could not be parsed due to a YAML syntax error.
                  </p>
                  <div style={{
                    background: '#1f2937',
                    color: '#f9fafb',
                    padding: '12px 16px',
                    borderRadius: '6px',
                    fontFamily: 'monospace',
                    fontSize: '12px',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    marginBottom: '16px'
                  }}>
                    {indexParseError}
                  </div>
                  <button
                    className="btn btn-primary"
                    onClick={handleOpenIdeConfig}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', alignSelf: 'flex-start' }}
                  >
                    <WrenchIcon size={16} color="#ffffff" />
                    <span>Fix index.md in Looker IDE →</span>
                  </button>
                </div>
              ) : (
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
              )
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
                        onClick={() => navigateTo(`/${workflow.id}`)}
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

      {/* Dev Workspace Validation Result Modal */}
      {showValidationModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(15, 23, 42, 0.6)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000,
          padding: '20px'
        }}>
          <div style={{
            background: 'white',
            borderRadius: '12px',
            width: '100%',
            maxWidth: '560px',
            boxShadow: '0 20px 25px -5px rgba(0,0,0,0.2)',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column'
          }}>
            <div style={{
              background: '#0f172a',
              color: 'white',
              padding: '16px 20px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>
                🧪 Development index.md Validation
              </h3>
              <button
                onClick={handleCloseValidationModal}
                style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '18px', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {validatingDev ? (
                <div style={{ padding: '32px 0', textAlign: 'center', color: '#64748b' }}>
                  <div className="spinner" style={{ margin: '0 auto 12px auto' }}></div>
                  <p style={{ margin: 0, fontSize: '14px' }}>
                    Fetching and validating development version of <code>index.md</code> from Looker dev workspace...
                  </p>
                </div>
              ) : devValidationResult ? (
                devValidationResult.valid ? (
                  <div>
                    <div style={{
                      background: '#f0fdf4',
                      border: '1px solid #bbf7d0',
                      color: '#15803d',
                      padding: '14px 16px',
                      borderRadius: '8px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      marginBottom: '16px'
                    }}>
                      <span style={{ fontSize: '20px' }}>🎉</span>
                      <div>
                        <strong style={{ display: 'block', fontSize: '14px' }}>Development index.md is Valid!</strong>
                        <span style={{ fontSize: '12px' }}>
                          Parsed {devValidationResult.workflows_count || 0} workflow definition(s) successfully without syntax or schema errors.
                        </span>
                      </div>
                    </div>

                    <h4 style={{ margin: '0 0 8px 0', fontSize: '13px', fontWeight: 600, color: '#334155' }}>
                      Parsed Workflows Summary
                    </h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '200px', overflowY: 'auto' }}>
                      {(devValidationResult.workflows || []).map((wf: any, idx: number) => (
                        <div key={idx} style={{
                          background: '#f8fafc',
                          border: '1px solid #e2e8f0',
                          padding: '10px 12px',
                          borderRadius: '6px',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center'
                        }}>
                          <div>
                            <strong style={{ fontSize: '13px', color: '#0f172a' }}>{wf.label}</strong>
                            <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>
                              ID: <code>{wf.id}</code> | Template: <code>{wf.template}</code>
                            </span>
                          </div>
                          <span style={{ fontSize: '11px', background: '#e0f2fe', color: '#0369a1', padding: '2px 8px', borderRadius: '12px' }}>
                            {wf.mount_type || 'card'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div>
                    <div style={{
                      background: '#fef2f2',
                      border: '1px solid #fecaca',
                      color: '#b91c1c',
                      padding: '14px 16px',
                      borderRadius: '8px',
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '10px',
                      marginBottom: '14px'
                    }}>
                      <span style={{ fontSize: '20px' }}>❌</span>
                      <div>
                        <strong style={{ display: 'block', fontSize: '14px' }}>Validation Failed</strong>
                        <span style={{ fontSize: '12px' }}>{devValidationResult.message}</span>
                      </div>
                    </div>

                    {devValidationResult.details && (
                      <div style={{
                        background: '#1f2937',
                        color: '#f9fafb',
                        padding: '12px 14px',
                        borderRadius: '6px',
                        fontFamily: 'monospace',
                        fontSize: '12px',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word'
                      }}>
                        {devValidationResult.details}
                      </div>
                    )}
                  </div>
                )
              ) : null}
            </div>

            <div style={{
              background: '#f8fafc',
              borderTop: '1px solid #e2e8f0',
              padding: '12px 20px',
              display: 'flex',
              justifyContent: 'flex-end'
            }}>
              <button
                className="btn"
                onClick={handleCloseValidationModal}
                style={{
                  background: '#334155',
                  color: 'white',
                  border: 'none',
                  padding: '6px 16px',
                  borderRadius: '6px',
                  fontSize: '13px',
                  cursor: 'pointer'
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  // 4. Hoisted Function Definitions
  function normalizeExploreConfig(rawConfig: any, exploreName?: string): any {
    if (!rawConfig) return { name: exploreName || '' };
    const name = rawConfig.name || exploreName || '';
    let required_filter_fields: string[] = [];

    if (Array.isArray(rawConfig.required_filter_fields) && rawConfig.required_filter_fields.length > 0) {
      required_filter_fields = rawConfig.required_filter_fields;
    } else if (Array.isArray(rawConfig.required_date_filter_fields) && rawConfig.required_date_filter_fields.length > 0) {
      required_filter_fields = rawConfig.required_date_filter_fields;
    } else if (typeof rawConfig.required_date_filter_field === 'string' && rawConfig.required_date_filter_field.trim()) {
      required_filter_fields = [rawConfig.required_date_filter_field.trim()];
    } else if (rawConfig.require_date_filter) {
      required_filter_fields = [`${name || 'history'}.created_time`];
    }

    return {
      ...rawConfig,
      name,
      required_filter_fields
    };
  }
  function handleInitialize() {
    fetchUserAndWorkflows();
  }

  function resolveCurrentRoute(): { workflowId: string | null; subRoute: string | null } {
    const rawRoute = (extensionSDK as any)?.lookerHostData?.route || (extensionSDK as any)?.route || '/';
    return parseWorkflowRoute(rawRoute);
  }

  function handleHistorySync() {
    if (workflows.length > 0) {
      const { workflowId, subRoute } = resolveCurrentRoute();
      if (workflowId) {
        const matchingWf = workflows.find(w => w.id === workflowId);
        if (matchingWf) {
          setActiveWorkflowId(matchingWf.id);
          setActiveSubRoute(subRoute || null);
        }
      }
    }
  }

  function handleToggleDropdown() {
    setDropdownOpen(prev => !prev);
  }

  function handleToggleWrenchDropdown() {
    setWrenchDropdownOpen(prev => !prev);
  }

  function handleOpenIdeFromMenu() {
    setWrenchDropdownOpen(false);
    handleOpenIdeConfig();
  }

  function handleValidateDevIndexFromMenu() {
    setWrenchDropdownOpen(false);
    setShowValidationModal(true);
    runDevValidation();
  }

  function handleCloseValidationModal() {
    setShowValidationModal(false);
  }

  async function runDevValidation() {
    setValidatingDev(true);
    setDevValidationResult(null);
    try {
      addLog('Fetching index.md from Looker Extension SDK for invoking user...');
      let indexContent = '';
      try {
        const rawContent = await coreSDK.ok(
          coreSDK.get('/projects/nano_admin/file/content', { file_path: 'index.md' }) as any
        );
        indexContent = typeof rawContent === 'string' ? rawContent : ((rawContent as any)?.value || JSON.stringify(rawContent));
      } catch (sdkErr: any) {
        addLog(`Notice: Extension SDK file content fetch returned: ${sdkErr.message || String(sdkErr)}`);
      }

      addLog('Initiating development index.md validation check via backend...');
      const data = await callBackendAction('validate_dev_index', { index_content: indexContent });
      setDevValidationResult(data);
      addLog(`Dev validation completed: ${data?.valid ? 'Valid' : 'Invalid'}`);
    } catch (err: any) {
      console.error('Dev validation failed:', err);
      setDevValidationResult({
        valid: false,
        message: 'Backend call failed during development validation.',
        details: err.message || String(err)
      });
    } finally {
      setValidatingDev(false);
    }
  }

  async function callBackendAction(action: string, payload?: any) {
    addLog(`Initiating backend call for action '${action}'...`);
    setGcfStatus('checking');
    try {
      const requestPayload = {
        action,
        ...payload
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
        addLog(`Challenge required or expired. Retrying backend action '${action}'...`);
        const errData = response.body;
        checkBuildHash(errData);
        await new Promise((resolve) => setTimeout(resolve, 300));
        response = await extensionSDK.serverProxy(BACKEND_URL, {
          method: 'POST',
          headers,
          body: JSON.stringify(requestPayload)
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
      addLog(`Backend responded successfully for action '${action}'.`);
      return data;
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

  function navigateTo(targetPath: string = '/') {
    const { workflowId, subRoute } = parseWorkflowRoute(targetPath);
    if (extensionSDK?.clientRouteChanged) {
      const sdkPath = workflowId
        ? (subRoute ? `/${workflowId}/${subRoute}` : `/${workflowId}`)
        : '/';
      extensionSDK.clientRouteChanged(sdkPath);
    }
    setActiveWorkflowId(workflowId);
    setActiveSubRoute(subRoute);
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
    return 'page';
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
        await new Promise((resolve) => setTimeout(resolve, 300));
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
      if (data.parse_error) {
        setIndexParseError(data.parse_error);
      } else {
        setIndexParseError(null);
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
        await new Promise((resolve) => setTimeout(resolve, 300));
        response = await extensionSDK.serverProxy(BACKEND_URL, {
          method: 'POST',
          headers,
          body: JSON.stringify(requestPayload)
        });
      }

      if (!response.ok) {
        const errData = typeof response.body === 'object' ? response.body : {};
        const message = errData?.error || errData?.message || `HTTP Error: ${response.status}`;
        const err = new Error(message);
        (err as any).status = response.status;
        (err as any).details = errData;
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

export function parseWorkflowRoute(rawRoute: string): { workflowId: string | null; subRoute: string | null } {
  if (!rawRoute || typeof rawRoute !== 'string') {
    return { workflowId: null, subRoute: null };
  }

  const cleanRoute = rawRoute
    .split('?')[0]
    .split('#')[0]
    .replace(/^https?:\/\/[^\/]+/, '')
    .replace(/^\/?/, '')
    .replace(/^extensions\/[^\/]+\/?/, '')
    .trim();

  if (!cleanRoute) {
    return { workflowId: null, subRoute: null };
  }

  const parts = cleanRoute.split('/').filter(Boolean);
  if (parts.length === 0) {
    return { workflowId: null, subRoute: null };
  }

  return {
    workflowId: parts[0],
    subRoute: parts.length > 1 ? parts.slice(1).join('/') : null
  };
}

export default App;
