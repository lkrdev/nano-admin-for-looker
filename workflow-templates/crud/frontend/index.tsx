import React, { useEffect, useState } from 'react';

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
  // 1. Hook Declarations (State & Memos)
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(10);
  
  const [editingRow, setEditingRow] = useState<any | null>(null);
  const [viewingRow, setViewingRow] = useState<any | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState<boolean>(false);
  const [formValues, setFormValues] = useState<Record<string, any>>({});

  const operations = parameters.supported_operations || [];
  const canList = operations.some(op => op.name === 'list');
  const canUpdate = operations.some(op => op.name === 'update');
  const canCreate = operations.some(op => op.name === 'create');
  const canRead = operations.some(op => op.name === 'read');

  const listOp = operations.find(op => op.name === 'list');
  const updateOp = operations.find(op => op.name === 'update');
  const createOp = operations.find(op => op.name === 'create');

  // Derive Table Columns Dynamically
  const columns = React.useMemo(() => {
    if (listOp?.fields && listOp.fields.length > 0 && !listOp.fields.includes('*')) {
      return listOp.fields;
    }
    if (items.length > 0) {
      return Object.keys(items[0]).filter(k => k !== 'can' && typeof items[0][k] !== 'function');
    }
    return ['id', 'name'];
  }, [listOp, items]);

  // Local Filtering & Pagination Calculations
  const filteredItems = React.useMemo(() => {
    if (!searchQuery.trim()) return items;
    const query = searchQuery.toLowerCase();
    return items.filter(item => {
      return Object.values(item).some(val => {
        if (val === null || val === undefined) return false;
        if (typeof val === 'object') return JSON.stringify(val).toLowerCase().includes(query);
        return String(val).toLowerCase().includes(query);
      });
    });
  }, [items, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const startIndex = (currentPage - 1) * pageSize;
  const paginatedItems = filteredItems.slice(startIndex, startIndex + pageSize);

  // 2. Effects
  useEffect(handleAutoFetch, [workflowId]);

  // 3. Returned Component JSX
  return (
    <div className="crud-container">
      {/* Header Toolbar */}
      <div className="crud-toolbar">
        <div>
          <h3 style={{ margin: '0 0 4px 0', fontSize: '18px', fontWeight: '600' }}>{label}</h3>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            Total: {items.length} records
          </span>
        </div>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          {/* Search Box */}
          <div className="crud-search-box">
            <span>🔍</span>
            <input
              type="text"
              placeholder="Search records..."
              value={searchQuery}
              onChange={handleSearchChange}
            />
            {searchQuery && (
              <button className="icon-btn" onClick={handleClearSearch} style={{ padding: '0 4px', fontSize: '12px' }}>
                ✕
              </button>
            )}
          </div>

          {canList && (
            <button className="btn btn-secondary" onClick={handleRefresh} disabled={loading} style={{ padding: '6px 12px', fontSize: '13px' }}>
              {loading ? 'Refreshing...' : '🔄 Refresh'}
            </button>
          )}

          {canCreate && (
            <button className="btn btn-primary" onClick={handleOpenCreate} style={{ padding: '6px 14px', fontSize: '13px' }}>
              + Create New
            </button>
          )}
        </div>
      </div>

      {/* Main Data Table */}
      <div className="crud-table-wrapper">
        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
            <div className="spinner" style={{ margin: '0 auto 12px auto' }}></div>
            <p>Loading data...</p>
          </div>
        ) : paginatedItems.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
            <p style={{ margin: 0 }}>No matching records found.</p>
          </div>
        ) : (
          <table className="crud-table">
            <thead>
              <tr>
                {columns.map(col => (
                  <th key={col}>{humanizeHeader(col)}</th>
                ))}
                {(canUpdate || canRead) && <th style={{ textAlign: 'right' }}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {paginatedItems.map((row, idx) => (
                <tr key={row.id || `row-${idx}`}>
                  {columns.map(col => (
                    <td key={col}>{renderCellValue(row[col])}</td>
                  ))}
                  {(canUpdate || canRead) && (
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {canRead && (
                        <button
                          className="icon-btn"
                          title="View Details"
                          onClick={() => handleOpenView(row)}
                        >
                          👁️
                        </button>
                      )}
                      {canUpdate && (
                        <button
                          className="icon-btn"
                          title="Edit Item"
                          onClick={() => handleOpenEdit(row)}
                        >
                          ✏️
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination Bar */}
      {filteredItems.length > 0 && (
        <div className="crud-pagination">
          <div>
            Showing {startIndex + 1} to {Math.min(startIndex + pageSize, filteredItems.length)} of {filteredItems.length} entries
            {searchQuery && ` (filtered from ${items.length} total)`}
          </div>

          <div className="pagination-controls">
            <label style={{ fontSize: '12px', marginRight: '8px' }}>Rows per page:</label>
            <select
              value={pageSize}
              onChange={handlePageSizeChange}
              style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '12px' }}
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>

            <button
              className="pagination-btn"
              onClick={handlePrevPage}
              disabled={currentPage === 1}
            >
              Previous
            </button>
            <span style={{ fontSize: '12px', padding: '0 4px' }}>
              Page {currentPage} of {totalPages}
            </span>
            <button
              className="pagination-btn"
              onClick={handleNextPage}
              disabled={currentPage === totalPages}
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Edit Form Modal */}
      {editingRow && (
        <div className="modal-backdrop" onClick={handleCloseModals}>
          <div className="modal-dialog" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Edit Item (ID: {editingRow.id})</h3>
              <button className="icon-btn" onClick={handleCloseModals}>✕</button>
            </div>
            <div className="modal-body">
              {getEditableFields(editingRow).map(field => (
                <div key={field} className="form-group">
                  <label>{humanizeHeader(field)}</label>
                  {typeof editingRow[field] === 'boolean' || typeof formValues[field] === 'boolean' ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <input
                        type="checkbox"
                        checked={Boolean(formValues[field])}
                        onChange={e => handleFormValueChange(field, e.target.checked)}
                      />
                      <span style={{ fontSize: '13px' }}>{formValues[field] ? 'True / Active' : 'False / Disabled'}</span>
                    </div>
                  ) : (
                    <input
                      type="text"
                      value={formValues[field] !== undefined ? formValues[field] : ''}
                      onChange={e => handleFormValueChange(field, e.target.value)}
                    />
                  )}
                </div>
              ))}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={handleCloseModals} disabled={actionLoading}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleSaveUpdate} disabled={actionLoading}>
                {actionLoading ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Form Modal */}
      {isCreateOpen && (
        <div className="modal-backdrop" onClick={handleCloseModals}>
          <div className="modal-dialog" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Create New Record</h3>
              <button className="icon-btn" onClick={handleCloseModals}>✕</button>
            </div>
            <div className="modal-body">
              {getCreateFields().map(field => (
                <div key={field} className="form-group">
                  <label>{humanizeHeader(field)}</label>
                  {typeof formValues[field] === 'boolean' ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <input
                        type="checkbox"
                        checked={Boolean(formValues[field])}
                        onChange={e => handleFormValueChange(field, e.target.checked)}
                      />
                      <span style={{ fontSize: '13px' }}>{formValues[field] ? 'True / Active' : 'False / Disabled'}</span>
                    </div>
                  ) : (
                    <input
                      type="text"
                      value={formValues[field] !== undefined ? formValues[field] : ''}
                      onChange={e => handleFormValueChange(field, e.target.value)}
                      placeholder={`Enter ${humanizeHeader(field).toLowerCase()}...`}
                    />
                  )}
                </div>
              ))}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={handleCloseModals} disabled={actionLoading}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleSaveCreate} disabled={actionLoading}>
                {actionLoading ? 'Creating...' : 'Create Item'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* View Details Modal */}
      {viewingRow && (
        <div className="modal-backdrop" onClick={handleCloseModals}>
          <div className="modal-dialog" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Record Details (ID: {viewingRow.id})</h3>
              <button className="icon-btn" onClick={handleCloseModals}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {Object.keys(viewingRow).map(key => (
                  <div key={key} style={{ display: 'flex', borderBottom: '1px solid #f1f5f9', paddingBottom: '6px' }}>
                    <strong style={{ width: '160px', fontSize: '12px', color: '#475569' }}>{humanizeHeader(key)}:</strong>
                    <span style={{ fontSize: '13px', color: '#1e293b', wordBreak: 'break-all' }}>
                      {typeof viewingRow[key] === 'object' ? JSON.stringify(viewingRow[key]) : String(viewingRow[key] ?? '—')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={handleCloseModals}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  // 4. Hoisted Function Definitions
  function handleAutoFetch() {
    if (canList) {
      fetchListData();
    }
  }

  function handleSearchChange(e: React.ChangeEvent<HTMLInputElement>) {
    setSearchQuery(e.target.value);
    setCurrentPage(1);
  }

  function handleClearSearch() {
    setSearchQuery('');
    setCurrentPage(1);
  }

  function handleRefresh() {
    fetchListData();
  }

  function handlePageSizeChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setPageSize(Number(e.target.value));
    setCurrentPage(1);
  }

  function handlePrevPage() {
    setCurrentPage(prev => Math.max(1, prev - 1));
  }

  function handleNextPage() {
    setCurrentPage(prev => Math.min(totalPages, prev + 1));
  }

  function handleOpenEdit(row: any) {
    setEditingRow(row);
    const initialForm: Record<string, any> = {};
    const editableFields = getEditableFields(row);
    editableFields.forEach(f => {
      initialForm[f] = row[f] !== undefined ? row[f] : '';
    });
    setFormValues(initialForm);
  }

  function handleOpenCreate() {
    setIsCreateOpen(true);
    const initialForm: Record<string, any> = {};
    getCreateFields().forEach(f => {
      initialForm[f] = '';
    });
    setFormValues(initialForm);
  }

  function handleOpenView(row: any) {
    setViewingRow(row);
  }

  function handleCloseModals() {
    setEditingRow(null);
    setViewingRow(null);
    setIsCreateOpen(false);
    setFormValues({});
  }

  function handleFormValueChange(field: string, val: any) {
    setFormValues(prev => ({
      ...prev,
      [field]: val
    }));
  }

  async function fetchListData() {
    setLoading(true);
    addLog(`Fetching list for "${parameters.target_object}"...`);
    try {
      const res = await callBackend('list');
      const dataList = Array.isArray(res) ? res : (res?.data || []);
      setItems(dataList);
      addLog(`Loaded ${dataList.length} items.`);
    } catch (err: any) {
      console.error(err);
      addLog(`Failed to fetch items: ${err.message || String(err)}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveUpdate() {
    if (!editingRow) return;
    setActionLoading(true);
    addLog(`Updating ID: ${editingRow.id}...`);
    try {
      await callBackend('update', {
        id: String(editingRow.id),
        body: formValues
      });
      addLog(`Update completed for ${editingRow.id}.`);
      handleCloseModals();
      fetchListData();
    } catch (err: any) {
      console.error(err);
      addLog(`Update failed for ${editingRow.id}: ${err.message || String(err)}`);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleSaveCreate() {
    setActionLoading(true);
    addLog(`Creating item...`);
    try {
      await callBackend('create', {
        body: formValues
      });
      addLog(`Create completed.`);
      handleCloseModals();
      fetchListData();
    } catch (err: any) {
      console.error(err);
      addLog(`Create failed: ${err.message || String(err)}`);
    } finally {
      setActionLoading(false);
    }
  }

  function getEditableFields(row: any): string[] {
    if (updateOp?.fields && updateOp.fields.length > 0 && !updateOp.fields.includes('*')) {
      return updateOp.fields.filter(f => f !== 'id');
    }
    return Object.keys(row).filter(f => f !== 'id' && f !== 'can' && typeof row[f] !== 'function');
  }

  function getCreateFields(): string[] {
    if (createOp?.fields && createOp.fields.length > 0 && !createOp.fields.includes('*')) {
      return createOp.fields.filter(f => f !== 'id');
    }
    return columns.filter(col => col !== 'id');
  }

  function humanizeHeader(key: string): string {
    if (!key) return '';
    if (key.toLowerCase() === 'id') return 'ID';
    return key
      .replace(/_/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/\b\w/g, char => char.toUpperCase());
  }

  function renderCellValue(val: any) {
    if (typeof val === 'boolean') {
      return <span className={`value-pill value-pill-${val}`}>{String(val)}</span>;
    }
    if (val === null || val === undefined) {
      return <span style={{ color: '#94a3b8' }}>—</span>;
    }
    if (typeof val === 'object') {
      const str = JSON.stringify(val);
      return (
        <span title={str} style={{ color: '#64748b', cursor: 'help', fontSize: '11px', fontFamily: 'inherit' }}>
          {Array.isArray(val) ? `[${val.length} items]` : '{...}'}
        </span>
      );
    }
    return String(val);
  }
};

export default CRUDWorkflow;
