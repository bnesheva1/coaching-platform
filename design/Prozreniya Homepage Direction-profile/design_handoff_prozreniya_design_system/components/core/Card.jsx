import React from 'react';

export function Card({ eyebrow, title, description, footer, tone = 'surface' }) {
  const bg = tone === 'inverse' ? 'var(--bg-inverse)' : 'var(--bg-surface)';
  const color = tone === 'inverse' ? 'var(--text-on-inverse)' : 'var(--text-primary)';
  return (
    <div
      style={{
        background: bg, color, border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-xl)',
        padding: 'var(--space-8)', boxShadow: 'var(--shadow-md)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)',
      }}
    >
      {eyebrow && (
        <span style={{ font: 'var(--text-overline)', letterSpacing: 'var(--letter-overline)', textTransform: 'uppercase', color: 'var(--accent)' }}>
          {eyebrow}
        </span>
      )}
      {title && <h3 style={{ margin: 0, font: 'var(--text-heading-lg)' }}>{title}</h3>}
      {description && <p style={{ margin: 0, font: 'var(--text-body-md)', color: tone === 'inverse' ? 'var(--text-secondary)' : 'var(--text-secondary)' }}>{description}</p>}
      {footer && <div style={{ marginTop: 'var(--space-3)' }}>{footer}</div>}
    </div>
  );
}
