// The one place that names where the Zeitstempel library (RFC 3161 reader, verifier and relay client) and
// its data come from. The package comes by Git tag (built on install); its data files (`services.json`,
// `anchors/*.pem`) are not in the package's exports, so they are read from the installed package by path.
import { verifyTimestampToken, fromBase64Url, readServices } from 'zeitstempel';
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
