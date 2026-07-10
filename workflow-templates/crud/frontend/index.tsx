import React, { useState } from 'react';

export interface WorkflowComponentProps {
  workflowId: string;
  label: string;
  parameters: {
    target_object: string;
    supported_operations: Array<{
      name: string;
      fields?: string[];
      values?: Record<string, any>;
    }>;
  };
  coreSDK: any;
  extensionSDK: any;
  addLog: (msg: string) => void;
  callBackend: (action: string, payload?: any) => Promise<any>;
}

const CRUDWorkflow: React.FC<WorkflowComponentProps> = ({
  workflowId,
  label,
  parameters,
  addLog,
  callBackend
}) => {
  const [response, setResponse] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [selectedOperation, setSelectedOperation] = useState<string>(
    parameters.supported_operations?.[0]?.name || ''
  );

  const handleExecute = async () => {
    setLoading(true);
    addLog(`Executing operation "${selectedOperation}" on target "${parameters.target_object}" for workflow "${workflowId}"...`);
    try {
      const result = await callBackend(selectedOperation, {
        target: parameters.target_object,
        fields: parameters.supported_operations.find(o => o.name === selectedOperation)?.fields || []
      });
      setResponse(JSON.stringify(result, null, 2));
      addLog(`Operation "${selectedOperation}" completed successfully.`);
    } catch (err: any) {
      console.error(err);
      setResponse(`Error: ${err.message || String(err)}`);
      addLog(`Operation "${selectedOperation}" failed: ${err.message || String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div>
        <h4 style={{ margin: '0 0 4px 0' }}>Instance: {label}</h4>
        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
          Template: <code>crud</code> | Target: <strong>{parameters.target_object}</strong>
        </span>
      </div>

      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <label htmlFor="operation-select" style={{ fontSize: '14px', fontWeight: '500' }}>Select Operation:</label>
        <select
          id="operation-select"
          value={selectedOperation}
          onChange={(e) => setSelectedOperation(e.target.value)}
          style={{
            padding: '6px 12px',
            borderRadius: '4px',
            border: '1px solid rgba(0,0,0,0.15)',
            background: 'white',
            cursor: 'pointer'
          }}
        >
          {parameters.supported_operations?.map((op) => (
            <option key={op.name} value={op.name}>
              {op.name.toUpperCase()} (fields: {op.fields?.join(', ') || '*'})
            </option>
          ))}
        </select>

        <button
          className="btn btn-primary"
          onClick={handleExecute}
          disabled={loading || !selectedOperation}
          style={{ margin: 0 }}
        >
          {loading ? 'Executing...' : 'Run Operation'}
        </button>
      </div>

      {response && (
        <div style={{ marginTop: '8px' }}>
          <span style={{ fontSize: '12px', fontWeight: 'bold' }}>Template Execution Result:</span>
          <pre style={{
            background: '#f5f5f5',
            padding: '12px',
            borderRadius: '6px',
            overflow: 'auto',
            maxHeight: '200px',
            fontSize: '12px',
            border: '1px solid #e0e0e0',
            marginTop: '4px'
          }}>
            {response}
          </pre>
        </div>
      )}
    </div>
  );
};

export default CRUDWorkflow;
