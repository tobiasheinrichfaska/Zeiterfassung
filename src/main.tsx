import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { VaultGate } from 'local-vault';
import { App } from './ui/App.tsx';
import { BookProvider } from './ui/BookProvider.tsx';
import { vault } from './ui/vault.ts';

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');
createRoot(root).render(
  <StrictMode>
    <VaultGate vault={vault}>
      <BookProvider vault={vault}>
        <App />
      </BookProvider>
    </VaultGate>
  </StrictMode>,
);
