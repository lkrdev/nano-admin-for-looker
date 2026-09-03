import React, { useEffect, useMemo, useState } from 'react';

export interface WorkflowComponentProps {
  workflowId: string;
  label: string;
  parameters: any;
  coreSDK: any;
  extensionSDK: any;
  addLog: (msg: string) => void;
  callBackend: (action: string, payload?: any) => Promise<any>;
}

export const LimitedSystemActivityWorkflow: React.FC<WorkflowComponentProps> = ({
  workflowId,
  label,
  parameters,
  addLog,
  callBackend
}) => {
  // 1. Hook Declarations (State & Memos)
  const [explores, setExplores] = useState<any[]>([]);
  const [selectedExploreName, setSelectedExploreName] = useState<string>('');
  const [fields, setFields] = useState<{ dimensions: any[]; measures: any[] }>({ dimensions: [], measures: [] });
  const [selectedFields, setSelectedFields] = useState<string[]>([]);
  const [filters, setFilters] = useState<Array<{ id: string; field: string; value: string }>>([]);
  const [rowLimit, setRowLimit] = useState<number>(100);

  // Full-Width Field Selection Modal State
  const [showFieldPickerModal, setShowFieldPickerModal] = useState<boolean>(false);
  const [modalSearchTerm, setModalSearchTerm] = useState<string>('');
  const [modalCategoryFilter, setModalCategoryFilter] = useState<'all' | 'dimensions' | 'measures'>('all');

  const [loadingExplores, setLoadingExplores] = useState<boolean>(true);
  const [loadingFields, setLoadingFields] = useState<boolean>(false);
  const [runningQuery, setRunningQuery] = useState<boolean>(false);
  const [exportingCsv, setExportingCsv] = useState<boolean>(false);

  const [queryResults, setQueryResults] = useState<any[] | null>(null);
  const [queryMeta, setQueryMeta] = useState<{ rowCount: number; limitApplied: number } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const activeExplore = useMemo(() => {
    return explores.find(e => e.name === selectedExploreName);
  }, [explores, selectedExploreName]);

  const allAvailableFields = useMemo(() => {
    return [...(fields.dimensions || []), ...(fields.measures || [])];
  }, [fields]);

  const fieldsMap = useMemo(() => {
    const map = new Map<string, any>();
    allAvailableFields.forEach(f => map.set(f.name, f));
    return map;
  }, [allAvailableFields]);

  const filteredModalFields = useMemo(() => {
    let pool = allAvailableFields;
    if (modalCategoryFilter === 'dimensions') {
      pool = fields.dimensions;
    } else if (modalCategoryFilter === 'measures') {
      pool = fields.measures;
    }

    if (!modalSearchTerm.trim()) return pool;

    const term = modalSearchTerm.toLowerCase();
    return pool.filter(f =>
      f.name.toLowerCase().includes(term) ||
      f.label.toLowerCase().includes(term) ||
      (f.group_label && f.group_label.toLowerCase().includes(term))
    );
  }, [allAvailableFields, fields, modalCategoryFilter, modalSearchTerm]);

  const userIdLimitation = parameters?.user_id_limitation;

  // 2. Effects
  useEffect(handleInitExplores, []);
  useEffect(handleExploreChangeEffect, [selectedExploreName]);

  // 3. Returned Component JSX
  if (loadingExplores) {
    return (
      <div style={{ padding: '48px 24px', textAlign: 'center', color: '#64748b', fontFamily: 'Inter, system-ui, sans-serif' }}>
        <div className="spinner" style={{ margin: '0 auto 16px auto' }}></div>
        <p style={{ margin: 0, fontSize: '14px', fontWeight: 500 }}>Loading available System Activity explores...</p>
      </div>
    );
  }

  if (explores.length === 0) {
    return (
      <div className="card" style={{
        padding: '48px 24px',
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        background: 'white',
        borderRadius: '12px',
        border: '1px solid #e2e8f0',
        boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
        fontFamily: 'Inter, system-ui, sans-serif'
      }}>
        <div style={{ fontSize: '40px', marginBottom: '12px' }}>📊</div>
        <h3 style={{ margin: '0 0 8px 0', fontSize: '18px', fontWeight: '600', color: '#0f172a' }}>
          No Explores Available
        </h3>
        <p style={{ margin: 0, maxWidth: '480px', color: '#64748b', fontSize: '14px', lineHeight: '1.5' }}>
          No explores match the configured allowlist for this workflow or user permissions. Please check the <code>explores</code> configuration in <code>index.md</code>.
        </p>
      </div>
    );
  }

  // Pre-explore selection card grid (View A)
  if (!selectedExploreName) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', fontFamily: 'Inter, system-ui, sans-serif' }}>
        <div style={{
          background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
          color: 'white',
          padding: '24px',
          borderRadius: '12px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
        }}>
          <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 600 }}>{label}</h2>
          <p style={{ margin: '6px 0 0 0', fontSize: '14px', color: '#94a3b8' }}>
            Select an authorized System Activity explore to launch the query builder.
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '16px' }}>
          {explores.map(exp => (
            <div
              key={exp.name}
              style={{
                background: 'white',
                border: '1px solid #e2e8f0',
                borderRadius: '12px',
                padding: '20px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                gap: '16px',
                transition: 'all 0.2s ease'
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    background: '#f1f5f9',
                    color: '#475569',
                    padding: '2px 8px',
                    borderRadius: '4px'
                  }}>
                    system__activity
                  </span>
                  <span style={{ fontSize: '12px', color: '#94a3b8' }}>{exp.name}</span>
                </div>

                <h3 style={{ margin: '0 0 6px 0', fontSize: '17px', fontWeight: 600, color: '#0f172a' }}>
                  {exp.label}
                </h3>
                <p style={{ margin: 0, fontSize: '13px', color: '#64748b', lineHeight: '1.4' }}>
                  {exp.description || `Explore system activity records for ${exp.name}.`}
                </p>

                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '12px' }}>
                  {exp.require_date_filter && (
                    <span style={{ fontSize: '11px', background: '#fef3c7', color: '#92400e', padding: '2px 8px', borderRadius: '12px', fontWeight: 500 }}>
                      📅 Required Date Filter
                    </span>
                  )}
                  {exp.allow_csv_export && (
                    <span style={{ fontSize: '11px', background: '#dcfce7', color: '#166534', padding: '2px 8px', borderRadius: '12px', fontWeight: 500 }}>
                      📥 CSV Export
                    </span>
                  )}
                  {exp.max_row_limit && (
                    <span style={{ fontSize: '11px', background: '#e0f2fe', color: '#075985', padding: '2px 8px', borderRadius: '12px', fontWeight: 500 }}>
                      ⚡ Max Limit: {exp.max_row_limit}
                    </span>
                  )}
                </div>
              </div>

              <button
                onClick={() => handlePickExplore(exp.name)}
                style={{
                  background: '#2563eb',
                  color: 'white',
                  border: 'none',
                  padding: '10px 16px',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  width: '100%',
                  textAlign: 'center'
                }}
              >
                Select Explore →
              </button>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Query Workspace (View B)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', fontFamily: 'Inter, system-ui, sans-serif' }}>
      {/* Header Banner */}
      <div style={{
        background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
        color: 'white',
        padding: '20px 24px',
        borderRadius: '12px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '16px'
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 600 }}>{activeExplore?.label || selectedExploreName}</h2>
            <span style={{ fontSize: '12px', color: '#94a3b8', background: 'rgba(255,255,255,0.1)', padding: '2px 8px', borderRadius: '4px' }}>
              system__activity / {selectedExploreName}
            </span>
          </div>
          <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#94a3b8' }}>
            {activeExplore?.description || 'System Activity Query Builder'}
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {userIdLimitation?.enabled && (
              <span style={{
                background: 'rgba(59, 130, 246, 0.2)',
                border: '1px solid rgba(59, 130, 246, 0.4)',
                color: '#60a5fa',
                padding: '4px 10px',
                borderRadius: '16px',
                fontSize: '12px',
                fontWeight: 500
              }}>
                🔒 User ID Filter Enforced ({userIdLimitation.mode || 'own'})
              </span>
            )}
            {activeExplore?.require_date_filter && (
              <span style={{
                background: 'rgba(245, 158, 11, 0.2)',
                border: '1px solid rgba(245, 158, 11, 0.4)',
                color: '#fbbf24',
                padding: '4px 10px',
                borderRadius: '16px',
                fontSize: '12px',
                fontWeight: 500
              }}>
                📅 Required Date Filter
              </span>
            )}
            {activeExplore?.max_row_limit && (
              <span style={{
                background: 'rgba(16, 185, 129, 0.2)',
                border: '1px solid rgba(16, 185, 129, 0.4)',
                color: '#34d399',
                padding: '4px 10px',
                borderRadius: '16px',
                fontSize: '12px',
                fontWeight: 500
              }}>
                ⚡ Max Row Limit: {activeExplore.max_row_limit}
              </span>
            )}
          </div>

          <button
            onClick={handleChangeExplore}
            style={{
              background: 'rgba(255,255,255,0.15)',
              color: 'white',
              border: '1px solid rgba(255,255,255,0.25)',
              padding: '6px 14px',
              borderRadius: '6px',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            Change Explore 🔄
          </button>
        </div>
      </div>

      {/* Transparent Error Banner */}
      {errorMsg && (
        <div style={{
          background: '#fef2f2',
          border: '1px solid #fecaca',
          color: '#dc2626',
          padding: '14px 18px',
          borderRadius: '8px',
          fontSize: '14px',
          lineHeight: '1.5',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: '12px',
          boxShadow: '0 2px 6px rgba(220, 38, 38, 0.08)'
        }}>
          <div>
            <strong style={{ display: 'block', marginBottom: '2px', fontWeight: 600 }}>Backend Error</strong>
            <span>⚠️ {errorMsg}</span>
          </div>
          <button
            onClick={handleClearError}
            style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontWeight: 'bold', fontSize: '16px' }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Selected Fields Summary Bar & Full-Width Field Picker Button */}
      <div style={{
        background: 'white',
        border: '1px solid #e2e8f0',
        borderRadius: '12px',
        padding: '18px 20px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: '#0f172a' }}>
              Selected Query Fields ({selectedFields.length})
            </h3>
            <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: '#64748b' }}>
              Click "Edit Fields" to open the full-width disambiguated field selector.
            </p>
          </div>

          <button
            onClick={handleOpenFieldPickerModal}
            style={{
              background: '#2563eb',
              color: 'white',
              border: 'none',
              padding: '8px 16px',
              borderRadius: '6px',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            ✏️ Edit Fields ({selectedFields.length} selected)
          </button>
        </div>

        {/* Selected Field Badges */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', minHeight: '32px', alignItems: 'center' }}>
          {selectedFields.length === 0 ? (
            <span style={{ fontSize: '13px', color: '#94a3b8', fontStyle: 'italic' }}>
              No fields selected. Click "Edit Fields" above to choose fields for your query.
            </span>
          ) : (
            selectedFields.map(fieldName => {
              const fieldObj = fieldsMap.get(fieldName);
              const viewGroupLabel = fieldObj?.group_label || activeExplore?.label || 'Field';
              const labelShort = fieldObj?.label || fieldName;
              return (
                <span
                  key={fieldName}
                  style={{
                    background: '#f1f5f9',
                    border: '1px solid #cbd5e1',
                    borderRadius: '6px',
                    padding: '4px 10px',
                    fontSize: '12px',
                    color: '#334155',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                  title={fieldName}
                >
                  <strong style={{ color: '#475569', fontWeight: 600 }}>{viewGroupLabel} &gt;</strong>
                  <span>{labelShort}</span>
                  <button
                    onClick={() => handleRemoveSelectedField(fieldName)}
                    style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontWeight: 'bold', marginLeft: '4px', padding: 0 }}
                  >
                    ✕
                  </button>
                </span>
              );
            })
          )}
        </div>
      </div>

      {/* Query Controls & Filters Card */}
      <div style={{
        background: 'white',
        border: '1px solid #e2e8f0',
        borderRadius: '12px',
        padding: '18px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: '#0f172a' }}>
            Query Controls &amp; Filters
          </h3>
          <button
            onClick={handleAddFilter}
            style={{
              background: '#f1f5f9',
              border: '1px solid #cbd5e1',
              color: '#334155',
              padding: '6px 14px',
              borderRadius: '6px',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            + Add Filter
          </button>
        </div>

        {/* Filter Rows */}
        {filters.length === 0 ? (
          <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8', fontStyle: 'italic' }}>
            No active filters. Click "+ Add Filter" above to add filter criteria.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {filters.map(filter => (
              <div key={filter.id} style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <select
                  value={filter.field}
                  onChange={e => handleFilterChange(filter.id, 'field', e.target.value)}
                  style={{
                    flex: '1',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    fontSize: '13px',
                    background: '#f8fafc',
                    color: '#0f172a'
                  }}
                >
                  <option value="">Select Field...</option>
                  {allAvailableFields.map(f => (
                    <option key={f.name} value={f.name}>
                      {f.group_label ? `${f.group_label} > ` : ''}{f.label} ({f.name})
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  placeholder="Filter expression (e.g. 7 days, >0, 123)"
                  value={filter.value}
                  onChange={e => handleFilterChange(filter.id, 'value', e.target.value)}
                  style={{
                    flex: '1.5',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    fontSize: '13px'
                  }}
                />
                <button
                  onClick={() => handleRemoveFilter(filter.id)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#ef4444',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    padding: '6px',
                    fontSize: '16px'
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Row Limit & Execution Bar */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderTop: '1px solid #f1f5f9',
          paddingTop: '16px',
          marginTop: '6px',
          flexWrap: 'wrap',
          gap: '12px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <label style={{ fontSize: '13px', fontWeight: 500, color: '#475569' }}>
              Row Limit:
            </label>
            <input
              type="number"
              min="1"
              max={activeExplore?.max_row_limit || 5000}
              value={rowLimit}
              onChange={handleRowLimitChange}
              style={{
                width: '90px',
                padding: '6px 10px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                fontSize: '13px'
              }}
            />
            {activeExplore?.max_row_limit && (
              <span style={{ fontSize: '12px', color: '#64748b' }}>
                (Max cap: {activeExplore.max_row_limit})
              </span>
            )}
          </div>

          <div style={{ display: 'flex', gap: '10px' }}>
            {activeExplore?.allow_csv_export && (
              <button
                onClick={handleExportCsv}
                disabled={exportingCsv || runningQuery || selectedFields.length === 0}
                style={{
                  background: '#059669',
                  color: 'white',
                  border: 'none',
                  padding: '9px 18px',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: selectedFields.length === 0 ? 'not-allowed' : 'pointer',
                  opacity: selectedFields.length === 0 || exportingCsv ? 0.6 : 1,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                {exportingCsv ? 'Exporting...' : '📥 Export CSV'}
              </button>
            )}

            <button
              onClick={handleRunQuery}
              disabled={runningQuery || selectedFields.length === 0}
              style={{
                background: '#2563eb',
                color: 'white',
                border: 'none',
                padding: '9px 24px',
                borderRadius: '6px',
                fontSize: '13px',
                fontWeight: 600,
                cursor: selectedFields.length === 0 ? 'not-allowed' : 'pointer',
                opacity: selectedFields.length === 0 || runningQuery ? 0.6 : 1,
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              {runningQuery ? 'Running Query...' : '▶ Run Query'}
            </button>
          </div>
        </div>
      </div>

      {/* Results Table Section */}
      <div style={{
        background: 'white',
        border: '1px solid #e2e8f0',
        borderRadius: '12px',
        padding: '18px 20px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
        minHeight: '260px'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
          <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: '#0f172a' }}>
            Query Results
          </h3>
          {queryMeta && (
            <span style={{ fontSize: '12px', color: '#64748b' }}>
              Returned {queryMeta.rowCount} row(s) (Limit applied: {queryMeta.limitApplied})
            </span>
          )}
        </div>

        {runningQuery ? (
          <div style={{ padding: '48px 0', textAlign: 'center', color: '#64748b' }}>
            <div className="spinner" style={{ margin: '0 auto 12px auto' }}></div>
            <p style={{ margin: 0, fontSize: '14px' }}>Executing query against Looker System Activity...</p>
          </div>
        ) : queryResults && queryResults.length > 0 ? (
          <div style={{ overflowX: 'auto', maxHeight: '440px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                  {selectedFields.map(field => {
                    const fieldObj = fieldsMap.get(field);
                    const groupLabel = fieldObj?.group_label || activeExplore?.label || '';
                    const fieldLabel = fieldObj?.label || field;
                    return (
                      <th key={field} style={{ padding: '10px 14px', fontWeight: 600, color: '#334155', whiteSpace: 'nowrap' }}>
                        {groupLabel ? <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 500 }}>{groupLabel}</div> : null}
                        <div>{fieldLabel}</div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {queryResults.map((row, idx) => (
                  <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9', background: idx % 2 === 0 ? 'white' : '#f8fafc' }}>
                    {selectedFields.map(field => (
                      <td key={field} style={{ padding: '9px 14px', color: '#1e293b', whiteSpace: 'nowrap' }}>
                        {formatCellValue(row[field])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : queryResults && queryResults.length === 0 ? (
          <div style={{ padding: '40px 0', textAlign: 'center', color: '#94a3b8' }}>
            <p style={{ margin: 0, fontSize: '14px' }}>No records returned matching query criteria.</p>
          </div>
        ) : (
          <div style={{ padding: '40px 0', textAlign: 'center', color: '#94a3b8' }}>
            <p style={{ margin: 0, fontSize: '14px' }}>
              Select fields and click <strong>"Run Query"</strong> to display system activity records.
            </p>
          </div>
        )}
      </div>

      {/* Full-Width Field Selection Modal (View C) */}
      {showFieldPickerModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.65)',
          backdropFilter: 'blur(4px)',
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px'
        }}>
          <div style={{
            background: 'white',
            borderRadius: '16px',
            width: '92vw',
            maxWidth: '1050px',
            height: '85vh',
            maxHeight: '780px',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
            overflow: 'hidden'
          }}>
            {/* Modal Header */}
            <div style={{
              padding: '20px 24px',
              borderBottom: '1px solid #e2e8f0',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: '#f8fafc'
            }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: '#0f172a' }}>
                  Field Selection — {activeExplore?.label}
                </h2>
                <p style={{ margin: '2px 0 0 0', fontSize: '13px', color: '#64748b' }}>
                  Search and toggle dimensions &amp; measures with full view and group context.
                </p>
              </div>

              <button
                onClick={handleCloseFieldPickerModal}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '20px',
                  fontWeight: 'bold',
                  color: '#64748b',
                  cursor: 'pointer',
                  padding: '4px 8px'
                }}
              >
                ✕
              </button>
            </div>

            {/* Modal Controls Bar */}
            <div style={{
              padding: '16px 24px',
              borderBottom: '1px solid #e2e8f0',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              background: 'white'
            }}>
              <input
                type="text"
                placeholder="Search fields by label, view name, group label, or field ID..."
                value={modalSearchTerm}
                onChange={e => setModalSearchTerm(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  fontSize: '14px',
                  outline: 'none',
                  boxSizing: 'border-box'
                }}
              />

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                {/* Category Filter Tabs */}
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    onClick={() => setModalCategoryFilter('all')}
                    style={{
                      padding: '6px 14px',
                      borderRadius: '6px',
                      fontSize: '13px',
                      fontWeight: 600,
                      border: '1px solid',
                      borderColor: modalCategoryFilter === 'all' ? '#2563eb' : '#cbd5e1',
                      background: modalCategoryFilter === 'all' ? '#eff6ff' : 'white',
                      color: modalCategoryFilter === 'all' ? '#1d4ed8' : '#475569',
                      cursor: 'pointer'
                    }}
                  >
                    All Fields ({allAvailableFields.length})
                  </button>
                  <button
                    onClick={() => setModalCategoryFilter('dimensions')}
                    style={{
                      padding: '6px 14px',
                      borderRadius: '6px',
                      fontSize: '13px',
                      fontWeight: 600,
                      border: '1px solid',
                      borderColor: modalCategoryFilter === 'dimensions' ? '#2563eb' : '#cbd5e1',
                      background: modalCategoryFilter === 'dimensions' ? '#eff6ff' : 'white',
                      color: modalCategoryFilter === 'dimensions' ? '#1d4ed8' : '#475569',
                      cursor: 'pointer'
                    }}
                  >
                    Dimensions ({fields.dimensions.length})
                  </button>
                  <button
                    onClick={() => setModalCategoryFilter('measures')}
                    style={{
                      padding: '6px 14px',
                      borderRadius: '6px',
                      fontSize: '13px',
                      fontWeight: 600,
                      border: '1px solid',
                      borderColor: modalCategoryFilter === 'measures' ? '#2563eb' : '#cbd5e1',
                      background: modalCategoryFilter === 'measures' ? '#eff6ff' : 'white',
                      color: modalCategoryFilter === 'measures' ? '#1d4ed8' : '#475569',
                      cursor: 'pointer'
                    }}
                  >
                    Measures ({fields.measures.length})
                  </button>
                </div>

                {/* Bulk Actions */}
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button
                    onClick={handleSelectAllVisibleModalFields}
                    style={{ background: 'none', border: 'none', color: '#2563eb', fontSize: '13px', cursor: 'pointer', fontWeight: 600 }}
                  >
                    Select All Visible
                  </button>
                  <span style={{ color: '#cbd5e1' }}>|</span>
                  <button
                    onClick={handleClearModalFields}
                    style={{ background: 'none', border: 'none', color: '#64748b', fontSize: '13px', cursor: 'pointer' }}
                  >
                    Clear All
                  </button>
                </div>
              </div>
            </div>

            {/* Modal Body: Disambiguated Grid */}
            <div style={{ flex: 1, padding: '20px 24px', overflowY: 'auto', background: '#f8fafc' }}>
              {loadingFields ? (
                <div style={{ padding: '48px 0', textAlign: 'center', color: '#64748b' }}>
                  <div className="spinner" style={{ margin: '0 auto 12px auto' }}></div>
                  <p style={{ margin: 0, fontSize: '14px' }}>Loading explore field dictionary...</p>
                </div>
              ) : filteredModalFields.length === 0 ? (
                <div style={{ padding: '48px 0', textAlign: 'center', color: '#94a3b8' }}>
                  <p style={{ margin: 0, fontSize: '14px' }}>No fields match search filter "{modalSearchTerm}".</p>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(310px, 1fr))', gap: '12px' }}>
                  {filteredModalFields.map(f => {
                    const isSelected = selectedFields.includes(f.name);
                    const viewGroupLabel = f.group_label || activeExplore?.label || 'Field';
                    return (
                      <div
                        key={f.name}
                        onClick={() => handleToggleField(f.name)}
                        style={{
                          background: isSelected ? '#eff6ff' : 'white',
                          border: '1px solid',
                          borderColor: isSelected ? '#3b82f6' : '#e2e8f0',
                          borderRadius: '8px',
                          padding: '12px 14px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: '12px',
                          transition: 'all 0.15s ease'
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {}} // Handled by parent div onClick
                          style={{ marginTop: '3px', cursor: 'pointer' }}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', marginBottom: '2px' }}>
                            {viewGroupLabel}
                          </div>
                          <div style={{ fontSize: '14px', fontWeight: 600, color: isSelected ? '#1d4ed8' : '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {f.label}
                          </div>
                          <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px', fontFamily: 'monospace' }}>
                            {f.name}
                          </div>
                        </div>

                        {f.is_date && (
                          <span style={{ fontSize: '10px', background: '#e0f2fe', color: '#0369a1', padding: '2px 6px', borderRadius: '4px', fontWeight: 600 }}>
                            Date
                          </span>
                        )}
                        {f.category === 'measure' && (
                          <span style={{ fontSize: '10px', background: '#dcfce7', color: '#15803d', padding: '2px 6px', borderRadius: '4px', fontWeight: 600 }}>
                            Measure
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div style={{
              padding: '16px 24px',
              borderTop: '1px solid #e2e8f0',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: 'white'
            }}>
              <span style={{ fontSize: '13px', color: '#475569', fontWeight: 500 }}>
                <strong>{selectedFields.length}</strong> field(s) selected
              </span>

              <div style={{ display: 'flex', gap: '12px' }}>
                <button
                  onClick={handleCloseFieldPickerModal}
                  style={{
                    background: 'white',
                    border: '1px solid #cbd5e1',
                    color: '#475569',
                    padding: '8px 18px',
                    borderRadius: '6px',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleCloseFieldPickerModal}
                  style={{
                    background: '#2563eb',
                    border: 'none',
                    color: 'white',
                    padding: '8px 20px',
                    borderRadius: '6px',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  Apply Selection ({selectedFields.length})
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  // 4. Hoisted Function Implementations
  function handleInitExplores() {
    fetchExplores();
  }

  function handleExploreChangeEffect() {
    if (selectedExploreName) {
      fetchExploreFields(selectedExploreName);
    }
  }

  function handlePickExplore(exploreName: string) {
    setSelectedExploreName(exploreName);
    setQueryResults(null);
    setQueryMeta(null);
    setErrorMsg(null);
  }

  function handleChangeExplore() {
    setSelectedExploreName('');
    setQueryResults(null);
    setQueryMeta(null);
    setErrorMsg(null);
  }

  function handleOpenFieldPickerModal() {
    setShowFieldPickerModal(true);
  }

  function handleCloseFieldPickerModal() {
    setShowFieldPickerModal(false);
  }

  function handleRemoveSelectedField(fieldName: string) {
    setSelectedFields(prev => prev.filter(f => f !== fieldName));
  }

  function handleToggleField(fieldName: string) {
    setSelectedFields(prev =>
      prev.includes(fieldName) ? prev.filter(f => f !== fieldName) : [...prev, fieldName]
    );
  }

  function handleSelectAllVisibleModalFields() {
    const visibleNames = filteredModalFields.map(f => f.name);
    setSelectedFields(prev => Array.from(new Set([...prev, ...visibleNames])));
  }

  function handleClearModalFields() {
    setSelectedFields([]);
  }

  function handleAddFilter() {
    const defaultField = allAvailableFields.length > 0 ? allAvailableFields[0].name : '';
    setFilters(prev => [...prev, { id: String(Date.now()), field: defaultField, value: '' }]);
  }

  function handleRemoveFilter(id: string) {
    setFilters(prev => prev.filter(f => f.id !== id));
  }

  function handleFilterChange(id: string, key: 'field' | 'value', val: string) {
    setFilters(prev =>
      prev.map(f => (f.id === id ? { ...f, [key]: val } : f))
    );
  }

  function handleRowLimitChange(e: React.ChangeEvent<HTMLInputElement>) {
    setRowLimit(Number(e.target.value));
  }

  function handleClearError() {
    setErrorMsg(null);
  }

  async function fetchExplores() {
    setLoadingExplores(true);
    setErrorMsg(null);
    try {
      addLog('Fetching validated system activity explores...');
      const data = await callBackend('get_explores');
      const loadedExplores = data?.explores || [];
      setExplores(loadedExplores);
      if (loadedExplores.length > 0) {
        setSelectedExploreName(loadedExplores[0].name);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to fetch explores.');
    } finally {
      setLoadingExplores(false);
    }
  }

  async function fetchExploreFields(exploreName: string) {
    setLoadingFields(true);
    setErrorMsg(null);
    try {
      addLog(`Fetching fields for explore '${exploreName}'...`);
      const data = await callBackend('get_explore_fields', { explore_name: exploreName });
      const dims = data?.fields?.dimensions || [];
      const meas = data?.fields?.measures || [];
      setFields({ dimensions: dims, measures: meas });

      // Auto-select initial 3 dimensions for convenience if none currently selected
      if (selectedFields.length === 0) {
        const defaultSelected = dims.slice(0, 3).map((d: any) => d.name);
        setSelectedFields(defaultSelected);
      }
    } catch (err: any) {
      setErrorMsg(err.message || `Failed to fetch fields for explore '${exploreName}'.`);
    } finally {
      setLoadingFields(false);
    }
  }

  async function handleRunQuery() {
    if (selectedFields.length === 0) {
      setErrorMsg('Please select at least one field before running query.');
      return;
    }

    setRunningQuery(true);
    setErrorMsg(null);
    setQueryResults(null);
    setQueryMeta(null);

    const formattedFilters: Record<string, string> = {};
    filters.forEach(f => {
      if (f.field && f.value) {
        formattedFilters[f.field] = f.value;
      }
    });

    try {
      addLog(`Executing query against system__activity explore '${selectedExploreName}'...`);
      const result = await callBackend('run_query', {
        explore_name: selectedExploreName,
        fields: selectedFields,
        filters: formattedFilters,
        limit: rowLimit
      });

      setQueryResults(result?.rows || []);
      setQueryMeta({
        rowCount: result?.row_count || 0,
        limitApplied: result?.limit_applied || rowLimit
      });
    } catch (err: any) {
      setErrorMsg(err.message || 'Query execution failed.');
    } finally {
      setRunningQuery(false);
    }
  }

  async function handleExportCsv() {
    if (selectedFields.length === 0) {
      setErrorMsg('Please select at least one field before exporting CSV.');
      return;
    }

    setExportingCsv(true);
    setErrorMsg(null);

    const formattedFilters: Record<string, string> = {};
    filters.forEach(f => {
      if (f.field && f.value) {
        formattedFilters[f.field] = f.value;
      }
    });

    try {
      addLog(`Requesting CSV export for system__activity explore '${selectedExploreName}'...`);
      const result = await callBackend('export_csv', {
        explore_name: selectedExploreName,
        fields: selectedFields,
        filters: formattedFilters,
        limit: rowLimit
      });

      if (result?.csv_data) {
        downloadCsvFile(result.csv_data, `${selectedExploreName}_export.csv`);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'CSV export failed.');
    } finally {
      setExportingCsv(false);
    }
  }

  function downloadCsvFile(csvContent: string, filename: string) {
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function formatCellValue(val: any): string {
    if (val === null || val === undefined) return '—';
    if (typeof val === 'object') return JSON.stringify(val);
    return String(val);
  }
};

export default LimitedSystemActivityWorkflow;
