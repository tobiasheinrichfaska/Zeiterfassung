import { REASON_TEXTS, reasonText, type Reason } from '../src/logic/index.ts';

describe('reason texts', () => {
  it('has a non-empty German text for every code', () => {
    for (const [code, text] of Object.entries(REASON_TEXTS)) {
      expect(text.length, code).toBeGreaterThan(10);
      expect(text, code).not.toBe(code);
    }
  });

  it('falls back to the code for an unknown one', () => {
    expect(reasonText('nope' as Reason)).toBe('nope');
  });
});
