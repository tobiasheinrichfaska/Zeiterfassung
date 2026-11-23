import { nodesWithPage, pagesIn, pathTo } from 'rad-navi';
import { JUMP_NODE, PAGES, TREE } from '../src/ui/navigation.ts';

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
