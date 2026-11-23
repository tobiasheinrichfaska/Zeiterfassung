import {
  CURVE_ENTRIES,
  D50,
  SRGB_COLORANTS,
  keepSupported,
  srgbIccProfile,
  srgbToLinear,
} from '../src/logic/index.ts';

const profile = srgbIccProfile();
const view = new DataView(profile.buffer, profile.byteOffset, profile.byteLength);
const sig = (at: number): string => String.fromCharCode(...profile.slice(at, at + 4));
const s15 = (at: number): number => view.getInt32(at) / 65536;

function tags(): Record<string, { offset: number; size: number }> {
  const out: Record<string, { offset: number; size: number }> = {};
  const count = view.getUint32(128);
  for (let i = 0; i < count; i += 1) {
    const at = 132 + i * 12;
    out[sig(at)] = { offset: view.getUint32(at + 4), size: view.getUint32(at + 8) };
  }
  return out;
}

describe('the sRGB profile', () => {
  it('has a valid ICC header for a display RGB profile', () => {
    expect(view.getUint32(0)).toBe(profile.length);
    expect(profile.length % 4).toBe(0);
    expect(view.getUint32(8)).toBe(0x02100000);
    expect(sig(12)).toBe('mntr');
    expect(sig(16)).toBe('RGB ');
    expect(sig(20)).toBe('XYZ ');
    expect(sig(36)).toBe('acsp');
    expect(view.getUint32(64)).toBe(0); // perceptual
    expect([s15(68), s15(72), s15(76)]).toEqual(
      [D50[0], D50[1], D50[2]].map((v) => Math.round(v * 65536) / 65536),
    );
    expect([...profile.slice(100, 128)].every((b) => b === 0)).toBe(true); // reserved
  });

  it('lists nine tags that lie inside the file, 4-byte aligned', () => {
    const t = tags();
    expect(Object.keys(t).sort()).toEqual([
      'bTRC',
      'bXYZ',
      'cprt',
      'desc',
      'gTRC',
      'gXYZ',
      'rTRC',
      'rXYZ',
      'wtpt',
    ]);
    for (const [name, { offset, size }] of Object.entries(t)) {
      expect(offset % 4, name).toBe(0);
      expect(offset + size, name).toBeLessThanOrEqual(profile.length);
      expect(offset, name).toBeGreaterThanOrEqual(132 + 9 * 12);
    }
    const last = Math.max(...Object.values(t).map((x) => x.offset + x.size));
    expect(last).toBe(profile.length);
  });

  it('shares one curve for red, green and blue', () => {
    const t = tags();
    expect(t.gTRC).toEqual(t.rTRC);
    expect(t.bTRC).toEqual(t.rTRC);
  });

  it('has the colorants and the white point, and the colorants add up to the white point', () => {
    const t = tags();
    const xyz = (name: string) => [
      s15((t[name]?.offset ?? 0) + 8),
      s15((t[name]?.offset ?? 0) + 12),
      s15((t[name]?.offset ?? 0) + 16),
    ];
    expect(sig(t.rXYZ?.offset ?? 0)).toBe('XYZ ');
    const r = xyz('rXYZ');
    const g = xyz('gXYZ');
    const b = xyz('bXYZ');
    const w = xyz('wtpt');
    SRGB_COLORANTS.red.forEach((v, i) => expect(r[i]).toBeCloseTo(v, 4));
    SRGB_COLORANTS.green.forEach((v, i) => expect(g[i]).toBeCloseTo(v, 4));
    SRGB_COLORANTS.blue.forEach((v, i) => expect(b[i]).toBeCloseTo(v, 4));
    D50.forEach((v, i) => expect(w[i]).toBeCloseTo(v, 4));
    for (let i = 0; i < 3; i += 1)
      expect((r[i] ?? 0) + (g[i] ?? 0) + (b[i] ?? 0)).toBeCloseTo(w[i] ?? 0, 3);
  });

  it('has a monotonic transfer curve from 0 to 65535', () => {
    const at = tags().rTRC?.offset ?? 0;
    expect(sig(at)).toBe('curv');
    expect(view.getUint32(at + 8)).toBe(CURVE_ENTRIES);
    const values = Array.from({ length: CURVE_ENTRIES }, (_, i) => view.getUint16(at + 12 + i * 2));
    expect(values[0]).toBe(0);
    expect(values.at(-1)).toBe(65535);
    for (let i = 1; i < values.length; i += 1)
      expect(values[i]).toBeGreaterThanOrEqual(values[i - 1] ?? 0);
    // the sRGB curve: mid-grey 0.5 is about 0.2140 in linear light
    expect(srgbToLinear(0.5)).toBeCloseTo(0.214, 3);
    expect((values[Math.round(0.5 * (CURVE_ENTRIES - 1))] ?? 0) / 65535).toBeCloseTo(0.214, 2);
  });

  it('reads the descriptions as text', () => {
    const t = tags();
    expect(sig(t.desc?.offset ?? 0)).toBe('desc');
    expect(sig(t.cprt?.offset ?? 0)).toBe('text');
  });

  it('is the same bytes every time', () => {
    expect(srgbIccProfile()).toEqual(profile);
  });
});

describe('keepSupported', () => {
  const latin = (cp: number) => cp >= 0x20 && cp <= 0xff;

  it('keeps supported characters and replaces each other one by „?“', () => {
    expect(keepSupported('Ärztin ß', latin)).toBe('Ärztin ß');
    expect(keepSupported('a→b', latin)).toBe('a?b');
    expect(keepSupported('x😀y', latin)).toBe('x?y'); // an emoji is one character
    expect(keepSupported('日本', latin)).toBe('??');
    expect(keepSupported('', latin)).toBe('');
  });

  it('can use another replacement and does not touch anything else', () => {
    expect(keepSupported('a→b', latin, '_')).toBe('a_b');
    expect(keepSupported('  ', latin)).toBe('  ');
  });

  it('treats a lone surrogate as one unsupported character', () => {
    expect(keepSupported('a\uD800b', latin)).toBe('a?b');
  });
});
