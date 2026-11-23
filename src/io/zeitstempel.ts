// The one place that names where the Zeitstempel library (RFC 3161 reader and verifier) and its data come
// from. The package is pinned to a commit (see CLAUDE.md); it has no build and no tag yet, so its source
// and data files are read from the installed package directly. Once a tag with a build is approved, only
// this file changes (import from 'zeitstempel' instead).
import {
  verifyTimestampToken,
  fromBase64Url,
  readServices,
} from '../../node_modules/zeitstempel/src/lib/index.ts';
import servicesData from '../../node_modules/zeitstempel/services.json';

export { verifyTimestampToken, fromBase64Url };

const pems = import.meta.glob('../../node_modules/zeitstempel/anchors/*.pem', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** The trust anchors of every service the app knows, by the service id the relay uses. */
export function trustedServices(): Map<
  string,
  { name: string; qualified: boolean; anchors: string[] }
> {
  const read = readServices(servicesData);
  const out = new Map<string, { name: string; qualified: boolean; anchors: string[] }>();
  if (!read.ok) return out;
  for (const s of read.value) {
    const anchors = s.anchors.map(
      (file) => Object.entries(pems).find(([path]) => path.endsWith(`/${file}`))?.[1],
    );
    if (anchors.length > 0 && anchors.every((a): a is string => typeof a === 'string')) {
      out.set(s.id, { name: s.name, qualified: s.qualified, anchors });
    }
  }
  return out;
}
