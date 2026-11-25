import { REASON_TEXTS, clockWarningText, reasonText, type Reason } from '../src/logic/index.ts';

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

describe('clock warning text', () => {
  it('is null within 30 seconds', () => {
    expect(clockWarningText(0)).toBeNull();
    expect(clockWarningText(30_000)).toBeNull();
    expect(clockWarningText(-30_000)).toBeNull();
    expect(clockWarningText(Number.NaN)).toBeNull();
  });
  it('says seconds under a minute and minutes from then on', () => {
    expect(clockWarningText(-45_000)).toBe(
      'Die Uhr dieses Geräts geht 45 Sekunden vor – bitte die Uhrzeit des Geräts stellen.',
    );
    expect(clockWarningText(5 * 60_000)).toBe(
      'Die Uhr dieses Geräts geht 5 Minuten nach – bitte die Uhrzeit des Geräts stellen.',
    );
    expect(clockWarningText(-60_000)).toContain('1 Minute vor');
  });
});
