import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { VaultGate } from 'local-vault';
import { App } from './ui/App.tsx';
import { BookProvider } from './ui/BookProvider.tsx';
import { AnchorProvider } from './ui/AnchorProvider.tsx';
import { RunningPdfProvider } from './ui/RunningPdfProvider.tsx';
import { DraftProvider } from './ui/DraftProvider.tsx';
import { PromptProvider } from './ui/PromptProvider.tsx';
import { vault } from './ui/vault.ts';

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');
createRoot(root).render(
  <StrictMode>
    <VaultGate vault={vault}>
      <BookProvider vault={vault}>
        <DraftProvider vault={vault}>
          <PromptProvider>
            <AnchorProvider vault={vault}>
              <RunningPdfProvider vault={vault}>
                <App />
              </RunningPdfProvider>
            </AnchorProvider>
          </PromptProvider>
        </DraftProvider>
      </BookProvider>
    </VaultGate>
  </StrictMode>,
);
