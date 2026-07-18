import React from 'react';

const SIZES = {
  sm: { padY: '7px', padX: '14px', font: 'var(--text-body-sm)', radius: 'var(--radius-sm)' },
  md: { padY: '10px', padX: '20px', font: '600 14px/1.2 var(--font-ui)', radius: 'var(--radius-md)' },
  lg: { padY: '13px', padX: '26px', font: '600 16px/1.2 var(--font-ui)', radius: 'var(--radius-md)' },
};

const VARIANTS = {
  primary: {
    background: 'var(--accent)', color: 'var(--text-on-accent)', border: '1px solid transparent',
  },
  secondary: {
    background: 'transparent', color: 'var(--text-primary)', border: '1px solid var(--border-strong)',
  },
  ghost: {
    background: 'transparent', color: 'var(--text-primary)', border: '1px solid transparent',
  },
};

const HOVER = {
  primary: { background: 'var(--accent-hover)' },
  secondary: { background: 'var(--bg-surface-2)' },
  ghost: { background: 'var(--bg-surface-2)' },
};

export function Button({ variant = 'primary', size = 'md', disabled = false, children, onClick, type = 'button' }) {
  const s = SIZES[size] || SIZES.md;
  const v = VARIANTS[variant] || VARIANTS.primary;
  const [hover, setHover] = React.useState(false);
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        fontFamily: 'var(--font-ui)',
        font: s.font,
        padding: `${s.padY} ${s.padX}`,
        borderRadius: s.radius,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'background var(--duration-fast) var(--ease-standard), border-color var(--duration-fast) var(--ease-standard)',
        whiteSpace: 'nowrap',
        ...v,
        ...(hover && !disabled ? HOVER[variant] : {}),
      }}
    >
      {children}
    </button>
  );
}
