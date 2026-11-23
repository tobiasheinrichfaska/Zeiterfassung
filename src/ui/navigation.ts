import { areaNode, distributor, type PageTable, type WheelTexts } from 'rad-navi';

/** The pages of the app by page id (names are the German labels on the wheels). */
export const PAGES: PageTable = {
  stempeln: { name: 'Stempeln' },
  tag: { name: 'Tag eingeben' },
  monat: { name: 'Monat' },
  einstellungen: { name: 'Einstellungen' },
  sicherung: { name: 'Sicherung' },
};

/** Areas below, their pages above (data; a new page is a new entry here and in the page renderer). */
export const TREE = distributor('wurzel', 'Zeiterfassung', [
  areaNode(PAGES, 'erfassen', 'Erfassen', ['stempeln', 'tag']),
  areaNode(PAGES, 'monatsbereich', 'Monat', ['monat']),
  areaNode(PAGES, 'verwalten', 'Einstellungen', ['einstellungen', 'sicherung']),
]);

/** The node the lower hub jumps to: the stamp page. */
export const JUMP_NODE = 'erfassen/stempeln';

export const WHEEL_TEXTS: Partial<WheelTexts> = {
  navigation: 'Navigation',
  path: 'Pfad',
  jumpToTarget: 'Zur Stempel-Seite springen',
  planned: ' (geplant)',
  neighbour: (name) => `Daneben: ${name}`,
  backTo: (name) => `Zurück zu ${name}`,
  placeholderPlanned: 'Diese Seite ist geplant und kommt später.',
  placeholder: (name) => `Die Seite „${name}“ folgt.`,
  backButton: (name) => `↩ Zurück zu ${name}`,
};
