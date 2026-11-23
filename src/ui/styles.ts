import type { CSSProperties } from 'react';

/** Plain inline styles that inherit the colours of the surrounding sheet (light and dark). */
export const styles = {
  page: { padding: '1rem', maxWidth: '40rem', margin: '0 auto', font: 'inherit' },
  card: {
    border: '1px solid currentColor',
    borderRadius: 8,
    padding: '0.75rem',
    margin: '0 0 1rem',
  },
  row: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' },
  button: {
    font: 'inherit',
    padding: '0.6rem 1rem',
    minHeight: 44,
    borderRadius: 8,
    border: '1px solid currentColor',
    background: 'transparent',
    color: 'inherit',
    cursor: 'pointer',
  },
  field: {
    font: 'inherit',
    padding: '0.4rem',
    minHeight: 36,
    color: 'inherit',
    background: 'transparent',
    border: '1px solid currentColor',
    borderRadius: 6,
  },
  label: { display: 'flex', flexDirection: 'column', gap: 2, margin: '0 0 0.6rem' },
  error: { border: '2px solid #c62828', borderRadius: 8, padding: '0.5rem 0.75rem' },
  table: { borderCollapse: 'collapse', width: '100%' },
  cell: { borderBottom: '1px solid rgba(128,128,128,0.4)', padding: '0.3rem', textAlign: 'left' },
} satisfies Record<string, CSSProperties>;
