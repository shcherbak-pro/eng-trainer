import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCatalog } from '../../content/catalog';
import { realMaterials } from '../../test/content';
import { resetDatabase, seedDatabase } from '../../test/database';

/** Keyboard focus when deleting a Learn Pass removes the button that opened the dialog (ENG-V2-UX-01B-RC1, F2). */
const pass = (id: string, name: string, createdAt: string) => ({ id, name, blockIds: ['start-answer'], createdAt, updatedAt: createdAt });
const cleanups: (() => void)[] = [];

async function mountManager() {
  vi.resetModules();
  const svelte = await import('svelte');
  const state = await import('../../state');
  const LearnPassManager = (await import('./LearnPassManager.svelte')).default;
  await state.initState();
  const main = document.createElement('main');
  main.id = 'main';
  main.tabIndex = -1;
  document.body.appendChild(main);
  const component = svelte.mount(LearnPassManager, { target: main, props: { catalog: createCatalog(realMaterials) } });
  svelte.flushSync();
  cleanups.push(() => {
    svelte.unmount(component);
    main.remove();
  });
  const settle = async () => {
    for (let round = 0; round < 30; round += 1) await Promise.resolve();
    svelte.flushSync();
  };
  const button = (label: string) =>
    [...main.querySelectorAll<HTMLButtonElement>('button')].find(
      (item) => item.getAttribute('aria-label') === label || (item.textContent ?? '').replace(/\s+/g, ' ').trim() === label
    ) ?? null;
  return {
    state,
    button,
    async press(label: string) {
      const target = button(label);
      if (!target) throw new Error(`No button "${label}"`);
      target.focus();
      target.click();
      svelte.flushSync();
      await settle();
    }
  };
}

beforeEach(() => resetDatabase());
afterEach(() => {
  cleanups.splice(0).forEach((close) => close());
  vi.restoreAllMocks();
});

describe('deleting a Learn Pass (F2)', () => {
  it('keeps focus on the opener when cancelled, then moves to the next pass and finally to Create a Learn Pass', async () => {
    await seedDatabase({ learnPasses: { alpha: pass('alpha', 'Alpha pass', '2026-01-01'), beta: pass('beta', 'Beta pass', '2026-01-02') } });
    const page = await mountManager();

    await page.press('Delete Alpha pass');
    expect(document.activeElement?.textContent?.trim()).toBe('Cancel');
    await page.press('Cancel');
    expect(document.activeElement).toBe(page.button('Delete Alpha pass'));

    await page.press('Delete Alpha pass');
    await page.press('Delete Learn Pass');
    expect(get(page.state.progress).learnPasses.map((item) => item.id)).toEqual(['beta']);
    expect(document.activeElement).toBe(page.button('Delete Beta pass'));

    await page.press('Delete Beta pass');
    await page.press('Delete Learn Pass');
    expect(get(page.state.progress).learnPasses).toEqual([]);
    expect(document.activeElement).toBe(page.button('Create a Learn Pass'));
    expect(document.activeElement).not.toBe(document.body);
  });

  it('after deleting the last pass in the list, focus goes to the pass before it', async () => {
    await seedDatabase({ learnPasses: { alpha: pass('alpha', 'Alpha pass', '2026-01-01'), beta: pass('beta', 'Beta pass', '2026-01-02') } });
    const page = await mountManager();
    await page.press('Delete Beta pass');
    await page.press('Delete Learn Pass');
    expect(document.activeElement).toBe(page.button('Delete Alpha pass'));
  });
});
