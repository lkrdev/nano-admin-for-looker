import React, { useEffect, useMemo, useState } from 'react';

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

export const LimitedSystemActivityWorkflow: React.FC<WorkflowComponentProps> = ({
  workflowId,
  label,
  parameters,
  subRoute = '',
  onNavigateSubRoute,
  addLog,
  callBackend
}) => {
  // 1. Hook Declarations (State & Memos)
  const [explores, setExplores] = useState<any[]>([]);
  const [fields, setFields] = useState<{ dimensions: any[]; measures: any[] }>({ dimensions: [], measures: [] });
  const [selectedFields, setSelectedFields] = useState<string[]>([]);
  const [filters, setFilters] = useState<Array<{ id: string; field: string; value: string }>>([]);
  const [rowLimit, setRowLimit] = useState<number>(100);

  // Full-Width Field Selection Modal State
  const [showFieldPickerModal, setShowFieldPickerModal] = useState<boolean>(false);
  const [modalSearchTerm, setModalSearchTerm] = useState<string>('');
  const [modalCategoryFilter, setModalCategoryFilter] = useState<'all' | 'dimensions' | 'measures'>('all');

  // Query Execution & Result States
  const [loadingExplores, setLoadingExplores] = useState<boolean>(true);
  const [loadingFields, setLoadingFields] = useState<boolean>(false);
  const [runningQuery, setRunningQuery] = useState<boolean>(false);
  const [previewingSql, setPreviewingSql] = useState<boolean>(false);
  const [exportingCsv, setExportingCsv] = useState<boolean>(false);

  const [queryResults, setQueryResults] = useState<any[] | null>(null);
  const [sqlPreview, setSqlPreview] = useState<string | null>(null);
  const [activeResultTab, setActiveResultTab] = useState<'table' | 'sql'>('table');
  const [queryMeta, setQueryMeta] = useState<{ rowCount: number; limitApplied: number } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const selectedExploreName = subRoute ? subRoute.trim() : '';

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

    const terms = modalSearchTerm.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return pool;

    return pool.filter(f => {
      const haystack = `${f.name} ${f.label} ${f.group_label || ''} ${f.description || ''}`.toLowerCase();
      return terms.every(term => haystack.includes(term));
    });
  }, [allAvailableFields, fields, modalCategoryFilter, modalSearchTerm]);

  const hasExecutedResults = Boolean(
    (activeResultTab === 'table' && queryResults) ||
    (activeResultTab === 'sql' && sqlPreview)
  );

  // 2. Effects
  useEffect(handleInitExplores, []);
  useEffect(handleExploreChangeEffect, [selectedExploreName]);

  // 3. Returned Component JSX
  if (loadingExplores) {
    return (
      <div style={{ padding: '40px 20px', textAlign: 'center', color: '#64748b', fontFamily: 'Inter, system-ui, sans-serif' }}>
        <div className="spinner" style={{ margin: '0 auto 12px auto' }}></div>
        <p style={{ margin: 0, fontSize: '13px', fontWeight: 500 }}>Loading explores...</p>
      </div>
    );
  }

  if (explores.length === 0) {
    return (
      <div style={{
        padding: '36px 20px',
        textAlign: 'center',
        background: 'white',
        borderRadius: '8px',
        border: '1px solid #e2e8f0',
        fontFamily: 'Inter, system-ui, sans-serif'
      }}>
        <h3 style={{ margin: '0 0 4px 0', fontSize: '16px', fontWeight: '600', color: '#0f172a' }}>
          No Explores Configured
        </h3>
      </div>
    );
  }

  // Explore Picker View (subRoute is empty)
  if (!selectedExploreName) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', fontFamily: 'Inter, system-ui, sans-serif' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: '#0f172a' }}>Select Explore</h2>
          <span style={{ fontSize: '12px', color: '#64748b' }}>{explores.length} available</span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
          {explores.map(exp => (
            <div
              key={exp.name}
              onClick={() => handlePickExplore(exp.name)}
              style={{
                background: 'white',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                padding: '16px',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                gap: '12px',
                transition: 'all 0.15s ease'
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: '#0f172a' }}>
                    {exp.label}
                  </h3>
                  <code style={{ fontSize: '11px', color: '#64748b', background: '#f1f5f9', padding: '1px 6px', borderRadius: '4px' }}>
                    {exp.name}
                  </code>
                </div>

                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '8px' }}>
                  {(() => {
                    const norm = normalizeExploreConfig(exp);
                    if (!norm.required_filter_fields || norm.required_filter_fields.length === 0) return null;
                    return (
                      <span style={{ fontSize: '11px', background: '#fef3c7', color: '#92400e', padding: '2px 6px', borderRadius: '4px', fontWeight: 500 }}>
                        Filter: {norm.required_filter_fields[0]}
                      </span>
                    );
                  })()}
                  {exp.allow_csv_export && (
                    <span style={{ fontSize: '11px', background: '#dcfce7', color: '#166534', padding: '2px 6px', borderRadius: '4px', fontWeight: 500 }}>
                      CSV Export
                    </span>
                  )}
                  {exp.max_row_limit && (
                    <span style={{ fontSize: '11px', background: '#e0f2fe', color: '#075985', padding: '2px 6px', borderRadius: '4px', fontWeight: 500 }}>
                      Limit: {exp.max_row_limit}
                    </span>
                  )}
                </div>
              </div>

              <div style={{ fontSize: '13px', fontWeight: 600, color: '#2563eb', textAlign: 'right' }}>
                Open Explore →
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Explore Query Builder View (subRoute is active explore name)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', fontFamily: 'Inter, system-ui, sans-serif' }}>
      {/* Error Alert */}
      {errorMsg && (
        <div style={{
          background: '#fef2f2',
          border: '1px solid #fecaca',
          color: '#dc2626',
          padding: '12px 16px',
          borderRadius: '6px',
          fontSize: '13px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <span>⚠️ {errorMsg}</span>
          <button
            onClick={handleClearError}
            style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontWeight: 'bold' }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Selected Fields Bar */}
      <div style={{
        background: 'white',
        border: '1px solid #e2e8f0',
        borderRadius: '8px',
        padding: '14px 18px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: '#0f172a' }}>
            Fields ({selectedFields.length})
          </h3>

          <button
            onClick={handleOpenFieldPickerModal}
            style={{
              background: '#2563eb',
              color: 'white',
              border: 'none',
              padding: '6px 14px',
              borderRadius: '6px',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            Edit Fields
          </button>
        </div>

        {/* Selected Field Badges */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', minHeight: '28px', alignItems: 'center' }}>
          {selectedFields.length === 0 ? (
            <span style={{ fontSize: '12px', color: '#94a3b8', fontStyle: 'italic' }}>
              No fields selected.
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
                    borderRadius: '4px',
                    padding: '3px 8px',
                    fontSize: '12px',
                    color: '#334155',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                  title={fieldName}
                >
                  <strong style={{ color: '#64748b' }}>{viewGroupLabel} &gt;</strong>
                  <span>{labelShort}</span>
                  <button
                    onClick={() => handleRemoveSelectedField(fieldName)}
                    style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontWeight: 'bold', padding: 0 }}
                  >
                    ✕
                  </button>
                </span>
              );
            })
          )}
        </div>
      </div>

      {/* Query Filters Card */}
      <div style={{
        background: 'white',
        border: '1px solid #e2e8f0',
        borderRadius: '8px',
        padding: '14px 18px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: '#0f172a' }}>
              Filters ({filters.length})
            </h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <label style={{ fontSize: '12px', color: '#64748b', fontWeight: 500 }}>Row Limit:</label>
              <input
                type="number"
                min="1"
                max={activeExplore?.max_row_limit || 5000}
                value={rowLimit}
                onChange={handleRowLimitChange}
                style={{
                  width: '75px',
                  padding: '4px 6px',
                  borderRadius: '4px',
                  border: '1px solid #cbd5e1',
                  fontSize: '12px'
                }}
              />
            </div>
          </div>

          <button
            onClick={handleAddFilter}
            style={{
              background: '#f1f5f9',
              border: '1px solid #cbd5e1',
              color: '#334155',
              padding: '5px 10px',
              borderRadius: '6px',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            + Add Filter
          </button>
        </div>

        {filters.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {filters.map(filter => (
              <div key={filter.id} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <select
                  value={filter.field}
                  onChange={e => handleFilterChange(filter.id, 'field', e.target.value)}
                  style={{
                    flex: '1',
                    padding: '6px 10px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    fontSize: '12px',
                    background: '#f8fafc'
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
                  placeholder="Filter expression (e.g. 7 days, >0)"
                  value={filter.value}
                  onChange={e => handleFilterChange(filter.id, 'value', e.target.value)}
                  style={{
                    flex: '1.5',
                    padding: '6px 10px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    fontSize: '12px'
                  }}
                />
                <button
                  onClick={() => handleRemoveFilter(filter.id)}
                  style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontWeight: 'bold' }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Results Area */}
      <div style={{
        background: 'white',
        border: '1px solid #e2e8f0',
        borderRadius: '8px',
        padding: '14px 18px',
        minHeight: '220px'
      }}>
        {/* Results Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: hasExecutedResults ? '14px' : '0', flexWrap: 'wrap', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: '#0f172a' }}>
              {activeResultTab === 'sql' ? 'SQL Preview' : 'Results'}
            </h3>
            {activeResultTab === 'table' && queryMeta && (
              <span style={{ fontSize: '12px', color: '#64748b' }}>
                {queryMeta.rowCount} row(s) (Limit: {queryMeta.limitApplied})
              </span>
            )}
          </div>

          {/* Action buttons in header (shown ONLY when results or SQL preview exist) */}
          {hasExecutedResults && renderActionButtons('normal')}
        </div>

        {/* Results Body */}
        {runningQuery || previewingSql ? (
          <div style={{ padding: '36px 0', textAlign: 'center', color: '#64748b' }}>
            <div className="spinner" style={{ margin: '0 auto 10px auto' }}></div>
            <p style={{ margin: 0, fontSize: '13px' }}>{runningQuery ? 'Executing query...' : 'Generating SQL...'}</p>
          </div>
        ) : activeResultTab === 'sql' && sqlPreview ? (
          <div style={{ position: 'relative' }}>
            <pre style={{
              background: '#0f172a',
              color: '#f8fafc',
              padding: '16px',
              borderRadius: '6px',
              fontSize: '12px',
              fontFamily: 'Consolas, Monaco, monospace',
              overflowX: 'auto',
              maxHeight: '400px',
              margin: 0,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word'
            }}>
              {sqlPreview}
            </pre>
          </div>
        ) : activeResultTab === 'table' && queryResults && queryResults.length > 0 ? (
          <div style={{ overflowX: 'auto', maxHeight: '400px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                  {selectedFields.map(field => {
                    const fieldObj = fieldsMap.get(field);
                    const groupLabel = fieldObj?.group_label || activeExplore?.label || '';
                    const fieldLabel = fieldObj?.label || field;
                    return (
                      <th key={field} style={{ padding: '8px 10px', fontWeight: 600, color: '#334155', whiteSpace: 'nowrap' }}>
                        {groupLabel ? <div style={{ fontSize: '10px', color: '#64748b', fontWeight: 500 }}>{groupLabel}</div> : null}
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
                      <td key={field} style={{ padding: '7px 10px', color: '#1e293b', whiteSpace: 'nowrap' }}>
                        {formatCellValue(row[field])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : activeResultTab === 'table' && queryResults && queryResults.length === 0 ? (
          <div style={{ padding: '32px 0', textAlign: 'center', color: '#94a3b8' }}>
            <p style={{ margin: 0, fontSize: '13px' }}>No records returned.</p>
          </div>
        ) : (
          /* Initial / Un-executed State: Primary action buttons in consistent order (Preview, Export, Run) */
          <div style={{
            padding: '48px 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            {renderActionButtons('large')}
          </div>
        )}
      </div>

      {/* Full-Width Field Selection Modal */}
      {showFieldPickerModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.6)',
          backdropFilter: 'blur(3px)',
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px'
        }}>
          <div style={{
            background: 'white',
            borderRadius: '12px',
            width: '90vw',
            maxWidth: '1000px',
            height: '82vh',
            maxHeight: '740px',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden'
          }}>
            {/* Modal Header */}
            <div style={{
              padding: '16px 20px',
              borderBottom: '1px solid #e2e8f0',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: '#f8fafc'
            }}>
              <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#0f172a' }}>
                Select Fields — {activeExplore?.label}
              </h2>

              <button
                onClick={handleCloseFieldPickerModal}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '18px',
                  fontWeight: 'bold',
                  color: '#64748b',
                  cursor: 'pointer'
                }}
              >
                ✕
              </button>
            </div>

            {/* Modal Controls Bar */}
            <div style={{
              padding: '14px 20px',
              borderBottom: '1px solid #e2e8f0',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
              background: 'white'
            }}>
              <input
                type="text"
                placeholder="Search fields by label, view, or technical name..."
                value={modalSearchTerm}
                onChange={e => setModalSearchTerm(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: '13px',
                  outline: 'none',
                  boxSizing: 'border-box'
                }}
              />

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    onClick={() => setModalCategoryFilter('all')}
                    style={{
                      padding: '5px 12px',
                      borderRadius: '4px',
                      fontSize: '12px',
                      fontWeight: 600,
                      border: '1px solid',
                      borderColor: modalCategoryFilter === 'all' ? '#2563eb' : '#cbd5e1',
                      background: modalCategoryFilter === 'all' ? '#eff6ff' : 'white',
                      color: modalCategoryFilter === 'all' ? '#1d4ed8' : '#475569',
                      cursor: 'pointer'
                    }}
                  >
                    All ({allAvailableFields.length})
                  </button>
                  <button
                    onClick={() => setModalCategoryFilter('dimensions')}
                    style={{
                      padding: '5px 12px',
                      borderRadius: '4px',
                      fontSize: '12px',
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
                      padding: '5px 12px',
                      borderRadius: '4px',
                      fontSize: '12px',
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

                <div>
                  <button
                    onClick={handleClearModalFields}
                    style={{ background: 'none', border: 'none', color: '#64748b', fontSize: '12px', cursor: 'pointer' }}
                  >
                    Clear All
                  </button>
                </div>
              </div>
            </div>

            {/* Modal Body: Disambiguated Grid */}
            <div style={{ flex: 1, padding: '16px 20px', overflowY: 'auto', background: '#f8fafc' }}>
              {loadingFields ? (
                <div style={{ padding: '36px 0', textAlign: 'center', color: '#64748b' }}>
                  <div className="spinner" style={{ margin: '0 auto 10px auto' }}></div>
                  <p style={{ margin: 0, fontSize: '13px' }}>Loading fields...</p>
                </div>
              ) : filteredModalFields.length === 0 ? (
                <div style={{ padding: '36px 0', textAlign: 'center', color: '#94a3b8' }}>
                  <p style={{ margin: 0, fontSize: '13px' }}>No fields match "{modalSearchTerm}".</p>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: '10px' }}>
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
                          borderRadius: '6px',
                          padding: '10px 12px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: '10px',
                          transition: 'all 0.15s ease'
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {}}
                          style={{ marginTop: '2px', cursor: 'pointer' }}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '10px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', marginBottom: '1px' }}>
                            {viewGroupLabel}
                          </div>
                          <div style={{ fontSize: '13px', fontWeight: 600, color: isSelected ? '#1d4ed8' : '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {f.label}
                          </div>
                          <div style={{ fontSize: '11px', color: '#94a3b8', fontFamily: 'monospace' }}>
                            {f.name}
                          </div>
                        </div>

                        {f.is_date && (
                          <span style={{ fontSize: '10px', background: '#e0f2fe', color: '#0369a1', padding: '1px 5px', borderRadius: '3px', fontWeight: 600 }}>
                            Date
                          </span>
                        )}
                        {f.category === 'measure' && (
                          <span style={{ fontSize: '10px', background: '#dcfce7', color: '#15803d', padding: '1px 5px', borderRadius: '3px', fontWeight: 600 }}>
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
              padding: '12px 20px',
              borderTop: '1px solid #e2e8f0',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: 'white'
            }}>
              <span style={{ fontSize: '12px', color: '#475569', fontWeight: 500 }}>
                {selectedFields.length} selected
              </span>

              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={handleCloseFieldPickerModal}
                  style={{
                    background: 'white',
                    border: '1px solid #cbd5e1',
                    color: '#475569',
                    padding: '6px 14px',
                    borderRadius: '6px',
                    fontSize: '12px',
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
                    padding: '6px 16px',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  Apply ({selectedFields.length})
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
      setSelectedFields([]);
      setFilters([]);
      resetQueryState();
      fetchExploreFields(selectedExploreName);
    }
  }

  function renderActionButtons(size: 'normal' | 'large' = 'normal') {
    const isLarge = size === 'large';
    const padding = isLarge ? '10px 20px' : '6px 14px';
    const fontSize = isLarge ? '14px' : '12px';

    return (
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
        {/* 1. Preview SQL */}
        <button
          onClick={handlePreviewSql}
          disabled={previewingSql || runningQuery || selectedFields.length === 0}
          style={{
            background: '#f1f5f9',
            border: '1px solid #cbd5e1',
            color: '#334155',
            padding,
            borderRadius: '6px',
            fontSize,
            fontWeight: 600,
            cursor: selectedFields.length === 0 ? 'not-allowed' : 'pointer',
            opacity: selectedFields.length === 0 || previewingSql ? 0.6 : 1
          }}
        >
          {previewingSql ? 'Generating SQL...' : '👁️ Preview SQL'}
        </button>

        {/* 2. Export CSV */}
        {activeExplore?.allow_csv_export && (
          <button
            onClick={handleExportCsv}
            disabled={exportingCsv || runningQuery || selectedFields.length === 0}
            style={{
              background: '#059669',
              color: 'white',
              border: 'none',
              padding,
              borderRadius: '6px',
              fontSize,
              fontWeight: 600,
              cursor: selectedFields.length === 0 ? 'not-allowed' : 'pointer',
              opacity: selectedFields.length === 0 || exportingCsv ? 0.6 : 1
            }}
          >
            {exportingCsv ? 'Exporting...' : '📥 Export CSV'}
          </button>
        )}

        {/* 3. Run Query */}
        <button
          onClick={handleRunQuery}
          disabled={runningQuery || selectedFields.length === 0}
          style={{
            background: '#2563eb',
            color: 'white',
            border: 'none',
            padding,
            borderRadius: '6px',
            fontSize,
            fontWeight: 600,
            cursor: selectedFields.length === 0 ? 'not-allowed' : 'pointer',
            opacity: selectedFields.length === 0 || runningQuery ? 0.6 : 1,
            boxShadow: isLarge ? '0 2px 4px rgba(37, 99, 235, 0.2)' : 'none'
          }}
        >
          {runningQuery ? 'Running Query...' : '▶ Run Query'}
        </button>
      </div>
    );
  }

  function resetQueryState() {
    setQueryResults(null);
    setSqlPreview(null);
    setActiveResultTab('table');
    setQueryMeta(null);
    setErrorMsg(null);
  }

  function handlePickExplore(exploreName: string) {
    if (onNavigateSubRoute) {
      onNavigateSubRoute(exploreName);
    }
    resetQueryState();
  }

  function handleOpenFieldPickerModal() {
    setShowFieldPickerModal(true);
  }

  function handleCloseFieldPickerModal() {
    setShowFieldPickerModal(false);
  }

  function handleRemoveSelectedField(fieldName: string) {
    setSelectedFields(prev => prev.filter(f => f !== fieldName));
    resetQueryState();
  }

  function handleToggleField(fieldName: string) {
    setSelectedFields(prev =>
      prev.includes(fieldName) ? prev.filter(f => f !== fieldName) : [...prev, fieldName]
    );
    resetQueryState();
  }

  function handleClearModalFields() {
    setSelectedFields([]);
    resetQueryState();
  }

  function handleAddFilter() {
    const defaultField = allAvailableFields.length > 0 ? allAvailableFields[0].name : '';
    setFilters(prev => [...prev, { id: String(Date.now()), field: defaultField, value: '' }]);
    resetQueryState();
  }

  function handleRemoveFilter(id: string) {
    setFilters(prev => prev.filter(f => f.id !== id));
    resetQueryState();
  }

  function handleFilterChange(id: string, key: 'field' | 'value', val: string) {
    setFilters(prev =>
      prev.map(f => (f.id === id ? { ...f, [key]: val } : f))
    );
    resetQueryState();
  }

  function handleRowLimitChange(e: React.ChangeEvent<HTMLInputElement>) {
    setRowLimit(Number(e.target.value));
    resetQueryState();
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
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to fetch explores.');
    } finally {
      setLoadingExplores(false);
    }
  }

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

  async function fetchExploreFields(exploreName: string) {
    setLoadingFields(true);
    setErrorMsg(null);
    try {
      addLog(`Fetching fields for explore '${exploreName}'...`);
      const data = await callBackend('get_explore_fields', { explore_name: exploreName });
      const dims = data?.fields?.dimensions || [];
      const meas = data?.fields?.measures || [];
      setFields({ dimensions: dims, measures: meas });

      // Check for required date filter fields configured for this explore
      const rawCfg = data?.explore_config ||
        (parameters?.explores || []).find((e: any) => e.name === exploreName) ||
        explores.find((e: any) => e.name === exploreName);

      const exploreCfg = normalizeExploreConfig(rawCfg, exploreName);
      const reqFields: string[] = exploreCfg?.required_filter_fields || [];

      if (reqFields.length > 0) {
        // Target field to auto-add as initial default filter
        const targetDateDim = dims.find((d: any) => reqFields.includes(d.name)) ||
          dims.find((d: any) => d.name === reqFields[0]) ||
          dims[0];

        if (targetDateDim) {
          setFilters(prevFilters => {
            const hasRequiredFilter = prevFilters.some(f => {
              return reqFields.some(reqField => {
                if (f.field === reqField) return true;
                const parts = reqField.split('.');
                if (parts.length === 2) {
                  const groupPrefix = `${parts[0]}.${parts[1].split('_')[0]}_`;
                  if (String(f.field || '').startsWith(groupPrefix)) return true;
                }
                return false;
              });
            });

            if (!hasRequiredFilter) {
              return [{ id: String(Date.now()), field: targetDateDim.name, value: '7 days' }];
            }
            return prevFilters;
          });
        }
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
      setActiveResultTab('table');
      setSqlPreview(null);
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

  async function handlePreviewSql() {
    if (selectedFields.length === 0) {
      setErrorMsg('Please select at least one field before previewing SQL.');
      return;
    }

    setPreviewingSql(true);
    setErrorMsg(null);

    const formattedFilters: Record<string, string> = {};
    filters.forEach(f => {
      if (f.field && f.value) {
        formattedFilters[f.field] = f.value;
      }
    });

    try {
      addLog(`Requesting SQL preview for system__activity explore '${selectedExploreName}'...`);
      const result = await callBackend('preview_sql', {
        explore_name: selectedExploreName,
        fields: selectedFields,
        filters: formattedFilters,
        limit: rowLimit
      });

      setSqlPreview(result?.sql || '');
      setActiveResultTab('sql');
    } catch (err: any) {
      setErrorMsg(err.message || 'SQL preview failed.');
    } finally {
      setPreviewingSql(false);
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
