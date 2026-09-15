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

export const WorkflowGroupsManager: React.FC<WorkflowComponentProps> = ({
  label,
  parameters,
  extensionSDK,
  addLog,
  callBackend
}) => {
  // 1. Hook Declarations (State & Memos)
  const [activeTab, setActiveTab] = useState<'landing' | 'scope_audit' | 'access_matrix' | 'provisioning'>('landing');

  // Audit state
  const [loading, setLoading] = useState<boolean>(true);
  const [auditData, setAuditData] = useState<any | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<boolean>(false);

  // Drilldown Modal state
  const [drillModalCategory, setDrillModalCategory] = useState<'0' | '1' | '2+' | null>(null);
  const [drillSearchTerm, setDrillSearchTerm] = useState<string>('');

  // Provisioning Form state
  const [newGroupName, setNewGroupName] = useState<string>('');
  const [selectedAttrForNewGroup, setSelectedAttrForNewGroup] = useState<string>(
    parameters?.default_attribute_name || 'nano_admin_is_workflow_scope_group'
  );
  const [selectedUserIdsForNewGroup, setSelectedUserIdsForNewGroup] = useState<string[]>([]);
  const [userSearchInProvisioning, setUserSearchInProvisioning] = useState<string>('');

  // Collapsible Passed Checks state
  const [showPassedChecks, setShowPassedChecks] = useState<boolean>(false);

  const defaultAttributeName = auditData?.default_attribute_name || parameters?.default_attribute_name || 'nano_admin_is_workflow_scope_group';
  const healthChecks = auditData?.health_checks || [];
  const incompleteChecks = useMemo(() => healthChecks.filter((c: any) => !c.passed), [healthChecks]);
  const passedChecks = useMemo(() => healthChecks.filter((c: any) => c.passed), [healthChecks]);

  const firstFailedCheck = incompleteChecks.length > 0 ? incompleteChecks[0] : null;
  const remainingFailedChecks = incompleteChecks.length > 1 ? incompleteChecks.slice(1) : [];

  const hostOrigin = (extensionSDK as any)?.lookerHostData?.hostUrl || (extensionSDK as any)?.hostUrl || '';
  const ideHref = hostOrigin ? `${hostOrigin}/projects/nano_admin/files/index.md` : '/projects/nano_admin/files/index.md';
  const groupsHref = hostOrigin ? `${hostOrigin}/admin/groups` : '/admin/groups';

  const userDistribution = auditData?.user_scope_distribution || {
    total_active_users: 0,
    unscoped_count: 0,
    isolated_count: 0,
    overlapping_count: 0,
    bucket_0: [],
    bucket_1: [],
    bucket_2plus: []
  };

  const userMisconfigurations = auditData?.user_misconfigurations || [];

  const allAvailableUsers = useMemo(() => {
    const list0 = userDistribution.bucket_0 || [];
    const list1 = userDistribution.bucket_1 || [];
    const list2 = userDistribution.bucket_2plus || [];
    return [...list0, ...list1, ...list2];
  }, [userDistribution]);

  const filteredProvisionUsers = useMemo(() => {
    if (!userSearchInProvisioning.trim()) return allAvailableUsers;
    const term = userSearchInProvisioning.toLowerCase();
    return allAvailableUsers.filter((u: any) =>
      String(u.name || '').toLowerCase().includes(term) ||
      String(u.email || '').toLowerCase().includes(term) ||
      String(u.id || '').toLowerCase().includes(term)
    );
  }, [allAvailableUsers, userSearchInProvisioning]);

  const drillModalUsers = useMemo(() => {
    if (!drillModalCategory) return [];
    let list: any[] = [];
    if (drillModalCategory === '0') list = userDistribution.bucket_0 || [];
    else if (drillModalCategory === '1') list = userDistribution.bucket_1 || [];
    else if (drillModalCategory === '2+') list = userDistribution.bucket_2plus || [];

    if (!drillSearchTerm.trim()) return list;
    const term = drillSearchTerm.toLowerCase();
    return list.filter((u: any) =>
      String(u.name || '').toLowerCase().includes(term) ||
      String(u.email || '').toLowerCase().includes(term) ||
      String(u.id || '').toLowerCase().includes(term)
    );
  }, [drillModalCategory, drillSearchTerm, userDistribution]);

  // 2. Effects
  useEffect(handleFetchAudit, []);

  // 3. Component JSX
  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: '#64748b', fontFamily: 'Inter, system-ui, sans-serif' }}>
        <div style={{
          width: '32px', height: '32px', border: '3px solid #e2e8f0', borderTopColor: '#2563eb',
          borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px auto'
        }} />
        <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
        <p style={{ margin: 0, fontSize: '13px', fontWeight: 500 }}>Auditing group and scope configurations...</p>
      </div>
    );
  }

  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto', fontFamily: 'Inter, system-ui, sans-serif', color: '#1e293b' }}>
      {/* Top Header */}
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#0f172a' }}>
          {label || 'Workflow Groups Manager'}
        </h1>
        <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#64748b' }}>
          Audit Looker Scope Groups and Workflow Access controls.
        </p>
      </div>

      {errorMsg && (
        <div style={{ padding: '12px 16px', borderRadius: '8px', background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', marginBottom: '20px', fontSize: '13px' }}>
          <strong>Audit Error:</strong> {errorMsg}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '4px', borderBottom: '1px solid #e2e8f0', marginBottom: '24px' }}>
        <button
          onClick={handleTabLanding}
          style={getTabStyle(activeTab === 'landing')}
        >
          Setup Health {incompleteChecks.length > 0 && <span style={badgeStyle}>{incompleteChecks.length}</span>}
        </button>
        <button
          onClick={handleTabScopeAudit}
          style={getTabStyle(activeTab === 'scope_audit')}
        >
          Scope Groups {userMisconfigurations.length > 0 && <span style={{ ...badgeStyle, background: '#dc2626' }}>!</span>}
        </button>
        <button
          onClick={handleTabAccessMatrix}
          style={getTabStyle(activeTab === 'access_matrix')}
        >
          Workflow Access
        </button>
        <button
          onClick={handleTabProvisioning}
          style={getTabStyle(activeTab === 'provisioning')}
        >
          Provisioning
        </button>
      </div>

      {/* Tab 1: Landing / Setup Health */}
      {activeTab === 'landing' && (
        <div>
          {/* Action Header bar with Refresh button inside tab content */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>
              System Health Overview
            </h2>
            <button
              onClick={handleRefresh}
              disabled={actionLoading}
              style={secondaryButtonStyle}
            >
              Refresh Audit
            </button>
          </div>

          {!errorMsg && auditData && healthChecks.length > 0 && incompleteChecks.length === 0 ? (
            <div style={{ padding: '20px 24px', borderRadius: '8px', background: '#f0fdf4', border: '1px solid #bbf7d0', marginBottom: '24px' }}>
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#166534' }}>
                Setup Healthy
              </h3>
              <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#15803d' }}>
                All {healthChecks.length} Scope Group checks passed cleanly.
              </p>
            </div>
          ) : (
            incompleteChecks.length > 0 && (
              <div style={{ marginBottom: '24px' }}>
                {/* 1. Primary Recommended Next Step (First Failed Check) */}
                {firstFailedCheck && (
                  <div style={{
                    padding: '20px', borderRadius: '8px', background: '#f8fafc',
                    border: '1px solid #cbd5e1', borderLeft: '5px solid #2563eb', marginBottom: '20px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                      <span style={{
                        background: '#2563eb', color: '#ffffff', fontSize: '10px',
                        fontWeight: 700, padding: '2px 8px', borderRadius: '4px', textTransform: 'uppercase'
                      }}>
                        RECOMMENDED NEXT STEP
                      </span>
                      <span style={{ fontSize: '12px', fontWeight: 600, color: '#64748b' }}>
                        Step 1 of {incompleteChecks.length} Incomplete Item(s)
                      </span>
                    </div>

                    <h3 style={{ margin: '0 0 6px 0', fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>
                      {firstFailedCheck.title}
                    </h3>
                    <p style={{ margin: '0 0 10px 0', fontSize: '13px', color: '#334155', lineHeight: 1.4 }}>
                      {firstFailedCheck.description}
                    </p>
                    {firstFailedCheck.recommendation && (
                      <p style={{ margin: '0 0 14px 0', fontSize: '13px', fontWeight: 600, color: '#1d4ed8' }}>
                        Action: {firstFailedCheck.recommendation}
                      </p>
                    )}

                    <div>
                      {renderCheckActionButton(firstFailedCheck, true)}
                    </div>
                  </div>
                )}

                {/* 2. Remaining Incomplete Checks */}
                {remainingFailedChecks.length > 0 && (
                  <div>
                    <h3 style={{ fontSize: '13px', fontWeight: 700, color: '#475569', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Additional Incomplete Items ({remainingFailedChecks.length})
                    </h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {remainingFailedChecks.map((check: any) => (
                        <div
                          key={check.id}
                          style={{
                            padding: '14px 18px', borderRadius: '8px', background: '#ffffff',
                            border: '1px solid #e2e8f0', borderLeft: '4px solid #dc2626',
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px'
                          }}
                        >
                          <div>
                            <h4 style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: '#0f172a' }}>
                              {check.title}
                            </h4>
                            <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: '#64748b' }}>
                              {check.description}
                            </p>
                          </div>

                          <div>
                            {renderCheckActionButton(check, false)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          )}

          {/* Collapsible Passed Checks */}
          {passedChecks.length > 0 && (
            <div style={{ borderRadius: '8px', border: '1px solid #e2e8f0', background: '#f8fafc', overflow: 'hidden' }}>
              <button
                onClick={handleTogglePassedChecks}
                style={{
                  width: '100%', padding: '12px 16px', background: '#f8fafc', border: 'none',
                  textAlign: 'left', cursor: 'pointer', display: 'flex', justifyContent: 'space-between',
                  alignItems: 'center', fontSize: '13px', fontWeight: 600, color: '#475569'
                }}
              >
                <span>{showPassedChecks ? 'Hide' : 'Show'} Passed System Checks ({passedChecks.length})</span>
                <span style={{ fontSize: '12px', color: '#16a34a', fontWeight: 600 }}>Verified</span>
              </button>

              {showPassedChecks && (
                <div style={{ padding: '0 16px 14px 16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {passedChecks.map((check: any) => (
                    <div
                      key={check.id}
                      style={{
                        padding: '10px 14px', borderRadius: '6px', background: '#ffffff',
                        border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '10px'
                      }}
                    >
                      <span style={{ color: '#16a34a', fontWeight: 700, fontSize: '11px' }}>PASSED</span>
                      <div>
                        <span style={{ fontSize: '13px', fontWeight: 600, color: '#1e293b' }}>{check.title}</span>
                        <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: '#64748b' }}>{check.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Scope Groups Audit */}
      {activeTab === 'scope_audit' && (
        <div>
          {/* Header inside tab content */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>
              Scope Group Audit & User Coverage
            </h2>
            <button
              onClick={handleRefresh}
              disabled={actionLoading}
              style={secondaryButtonStyle}
            >
              Refresh Audit
            </button>
          </div>

          {/* User-Level Misconfigurations Alert */}
          {userMisconfigurations.length > 0 && (
            <div style={{ padding: '16px 20px', borderRadius: '8px', background: '#fff1f2', border: '1px solid #fecdd3', marginBottom: '24px' }}>
              <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: '#9f1239' }}>
                Misconfiguration Flagged: Scope Attribute Set at User Level
              </h3>
              <p style={{ margin: '4px 0 12px 0', fontSize: '13px', color: '#881337' }}>
                Scope group attributes should only be set on Looker Groups. Found {userMisconfigurations.length} user-level attribute override(s).
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {userMisconfigurations.map((item: any) => (
                  <div key={`${item.user_id}-${item.attribute_id}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#ffffff', padding: '8px 12px', borderRadius: '6px', border: '1px solid #fda4af' }}>
                    <span style={{ fontSize: '12px', color: '#334155' }}>
                      <strong>{item.user_name}</strong> ({item.user_email}) — Attribute: <code>{item.attribute_name}</code> = <code>{item.value}</code>
                    </span>
                    <button
                      onClick={() => handleRemoveUserOverride(item.user_id, item.attribute_id)}
                      disabled={actionLoading}
                      style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid #dc2626', background: '#fff', color: '#dc2626', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}
                    >
                      Remove Override
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Drillable User Scope Counts */}
          <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#334155', marginBottom: '12px' }}>
            User Scope Distribution ({userDistribution.total_active_users} Active Users)
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '24px' }}>
            {/* 0 Scope Groups */}
            <div
              onClick={() => handleOpenDrillModal('0')}
              style={{ ...statCardStyle, borderTop: '4px solid #d97706' }}
            >
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#64748b' }}>0 Scope Groups (Unscoped)</div>
              <div style={{ fontSize: '28px', fontWeight: 800, color: '#d97706', margin: '4px 0' }}>{userDistribution.unscoped_count}</div>
              <div style={{ fontSize: '11px', color: '#94a3b8' }}>Click to view unscoped users</div>
            </div>

            {/* 1 Scope Group */}
            <div
              onClick={() => handleOpenDrillModal('1')}
              style={{ ...statCardStyle, borderTop: '4px solid #059669' }}
            >
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#64748b' }}>1 Scope Group (Isolated)</div>
              <div style={{ fontSize: '28px', fontWeight: 800, color: '#059669', margin: '4px 0' }}>{userDistribution.isolated_count}</div>
              <div style={{ fontSize: '11px', color: '#94a3b8' }}>Click to view isolated users</div>
            </div>

            {/* 2+ Scope Groups */}
            <div
              onClick={() => handleOpenDrillModal('2+')}
              style={{ ...statCardStyle, borderTop: '4px solid #2563eb' }}
            >
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#64748b' }}>2+ Scope Groups (Overlapping)</div>
              <div style={{ fontSize: '28px', fontWeight: 800, color: '#2563eb', margin: '4px 0' }}>{userDistribution.overlapping_count}</div>
              <div style={{ fontSize: '11px', color: '#94a3b8' }}>Click to view multi-scope users</div>
            </div>
          </div>

          {/* Scope Groups List per Monitored Attribute */}
          <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#334155', marginBottom: '12px' }}>
            Configured Scope Group Attributes
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {(auditData?.scope_attributes || []).map((attr: any) => (
              <div key={attr.attribute_name} style={{ borderRadius: '8px', border: '1px solid #e2e8f0', background: '#ffffff', padding: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <div>
                    <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: '#0f172a' }}>
                      <code>{attr.attribute_name}</code>
                    </h4>
                    <span style={{ fontSize: '12px', color: '#64748b' }}>
                      {attr.exists ? `Attribute defined in Looker` : `Not found in Looker`}
                    </span>
                  </div>
                  {attr.exists ? (
                    <span style={{ fontSize: '12px', fontWeight: 600, color: '#059669', background: '#ecfdf5', padding: '4px 8px', borderRadius: '4px' }}>
                      {attr.groups_yes_count} Active Scope Group(s)
                    </span>
                  ) : (
                    <button
                      onClick={handleCreateDefaultAttribute}
                      disabled={actionLoading}
                      style={primaryButtonStyle}
                    >
                      Create Attribute
                    </button>
                  )}
                </div>

                {/* Used by Workflows listing */}
                <div style={{ marginBottom: '14px', padding: '8px 12px', borderRadius: '6px', background: '#f8fafc', border: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '12px', fontWeight: 600, color: '#475569' }}>Used by Workflows:</span>
                  {attr.used_by_workflows && attr.used_by_workflows.length > 0 ? (
                    attr.used_by_workflows.map((wf: any) => (
                      <span
                        key={wf.id}
                        style={{
                          padding: '2px 8px', borderRadius: '4px', background: '#ffffff',
                          color: '#1e293b', border: '1px solid #cbd5e1', fontSize: '11px', fontWeight: 600
                        }}
                      >
                        {wf.label} (<code>{wf.template}</code>)
                      </span>
                    ))
                  ) : (
                    <span style={{ fontSize: '12px', color: '#94a3b8', fontStyle: 'italic' }}>None configured in index.md</span>
                  )}
                </div>

                {/* Tagged Groups Table */}
                {attr.tagged_groups && attr.tagged_groups.length > 0 ? (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                    <thead>
                      <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', textAlign: 'left', color: '#64748b' }}>
                        <th style={{ padding: '8px' }}>Group Name</th>
                        <th style={{ padding: '8px' }}>Scope Status</th>
                        <th style={{ padding: '8px' }}>Assigned Members</th>
                        <th style={{ padding: '8px', textAlign: 'right' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {attr.tagged_groups.map((g: any) => (
                        <tr key={g.group_id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '8px', fontWeight: 600 }}>{g.group_name}</td>
                          <td style={{ padding: '8px' }}>
                            {g.is_active_scope ? (
                              <span style={{ color: '#16a34a', fontWeight: 600 }}>Active ('yes')</span>
                            ) : (
                              <span style={{ color: '#94a3b8' }}>Inactive ('{g.value || 'none'}')</span>
                            )}
                          </td>
                          <td style={{ padding: '8px' }}>{g.user_count} user(s)</td>
                          <td style={{ padding: '8px', textAlign: 'right' }}>
                            <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end', alignItems: 'center' }}>
                              <button
                                onClick={() => handleToggleScope(g.group_id, attr.attribute_name, !g.is_active_scope)}
                                disabled={actionLoading}
                                style={{
                                  padding: '4px 8px', borderRadius: '4px', border: '1px solid #cbd5e1',
                                  background: '#fff', fontSize: '11px', fontWeight: 600, cursor: 'pointer'
                                }}
                              >
                                {g.is_active_scope ? 'Disable Scope' : 'Enable Scope'}
                              </button>
                              <a
                                href={hostOrigin ? `${hostOrigin}/admin/groups/${g.group_id}` : `/admin/groups/${g.group_id}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => navigateToLookerPath(`/admin/groups/${g.group_id}`, e)}
                                style={{
                                  padding: '4px 8px', borderRadius: '4px', border: '1px solid #cbd5e1',
                                  background: '#f8fafc', color: '#334155', fontSize: '11px', fontWeight: 600,
                                  textDecoration: 'none', display: 'inline-flex', alignItems: 'center'
                                }}
                              >
                                Looker Group Admin
                              </a>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p style={{ margin: 0, fontSize: '12px', color: '#94a3b8' }}>No Looker groups currently tagged with this attribute.</p>
                )}

                {/* Warning for user-level attribute overrides */}
                {(() => {
                  const attrUserMisconfigs = (userMisconfigurations || []).filter(
                    (item: any) => item.attribute_name === attr.attribute_name || item.attribute_id === attr.attribute_id
                  );
                  if (attrUserMisconfigs.length === 0) return null;
                  return (
                    <div style={{ marginTop: '14px', padding: '12px 14px', borderRadius: '6px', background: '#fff1f2', border: '1px solid #fecdd3' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                        <strong style={{ fontSize: '12px', fontWeight: 700, color: '#9f1239' }}>
                          Warning: Attribute Assigned at User Level ({attrUserMisconfigs.length})
                        </strong>
                      </div>
                      <p style={{ margin: '0 0 8px 0', fontSize: '12px', color: '#881337' }}>
                        Scope group attributes should only be assigned to Looker Groups. The following user account(s) have direct user-level attribute overrides that bypass group control:
                      </p>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {attrUserMisconfigs.map((item: any) => (
                          <div
                            key={`${item.user_id}-${item.attribute_id}`}
                            style={{
                              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                              background: '#ffffff', padding: '6px 10px', borderRadius: '4px', border: '1px solid #fda4af'
                            }}
                          >
                            <span style={{ fontSize: '12px', color: '#334155' }}>
                              <strong>{item.user_name}</strong> ({item.user_email}) — Value: <code>{item.value}</code>
                            </span>
                            <button
                              onClick={() => handleRemoveUserOverride(item.user_id, item.attribute_id)}
                              disabled={actionLoading}
                              style={{
                                padding: '3px 8px', borderRadius: '4px', border: '1px solid #dc2626',
                                background: '#fff', color: '#dc2626', fontSize: '11px', fontWeight: 600, cursor: 'pointer'
                              }}
                            >
                              Remove Override
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab 3: Workflow Access Matrix */}
      {activeTab === 'access_matrix' && (
        <div>
          {/* Header inside tab content */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>
              Workflow Access Matrix (authorized_groups)
            </h2>
            <button
              onClick={handleRefresh}
              disabled={actionLoading}
              style={secondaryButtonStyle}
            >
              Refresh Audit
            </button>
          </div>

          <div style={{ borderRadius: '8px', border: '1px solid #e2e8f0', background: '#ffffff', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', textAlign: 'left', color: '#64748b' }}>
                  <th style={{ padding: '12px' }}>Workflow Label</th>
                  <th style={{ padding: '12px' }}>Template</th>
                  <th style={{ padding: '12px' }}>Access Mode</th>
                  <th style={{ padding: '12px' }}>Authorized Looker Groups</th>
                </tr>
              </thead>
              <tbody>
                {(auditData?.workflow_access_matrix || []).map((wf: any) => (
                  <tr key={wf.workflow_id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '12px', fontWeight: 600 }}>{wf.workflow_label}</td>
                    <td style={{ padding: '12px', color: '#64748b' }}><code>{wf.template}</code></td>
                    <td style={{ padding: '12px' }}>
                      {wf.has_auth_groups ? (
                        <span style={{ color: '#2563eb', fontWeight: 600 }}>Restricted</span>
                      ) : (
                        <span style={{ color: '#d97706', fontWeight: 600 }}>Unrestricted (All Users)</span>
                      )}
                    </td>
                    <td style={{ padding: '12px' }}>
                      {wf.authorized_groups && wf.authorized_groups.length > 0 ? (
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                          {wf.authorized_groups.map((g: any) => (
                            <span
                              key={g.group_id}
                              style={{
                                padding: '2px 8px', borderRadius: '4px', fontSize: '12px',
                                background: g.exists ? (g.user_count > 0 ? '#eff6ff' : '#fffbe6') : '#fef2f2',
                                color: g.exists ? (g.user_count > 0 ? '#1d4ed8' : '#b45309') : '#991b1b',
                                border: '1px solid #cbd5e1'
                              }}
                            >
                              {g.group_name} ({g.user_count} members) {!g.exists && '[Invalid Group ID]'}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span style={{ color: '#94a3b8' }}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 4: Provisioning */}
      {activeTab === 'provisioning' && (
        <div style={{ maxWidth: '680px' }}>
          {/* Header inside tab content */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>
              Provision New Scope Group
            </h2>
            <button
              onClick={handleRefresh}
              disabled={actionLoading}
              style={secondaryButtonStyle}
            >
              Refresh Audit
            </button>
          </div>

          <div style={{ padding: '20px', borderRadius: '8px', border: '1px solid #e2e8f0', background: '#ffffff', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                Group Name
              </label>
              <input
                type="text"
                placeholder="e.g. Scope - West Region Users"
                value={newGroupName}
                onChange={handleNewGroupNameChange}
                style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                Scope Attribute
              </label>
              <select
                value={selectedAttrForNewGroup}
                onChange={handleSelectedAttrChange}
                style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px' }}
              >
                {(auditData?.monitored_attribute_names || [defaultAttributeName]).map((attrName: string) => (
                  <option key={attrName} value={attrName}>{attrName}</option>
                ))}
              </select>
            </div>

            {/* Assign Initial Members Section */}
            <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569' }}>
                    Assign Initial Group Members ({selectedUserIdsForNewGroup.length} selected)
                  </label>
                  <span style={{ fontSize: '11px', color: '#64748b' }}>
                    Select user accounts to add to this scope group upon creation.
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    type="button"
                    onClick={handleSelectUnscopedUsers}
                    style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid #cbd5e1', background: '#f8fafc', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}
                  >
                    Select Unscoped ({userDistribution.unscoped_count})
                  </button>
                  <button
                    type="button"
                    onClick={handleToggleSelectAllUsers}
                    style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid #cbd5e1', background: '#f8fafc', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}
                  >
                    {selectedUserIdsForNewGroup.length === allAvailableUsers.length ? 'Clear All' : 'Select All'}
                  </button>
                </div>
              </div>

              <input
                type="text"
                placeholder="Filter users by name or email..."
                value={userSearchInProvisioning}
                onChange={handleUserSearchInProvisioningChange}
                style={{ width: '100%', padding: '6px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '12px', marginBottom: '8px' }}
              />

              <div style={{ maxHeight: '200px', overflowY: 'auto', border: '1px solid #cbd5e1', borderRadius: '6px', background: '#fafafa' }}>
                {filteredProvisionUsers.length > 0 ? (
                  filteredProvisionUsers.map((u: any) => {
                    const isSelected = selectedUserIdsForNewGroup.includes(u.id);
                    return (
                      <label
                        key={u.id}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px',
                          borderBottom: '1px solid #f1f5f9', cursor: 'pointer', background: isSelected ? '#eff6ff' : 'transparent'
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleUserSelection(u.id)}
                        />
                        <div style={{ fontSize: '12px', flex: 1 }}>
                          <span style={{ fontWeight: 600, color: '#1e293b' }}>{u.name}</span>
                          <span style={{ color: '#64748b', marginLeft: '6px' }}>({u.email})</span>
                        </div>
                        <span style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '4px', background: u.scope_count === 0 ? '#fef3c7' : '#e0e7ff', color: u.scope_count === 0 ? '#92400e' : '#3730a3', fontWeight: 600 }}>
                          {u.scope_count === 0 ? 'Unscoped' : `${u.scope_count} scope(s)`}
                        </span>
                      </label>
                    );
                  })
                ) : (
                  <div style={{ padding: '16px', textAlign: 'center', fontSize: '12px', color: '#94a3b8' }}>
                    No users match search.
                  </div>
                )}
              </div>
            </div>

            <button
              onClick={handleCreateGroupSubmit}
              disabled={actionLoading || !newGroupName.trim()}
              style={{ ...primaryButtonStyle, marginTop: '8px' }}
            >
              {actionLoading ? 'Creating Group...' : `Create and Enable Scope Group (${selectedUserIdsForNewGroup.length} members)`}
            </button>
          </div>
        </div>
      )}

      {/* Drilldown Modal */}
      {drillModalCategory && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#ffffff', borderRadius: '10px', padding: '24px', width: '600px', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700 }}>
                Users in {drillModalCategory} Scope Groups ({drillModalUsers.length})
              </h3>
              <button onClick={handleCloseDrillModal} style={{ border: 'none', background: 'none', fontSize: '14px', fontWeight: 700, cursor: 'pointer', color: '#64748b' }}>Close</button>
            </div>

            <input
              type="text"
              placeholder="Search user name or email..."
              value={drillSearchTerm}
              onChange={handleDrillSearchChange}
              style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px', marginBottom: '12px' }}
            />

            <div style={{ overflowY: 'auto', flex: 1, border: '1px solid #e2e8f0', borderRadius: '6px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', textAlign: 'left' }}>
                    <th style={{ padding: '8px' }}>User</th>
                    <th style={{ padding: '8px' }}>Scope Groups</th>
                  </tr>
                </thead>
                <tbody>
                  {drillModalUsers.map((u: any) => (
                    <tr key={u.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '8px' }}>
                        <div style={{ fontWeight: 600 }}>{u.name}</div>
                        <div style={{ fontSize: '11px', color: '#64748b' }}>{u.email}</div>
                      </td>
                      <td style={{ padding: '8px' }}>
                        {u.scope_groups && u.scope_groups.length > 0 ? (
                          u.scope_groups.map((gName: string) => (
                            <span key={gName} style={{ display: 'inline-block', padding: '2px 6px', background: '#eff6ff', color: '#1d4ed8', borderRadius: '4px', margin: '2px', fontSize: '11px' }}>
                              {gName}
                            </span>
                          ))
                        ) : (
                          <span style={{ color: '#94a3b8' }}>None</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  // 4. Hoisted Function Implementations
  function navigateToLookerPath(path: string, event?: React.MouseEvent) {
    if (event) {
      // Handle Ctrl / Cmd / Shift click or middle click
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.button === 1) {
        if (extensionSDK && typeof extensionSDK.openBrowserWindow === 'function') {
          event.preventDefault();
          extensionSDK.openBrowserWindow(path, '_blank');
          return;
        }
      }
      event.preventDefault();
    }

    // Normal click: navigate host window cleanly using extensionSDK
    if (extensionSDK && typeof extensionSDK.updateLocation === 'function') {
      try {
        extensionSDK.updateLocation(path);
        return;
      } catch (err) {
        // Fallback below
      }
    }

    if (extensionSDK && typeof extensionSDK.openBrowserWindow === 'function') {
      extensionSDK.openBrowserWindow(path, '_blank');
      return;
    }

    window.open(path, '_blank');
  }

  function renderCheckActionButton(check: any, isPrimary: boolean) {
    const btnLinkStyle = isPrimary ? primaryBtnLinkStyle : secondaryBtnLinkStyle;
    const buttonStyle = isPrimary ? primaryButtonStyle : secondaryButtonStyle;

    switch (check.id) {
      case 'no_compatible_templates':
      case 'no_scope_workflows':
      case 'no_workflows_with_auth_groups':
      case 'invalid_auth_groups':
        return (
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <a
              href={ideHref}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => navigateToLookerPath('/projects/nano_admin/files/index.md', e)}
              style={btnLinkStyle}
            >
              Open index.md in IDE
            </a>
            <button onClick={handleTabAccessMatrix} style={secondaryButtonStyle}>
              Review Access Matrix
            </button>
          </div>
        );
      case 'missing_user_attributes':
        return (
          <button
            onClick={handleCreateDefaultAttribute}
            disabled={actionLoading}
            style={buttonStyle}
          >
            Create Attribute
          </button>
        );
      case 'no_groups_tagged':
      case 'no_groups_yes':
      case 'no_users_in_scope_groups':
        return (
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button onClick={handleTabProvisioning} style={buttonStyle}>
              Provision Scope Group
            </button>
            <a
              href={groupsHref}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => navigateToLookerPath('/admin/groups', e)}
              style={secondaryBtnLinkStyle}
            >
              Looker Groups Admin
            </a>
          </div>
        );
      case 'empty_auth_groups':
        return (
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button onClick={handleTabAccessMatrix} style={buttonStyle}>
              Review Access Matrix
            </button>
            <a
              href={groupsHref}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => navigateToLookerPath('/admin/groups', e)}
              style={secondaryBtnLinkStyle}
            >
              Looker Groups Admin
            </a>
          </div>
        );

      default:
        return null;
    }
  }

  function handleFetchAudit() {
    setLoading(true);
    setErrorMsg(null);
    callBackend('get_groups_audit')
      .then((res) => {
        setAuditData(res);
        setLoading(false);
        const health = res?.health_checks || [];
        const incomplete = health.filter((c: any) => !c.passed);
        if (incomplete.length > 0) {
          setActiveTab('landing');
        } else {
          setActiveTab('scope_audit');
        }
      })
      .catch((err) => {
        setErrorMsg(err.message || 'Failed to fetch groups audit data.');
        setLoading(false);
      });
  }

  function handleRefresh() {
    handleFetchAudit();
  }

  function handleTabLanding() {
    setActiveTab('landing');
  }
  function handleTabScopeAudit() {
    setActiveTab('scope_audit');
  }
  function handleTabAccessMatrix() {
    setActiveTab('access_matrix');
  }
  function handleTabProvisioning() {
    setActiveTab('provisioning');
  }

  function handleTogglePassedChecks() {
    setShowPassedChecks(!showPassedChecks);
  }

  function handleCreateDefaultAttribute() {
    setActionLoading(true);
    callBackend('create_user_attribute', { attribute_name: defaultAttributeName })
      .then(() => {
        addLog(`Created user attribute ${defaultAttributeName}`);
        handleFetchAudit();
      })
      .catch((err) => setErrorMsg(err.message || 'Failed to create user attribute.'))
      .finally(() => setActionLoading(false));
  }

  function handleToggleScope(groupId: string, attributeName: string, enable: boolean) {
    setActionLoading(true);
    callBackend('toggle_group_scope', { group_id: groupId, attribute_name: attributeName, enable })
      .then(() => handleFetchAudit())
      .catch((err) => setErrorMsg(err.message || 'Failed to update scope attribute.'))
      .finally(() => setActionLoading(false));
  }

  function handleRemoveUserOverride(userId: string, attributeId: string) {
    setActionLoading(true);
    callBackend('remove_user_attribute_override', { user_id: userId, attribute_id: attributeId })
      .then(() => handleFetchAudit())
      .catch((err) => setErrorMsg(err.message || 'Failed to remove user override.'))
      .finally(() => setActionLoading(false));
  }

  function handleNewGroupNameChange(e: React.ChangeEvent<HTMLInputElement>) {
    setNewGroupName(e.target.value);
  }

  function handleSelectedAttrChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setSelectedAttrForNewGroup(e.target.value);
  }

  function handleUserSearchInProvisioningChange(e: React.ChangeEvent<HTMLInputElement>) {
    setUserSearchInProvisioning(e.target.value);
  }

  function handleToggleUserSelection(userId: string) {
    setSelectedUserIdsForNewGroup((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  }

  function handleSelectUnscopedUsers() {
    const unscoped = userDistribution.bucket_0 || [];
    const unscopedIds = unscoped.map((u: any) => String(u.id));
    setSelectedUserIdsForNewGroup(Array.from(new Set([...selectedUserIdsForNewGroup, ...unscopedIds])));
  }

  function handleToggleSelectAllUsers() {
    if (selectedUserIdsForNewGroup.length === allAvailableUsers.length) {
      setSelectedUserIdsForNewGroup([]);
    } else {
      setSelectedUserIdsForNewGroup(allAvailableUsers.map((u: any) => String(u.id)));
    }
  }

  function handleCreateGroupSubmit() {
    if (!newGroupName.trim()) return;
    setActionLoading(true);
    callBackend('create_scope_group', {
      group_name: newGroupName.trim(),
      attribute_name: selectedAttrForNewGroup,
      user_ids: selectedUserIdsForNewGroup
    })
      .then(() => {
        setNewGroupName('');
        setSelectedUserIdsForNewGroup([]);
        setActiveTab('scope_audit');
        handleFetchAudit();
      })
      .catch((err) => setErrorMsg(err.message || 'Failed to create group.'))
      .finally(() => setActionLoading(false));
  }

  function handleOpenDrillModal(category: '0' | '1' | '2+') {
    setDrillModalCategory(category);
    setDrillSearchTerm('');
  }

  function handleCloseDrillModal() {
    setDrillModalCategory(null);
  }

  function handleDrillSearchChange(e: React.ChangeEvent<HTMLInputElement>) {
    setDrillSearchTerm(e.target.value);
  }
};

const getTabStyle = (active: boolean): React.CSSProperties => ({
  padding: '10px 16px',
  background: 'transparent',
  border: 'none',
  borderBottom: active ? '3px solid #2563eb' : '3px solid transparent',
  color: active ? '#2563eb' : '#64748b',
  fontWeight: active ? 700 : 500,
  fontSize: '13px',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: '6px'
});

const badgeStyle: React.CSSProperties = {
  background: '#dc2626',
  color: '#ffffff',
  fontSize: '11px',
  fontWeight: 700,
  padding: '2px 6px',
  borderRadius: '10px'
};

const primaryButtonStyle: React.CSSProperties = {
  padding: '8px 14px',
  borderRadius: '6px',
  background: '#2563eb',
  color: '#ffffff',
  border: 'none',
  fontSize: '13px',
  fontWeight: 600,
  cursor: 'pointer'
};

const secondaryButtonStyle: React.CSSProperties = {
  padding: '8px 14px',
  borderRadius: '6px',
  background: '#ffffff',
  color: '#334155',
  border: '1px solid #cbd5e1',
  fontSize: '13px',
  fontWeight: 600,
  cursor: 'pointer'
};

const primaryBtnLinkStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '8px 16px',
  borderRadius: '6px',
  background: '#2563eb',
  color: '#ffffff',
  fontSize: '13px',
  fontWeight: 600,
  textDecoration: 'none',
  cursor: 'pointer'
};

const secondaryBtnLinkStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '8px 16px',
  borderRadius: '6px',
  background: '#ffffff',
  color: '#334155',
  border: '1px solid #cbd5e1',
  fontSize: '13px',
  fontWeight: 600,
  textDecoration: 'none',
  cursor: 'pointer'
};

const statCardStyle: React.CSSProperties = {
  padding: '16px',
  borderRadius: '8px',
  background: '#ffffff',
  border: '1px solid #e2e8f0',
  cursor: 'pointer',
  transition: 'transform 0.1s ease'
};

export default WorkflowGroupsManager;
