/**
 * An sRGB colour profile (ICC version 2.1, matrix/TRC, display class) generated from the published
 * sRGB primaries (adapted to the D50 white point of the profile connection space) and the sRGB transfer
 * curve. It is our own work from public numbers, not a copy of any vendor's profile file, so there is no
 * third-party licence to carry. The PDF/A output intent embeds it. Not validated by an ICC tool.
 */

/** The sRGB colorants, Bradford-adapted to D50 (CIE XYZ), as published for ICC profiles. */
export const SRGB_COLORANTS = {
  red: [0.4360747, 0.2225045, 0.0139322],
  green: [0.3850649, 0.7168786, 0.0971045],
  blue: [0.1430804, 0.0606169, 0.7141733],
} as const;
/** The D50 white point of the profile connection space. */
export const D50 = [0.9642, 1.0, 0.8249] as const;
/** Entries of the transfer curve table. */
export const CURVE_ENTRIES = 1024;

/** The sRGB transfer curve (decoding): encoded value 0..1 → linear light 0..1. */
export const srgbToLinear = (v: number): number =>
  v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;

const s15 = (x: number): number => Math.round(x * 65536);

const ascii = (text: string): number[] => [...text].map((c) => c.charCodeAt(0) & 0x7f);

class Bytes {
  readonly data: number[] = [];
  u8(v: number) {
    this.data.push(v & 0xff);
  }
  u16(v: number) {
    this.data.push((v >>> 8) & 0xff, v & 0xff);
  }
  u32(v: number) {
    this.data.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
  }
  s32(v: number) {
    this.u32(v < 0 ? v + 0x100000000 : v);
  }
  sig(s: string) {
    this.data.push(...ascii(s));
  }
  zeros(n: number) {
    for (let i = 0; i < n; i += 1) this.data.push(0);
  }
  pad4() {
    while (this.data.length % 4 !== 0) this.data.push(0);
  }
}

const textTag = (text: string): number[] => {
  const b = new Bytes();
  b.sig('text');
  b.u32(0);
  b.data.push(...ascii(text), 0);
  b.pad4();
  return b.data;
};

/** textDescriptionType of ICC v2: ASCII description, empty Unicode and Macintosh parts. */
const descTag = (text: string): number[] => {
  const b = new Bytes();
  b.sig('desc');
  b.u32(0);
  b.u32(text.length + 1);
  b.data.push(...ascii(text), 0);
  b.u32(0); // Unicode language code
  b.u32(0); // Unicode count
  b.u16(0); // ScriptCode code
  b.u8(0); // ScriptCode count
  b.zeros(67);
  b.pad4();
  return b.data;
};

const xyzTag = (xyz: readonly number[]): number[] => {
  const b = new Bytes();
  b.sig('XYZ ');
  b.u32(0);
  xyz.forEach((v) => b.s32(s15(v)));
  return b.data;
};

const curveTag = (): number[] => {
  const b = new Bytes();
  b.sig('curv');
  b.u32(0);
  b.u32(CURVE_ENTRIES);
  for (let i = 0; i < CURVE_ENTRIES; i += 1) {
    b.u16(Math.round(srgbToLinear(i / (CURVE_ENTRIES - 1)) * 65535));
  }
  b.pad4();
  return b.data;
};

/** The profile bytes; the same bytes on every call (a fixed date, no random parts). */
export function srgbIccProfile(): Uint8Array {
  const tags: [string, number[], string?][] = [
    ['cprt', textTag('No copyright, generated from public sRGB values')],
    ['desc', descTag('sRGB IEC61966-2.1 compatible (generated)')],
    ['wtpt', xyzTag(D50)],
    ['rXYZ', xyzTag(SRGB_COLORANTS.red)],
    ['gXYZ', xyzTag(SRGB_COLORANTS.green)],
    ['bXYZ', xyzTag(SRGB_COLORANTS.blue)],
    ['rTRC', curveTag()],
    ['gTRC', [], 'rTRC'], // the three curves share one table
    ['bTRC', [], 'rTRC'],
  ];
  const tableSize = 4 + tags.length * 12;
  let offset = 128 + tableSize;
  const placed = new Map<string, { offset: number; size: number }>();
  const entries = tags.map(([sig, data, same]) => {
    if (same) {
      const shared = placed.get(same);
      if (!shared) throw new Error('shared tag before its source');
      return { sig, ...shared, data: [] as number[] };
    }
    const entry = { offset, size: data.length };
    placed.set(sig, entry);
    offset += data.length;
    return { sig, ...entry, data };
  });

  const b = new Bytes();
  b.u32(offset); // profile size
  b.u32(0); // preferred CMM
  b.u32(0x02100000); // version 2.1.0
  b.sig('mntr');
  b.sig('RGB ');
  b.sig('XYZ ');
  [2026, 11, 23, 0, 0, 0].forEach((v) => b.u16(v)); // creation date
  b.sig('acsp');
  b.u32(0); // platform
  b.u32(0); // flags
  b.u32(0); // manufacturer
  b.u32(0); // model
  b.zeros(8); // attributes
  b.u32(0); // rendering intent: perceptual
  D50.forEach((v) => b.s32(s15(v))); // illuminant
  b.u32(0); // creator
  b.zeros(16); // profile ID (not computed)
  b.zeros(28); // reserved
  b.u32(tags.length);
  for (const e of entries) {
    b.sig(e.sig);
    b.u32(e.offset);
    b.u32(e.size);
  }
  for (const e of entries) b.data.push(...e.data);
  return Uint8Array.from(b.data);
}
