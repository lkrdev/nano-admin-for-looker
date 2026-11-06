import React from 'react';

export const cardStyle: React.CSSProperties = {
  background: '#ffffff',
  border: '1px solid #e2e8f0',
  borderRadius: '8px',
  padding: '16px 20px',
  marginBottom: '16px'
};

export const primaryBtnStyle: React.CSSProperties = {
  padding: '7px 14px',
  borderRadius: '6px',
  background: '#2563eb',
  color: '#ffffff',
  border: 'none',
  fontSize: '13px',
  fontWeight: 600,
  cursor: 'pointer'
};

export const secondaryBtnStyle: React.CSSProperties = {
  padding: '7px 14px',
  borderRadius: '6px',
  background: '#ffffff',
  color: '#334155',
  border: '1px solid #cbd5e1',
  fontSize: '13px',
  fontWeight: 600,
  cursor: 'pointer'
};

export const dangerBtnStyle: React.CSSProperties = {
  padding: '7px 14px',
  borderRadius: '6px',
  background: '#ffffff',
  color: '#dc2626',
  border: '1px solid #fca5a5',
  fontSize: '13px',
  fontWeight: 600,
  cursor: 'pointer'
};

export const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  borderRadius: '6px',
  border: '1px solid #cbd5e1',
  fontSize: '13px',
  boxSizing: 'border-box'
};

export const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '12px',
  fontWeight: 600,
  color: '#475569',
  marginBottom: '4px'
};

export const pillStyle = (bg: string, color: string): React.CSSProperties => ({
  display: 'inline-block',
  padding: '2px 8px',
  borderRadius: '999px',
  fontSize: '11px',
  fontWeight: 600,
  background: bg,
  color
});

export const getTabButtonStyle = (active: boolean): React.CSSProperties => ({
  padding: '10px 16px',
  background: 'transparent',
  border: 'none',
  borderBottom: active ? '3px solid #2563eb' : '3px solid transparent',
  color: active ? '#2563eb' : '#64748b',
  fontWeight: active ? 700 : 500,
  fontSize: '13px',
  cursor: 'pointer'
});
