import type { ReactNode } from 'react';
import { WheelNav } from 'rad-navi';
import { useBookApi } from './bookContext.ts';
import { BackupPage } from './BackupPage.tsx';
import { FormPage } from './FormPage.tsx';
import { MonthPage } from './MonthPage.tsx';
import { SettingsPage } from './SettingsPage.tsx';
import { JUMP_NODE, PAGES, TREE, WHEEL_TEXTS } from './navigation.ts';
import { StampPage } from './StampPage.tsx';
import { styles } from './styles.ts';

/** The page of each page id; a page id without an entry shows the wheel's placeholder. */
const VIEWS: Record<string, () => ReactNode> = {
  stempeln: () => <StampPage />,
  tag: () => <FormPage />,
  monat: () => <MonthPage />,
  einstellungen: () => <SettingsPage />,
  sicherung: () => <BackupPage />,
};

export function App() {
  const { error, dismissError } = useBookApi();
  return (
    <>
      {error && (
        <div
          role="alert"
          style={{
            ...styles.error,
            position: 'fixed',
            top: 8,
            left: 8,
            right: 8,
            zIndex: 1000,
            background: 'Canvas',
            color: 'CanvasText',
          }}
        >
          {error}{' '}
          <button type="button" style={styles.button} onClick={dismissError}>
            Gelesen
          </button>
        </div>
      )}
      <WheelNav
        tree={TREE}
        pages={PAGES}
        pageFor={(page) => VIEWS[page]?.()}
        jumpTarget={() => JUMP_NODE}
        texts={WHEEL_TEXTS}
      />
    </>
  );
}
