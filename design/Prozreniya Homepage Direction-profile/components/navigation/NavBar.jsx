import React from 'react';
import { Button } from '../core/Button.jsx';

export function NavBar({ lang = 'BG', links = ['За търсещи', 'За практици', 'Как работи'] }) {
  return (
    <nav
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 40px',
        borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-page)',
      }}
    >
      <div style={{ font: '700 21px/1 var(--font-display)', color: 'var(--text-primary)' }}>Прозрения</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 28, font: '500 14px/1 var(--font-ui)', color: 'var(--text-secondary)', marginLeft: 40 }}>
        {links.map((l) => <span key={l}>{l}</span>)}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <span style={{
          font: '600 13px/1 var(--font-ui)', letterSpacing: '.02em', padding: '6px 12px', borderRadius: 'var(--radius-pill)',
          border: '1px solid var(--border-strong)', color: 'var(--text-primary)', cursor: 'pointer',
        }}>{lang === 'BG' ? 'BG · EN' : 'EN · BG'}</span>
        <Button variant="ghost" size="sm">Вход</Button>
        <Button variant="primary" size="sm">Регистрация</Button>
      </div>
    </nav>
  );
}
