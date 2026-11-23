import { nodesWithPage, pagesIn, pathTo } from 'rad-navi';
import { JUMP_NODE, PAGES, TREE } from '../src/ui/navigation.ts';
import { Z } from '../src/ui/styles.ts';

describe('navigation tree', () => {
  it('has a node for every page and a page for every node', () => {
    expect([...pagesIn(TREE)].sort()).toEqual(Object.keys(PAGES).sort());
    for (const page of Object.keys(PAGES)) expect(nodesWithPage(TREE, page)).toHaveLength(1);
  });

  it('has areas Erfassen, Monat and Einstellungen', () => {
    expect((TREE.children ?? []).map((a) => a.name)).toEqual([
      'Erfassen',
      'Monat',
      'Einstellungen',
    ]);
  });

  it('jumps to an existing page node', () => {
    expect(pathTo(TREE, JUMP_NODE).length).toBe(3);
  });

  it('has unique node ids', () => {
    const ids: string[] = [];
    const walk = (n: typeof TREE): void => {
      ids.push(n.id);
      (n.children ?? []).forEach(walk);
    };
    walk(TREE);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('stacking order', () => {
  it('keeps the error banner above the prompt and the prompt above the wheel frame', async () => {
    const { readFileSync } = await import('node:fs');
    const frame = readFileSync('node_modules/rad-navi/dist/ui/Frame.js', 'utf8');
    const wheelZ = Number(/zIndex:\s*(\d+)/.exec(frame)?.[1]);
    expect(wheelZ).toBe(Z.wheel);
    expect(Z.prompt).toBeGreaterThan(Z.wheel);
    expect(Z.banner).toBeGreaterThan(Z.prompt);
  });
});
