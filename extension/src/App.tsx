import React, { useEffect, useState } from 'react';
import { LookerExtensionSDK } from '@looker/extension-sdk';
import './App.css';
import { BUILD_HASH } from './build_hash';

interface AppProps {
  extensionSDK: any;
}

export const App: React.FC<AppProps> = ({ extensionSDK }) => {
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState<string[]>([]);
  const [gcfStatus, setGcfStatus] = useState<'idle' | 'checking' | 'connected' | 'error'>('idle');
  const [gcfResponse, setGcfResponse] = useState<string>('');
  const [adminPages, setAdminPages] = useState<any[]>([]);
  const [hashMismatch, setHashMismatch] = useState<boolean>(false);
  const [backendHash, setBackendHash] = useState<string>('');

  const checkBuildHash = (data: any) => {
    if (data && data.build_hash) {
      setBackendHash(data.build_hash);
      if (data.build_hash !== BUILD_HASH) {
        setHashMismatch(true);
      } else {
        setHashMismatch(false);
      }
    }
  };

  const coreSDK = LookerExtensionSDK.create40Client(extensionSDK);

  const addLog = (message: string) => {
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`]);
  };

  useEffect(() => {
    async function fetchUserAndPages() {
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

      addLog('Initiating secure backend call to fetch registered admin pages...');
      setGcfStatus('checking');
      try {
        const payload = {
          action: 'get_admin_pages',
          user: userId ? {
            id: userId,
            email: meInfo?.email,
            name: meInfo?.display_name
          } : undefined
        };
        const headers = {
          'Content-Type': 'application/json',
          'X-Nano-Admin-Challenge': extensionSDK.createSecretKeyTag('nano_admin_challenge')
        };
        
        let response = await extensionSDK.serverProxy('http://localhost:8081', {
          method: 'POST',
          headers,
          body: JSON.stringify(payload)
        });

        if (response.status === 401) {
          addLog('Challenge required or expired. Retrying admin pages fetch...');
          const errData = response.body;
          checkBuildHash(errData);
          response = await extensionSDK.serverProxy('http://localhost:8081', {
            method: 'POST',
            headers,
            body: JSON.stringify(payload)
          });
        }

        if (!response.ok) {
          throw new Error(`HTTP Error: ${response.status}`);
        }

        const data = response.body;
        setGcfStatus('connected');
        checkBuildHash(data);
        if (data.pages) {
          setAdminPages(data.pages);
        }
        addLog(`Backend responded successfully: Loaded ${data.pages?.length || 0} admin pages.`);
      } catch (error) {
        console.error(error);
        setGcfStatus('error');
        addLog(`Backend connection failed: ${String(error)}`);
      } finally {
        setLoading(false);
      }
    }

    fetchUserAndPages();
  }, [extensionSDK]);

  const callCloudFunction = async (action: string) => {
    addLog(`Initiating backend call for action: '${action}'...`);
    setGcfStatus('checking');
    try {
      const payload = {
        action,
        user: {
          id: currentUser?.id,
          email: currentUser?.email,
          name: currentUser?.display_name
        }
      };
      const headers = {
        'Content-Type': 'application/json',
        'X-Nano-Admin-Challenge': extensionSDK.createSecretKeyTag('nano_admin_challenge')
      };

      let response = await extensionSDK.serverProxy('http://localhost:8081', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });

      if (response.status === 401) {
        addLog('Challenge required or expired. Retrying action request...');
        const errData = response.body;
        checkBuildHash(errData);
        response = await extensionSDK.serverProxy('http://localhost:8081', {
          method: 'POST',
          headers,
          body: JSON.stringify(payload)
        });
      }

      if (!response.ok) {
        if (response.status === 403) {
          const errData = response.body;
          throw new Error(errData.error || 'Forbidden');
        }
        throw new Error(`HTTP Error: ${response.status}`);
      }

      const data = response.body;
      setGcfStatus('connected');
      checkBuildHash(data);
      setGcfResponse(JSON.stringify(data, null, 2));
      addLog(`Backend responded successfully: ${data.message || 'Success'}`);
    } catch (error) {
      console.error(error);
      setGcfStatus('error');
      addLog(`Backend connection failed: ${String(error)}`);
    }
  };

  if (loading) {
    return (
      <div className="loading-container">
        <div className="spinner"></div>
        <p>Initializing Control Center...</p>
      </div>
    );
  }

  const firstName = currentUser?.first_name || currentUser?.display_name?.split(' ')[0] || 'Admin';

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="header-info">
          <h1>Looker Nano-Admin Control Center</h1>
          <p className="subtitle">Secure administrative tooling powered by Google Cloud Functions.</p>
        </div>
        <div className="user-badge">
          {currentUser && (
            <span>
              <span className="user-dot"></span>
              {currentUser.display_name} ({currentUser.email})
            </span>
          )}
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
            The local Extension bundle build hash (<code>{BUILD_HASH.substring(0, 8)}</code>) does not match the deployed Cloud Function build hash (<code>{backendHash ? backendHash.substring(0, 8) : 'unknown'}</code>).
          </span>
          <span style={{ fontSize: '12px', marginTop: '4px', opacity: 0.8 }}>
            Please deploy the backend Cloud Function (<code>npm run backend:deploy</code>) or rebuild the extension bundle (<code>npm run extension:build</code>) to sync them.
          </span>
        </div>
      )}

      {/* Hello Firstname Landing Area */}
      <section className="welcome-banner" style={{
        background: 'rgba(90, 97, 251, 0.05)',
        border: '1px solid rgba(90, 97, 251, 0.1)',
        borderRadius: '12px',
        padding: '24px',
        marginBottom: '32px'
      }}>
        <h2 style={{ margin: '0 0 8px 0', fontSize: '24px', fontWeight: '600' }}>Hello, {firstName}! 👋</h2>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '15px' }}>
          Welcome to your administration landing page. Below is the active routing layout read from your LookML configuration.
        </p>
      </section>

      <main className="dashboard-grid">
        <section className="card card-status">
          <h3>System Overview</h3>
          <div className="status-row">
            <span>Looker SDK Integration</span>
            <span className="badge badge-success">Connected</span>
          </div>
          <div className="status-row">
            <span>GCF Backend Status</span>
            {gcfStatus === 'idle' && <span className="badge badge-neutral">Idle</span>}
            {gcfStatus === 'checking' && <span className="badge badge-neutral pulse">Checking...</span>}
            {gcfStatus === 'connected' && <span className="badge badge-success">Online</span>}
            {gcfStatus === 'error' && <span className="badge badge-error">Offline / Error</span>}
          </div>
        </section>

        {/* Dynamic Admin Pages from YAML config */}
        {adminPages.map((page, idx) => {
          const isAuthorized = page.authorized !== false;
          return (
            <section
              key={idx}
              className={`card ${!isAuthorized ? 'card-disabled' : ''}`}
              style={!isAuthorized ? { opacity: 0.6, cursor: 'not-allowed' } : undefined}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <h3 style={{ margin: 0 }}>{page.label}</h3>
                {isAuthorized ? (
                  <span className="badge badge-success" style={{ fontSize: '10px' }}>Authorized</span>
                ) : (
                  <span className="badge badge-error" style={{ fontSize: '10px' }}>Access Denied</span>
                )}
              </div>
              <p className="card-description">
                Securely execute actions mapped to route <code>{page.route}</code> via Google Cloud Functions.
              </p>
              {page.route === '/user-audit' ? (
                <button
                  className="btn btn-primary"
                  onClick={() => callCloudFunction('audit_users')}
                  disabled={!isAuthorized}
                  style={!isAuthorized ? { cursor: 'not-allowed' } : undefined}
                >
                  Run User Audit
                </button>
              ) : page.route === '/cache-purge' ? (
                <button
                  className="btn btn-danger"
                  onClick={() => callCloudFunction('purge_cache')}
                  disabled={!isAuthorized}
                  style={!isAuthorized ? { cursor: 'not-allowed' } : undefined}
                >
                  Purge All Caches
                </button>
              ) : (
                <button
                  className="btn btn-primary"
                  onClick={() => callCloudFunction(`custom_action:${page.route}`)}
                  disabled={!isAuthorized}
                  style={!isAuthorized ? { cursor: 'not-allowed' } : undefined}
                >
                  Execute Custom Route
                </button>
              )}
            </section>
          );
        })}

        {adminPages.length === 0 && (
          <section className="card" style={{ gridColumn: 'span 2' }}>
            <h3>No Admin Pages Loaded</h3>
            <p className="card-description">
              Could not retrieve dynamic admin pages from <code>index.md</code> in the <code>nano_admin</code> project. Falling back to default tools or waiting for backend connection...
            </p>
          </section>
        )}
      </main>

      <section className="terminal-section">
        <h3>Execution Terminal & Log Viewer</h3>
        <div className="terminal-body">
          {logs.map((log, index) => (
            <div key={index} className="log-line">{log}</div>
          ))}
        </div>
      </section>

      {gcfResponse && (
        <section className="response-section">
          <h3>Latest GCF Response Data</h3>
          <pre className="json-container">{gcfResponse}</pre>
        </section>
      )}
    </div>
  );
};
