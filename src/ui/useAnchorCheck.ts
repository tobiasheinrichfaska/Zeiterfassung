import { useEffect, useState } from 'react';
import type { Anchor } from '../logic/index.ts';
import { checkAnchors } from '../io/anchorCheck.ts';

/** How many of the stored external time stamps fail the check of their token (0 until checked). Never blocks. */
export function useAnchorCheck(anchors: readonly Anchor[]): number {
  const [failed, setFailed] = useState(0);
  useEffect(() => {
    let live = true;
    void checkAnchors(anchors).then((check) => {
      if (live) setFailed(check.failed);
    });
    return () => {
      live = false;
    };
  }, [anchors]);
  return failed;
}
