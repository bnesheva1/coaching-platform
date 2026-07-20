import React from 'react';

export function Input({ placeholder = '', value, onChange, helperText, search = false, onSearch }) {
  const [focused, setFocused] = React.useState(false);
  if (search) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', width: '100%' }}>
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
            background: 'var(--bg-surface)', border: `1px solid ${focused ? 'var(--accent)' : 'var(--border-default)'}`,
            borderRadius: 'var(--radius-lg)', padding: '6px 6px 6px 20px',
            boxShadow: focused ? '0 0 0 4px var(--focus-ring)' : 'var(--shadow-sm)',
            transition: 'border-color var(--duration-fast) var(--ease-standard), box-shadow var(--duration-fast) var(--ease-standard)',
          }}
        >
          <input
            value={value}
            onChange={onChange}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={placeholder}
            style={{
              flex: 1, border: 'none', outline: 'none', background: 'transparent',
              font: 'var(--text-body-lg)', color: 'var(--text-primary)', fontFamily: 'var(--font-ui)',
            }}
          />
          <button
            type="button" onClick={onSearch} aria-label="Търсене"
            style={{
              width: 44, height: 44, borderRadius: 'var(--radius-md)', border: 'none', flex: 'none',
              background: 'var(--accent)', color: 'var(--text-on-accent)', fontSize: 18, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >→</button>
        </div>
        {helperText && <span style={{ font: 'var(--text-caption)', color: 'var(--text-tertiary)', paddingLeft: 4 }}>{helperText}</span>}
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', width: '100%' }}>
      <input
        value={value}
        onChange={onChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        style={{
          font: 'var(--text-body-md)', fontFamily: 'var(--font-ui)', color: 'var(--text-primary)',
          background: 'var(--bg-surface)', border: `1px solid ${focused ? 'var(--accent)' : 'var(--border-default)'}`,
          borderRadius: 'var(--radius-md)', padding: '11px 16px', outline: 'none',
          boxShadow: focused ? '0 0 0 4px var(--focus-ring)' : 'none',
          transition: 'border-color var(--duration-fast) var(--ease-standard), box-shadow var(--duration-fast) var(--ease-standard)',
        }}
      />
      {helperText && <span style={{ font: 'var(--text-caption)', color: 'var(--text-tertiary)' }}>{helperText}</span>}
    </div>
  );
}
