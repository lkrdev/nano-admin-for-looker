import React, { useState } from 'react';

export interface WorkflowComponentProps {
  workflowId: string;
  label: string;
  parameters: {
    min_runtime_seconds?: number;
  };
  coreSDK: any;
  extensionSDK: any;
  addLog: (msg: string) => void;
  callBackend: (action: string, payload?: any) => Promise<any>;
}

const KillQueriesWorkflow: React.FC<WorkflowComponentProps> = ({
  workflowId,
  label,
  parameters,
  addLog,
  callBackend
}) => {
  // 1. Hook Declarations (State & Memos)
  const [loading, setLoading] = useState<boolean>(false);
  const [resultMessage, setResultMessage] = useState<string>('');

  const threshold = Number(parameters?.min_runtime_seconds || 600);

  // 2. Returned Component JSX
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)' }}>
        Scans and terminates active Looker queries running longer than <strong>{threshold}s</strong>.
      </p>

      <button
        className="btn btn-danger"
        onClick={handleKillQueries}
        disabled={loading}
        style={{ alignSelf: 'flex-start' }}
      >
        {loading ? 'Scanning & Terminating...' : `Kill Queries (> ${threshold}s)`}
      </button>

      {resultMessage && (
        <div style={{
          fontSize: '13px',
          padding: '10px 12px',
          borderRadius: '6px',
          background: 'rgba(90, 97, 251, 0.06)',
          border: '1px solid rgba(90, 97, 251, 0.15)',
          color: 'var(--text-main)',
          lineHeight: '1.4'
        }}>
          {resultMessage}
        </div>
      )}
    </div>
  );

  // 3. Hoisted Function Definitions
  async function handleKillQueries() {
    setLoading(true);
    setResultMessage('');
    addLog(`Initiating long-running query scan (> ${threshold}s)...`);
    try {
      const res = await callBackend('kill_long_running');
      setResultMessage(res.message);
      addLog(res.message);
    } catch (err: any) {
      const errMsg = `Error: ${err.message || String(err)}`;
      setResultMessage(errMsg);
      addLog(`Failed to terminate queries: ${err.message || String(err)}`);
    } finally {
      setLoading(false);
    }
  }
};

export default KillQueriesWorkflow;
