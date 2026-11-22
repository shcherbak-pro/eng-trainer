import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCatalog } from '../../content/catalog';
import { realMaterials } from '../../test/content';
import { resetDatabase } from '../../test/database';

/**
 * English study text is kept out of browser translation; interface copy stays translatable
 * (ENG-V2-UX-01B-RC1, F5). Effective values are read from the DOM: `translate` is inherited,
 * and the language is the nearest `lang` attribute.
 */
const cleanups: (() => void)[] = [];
const lang = (element: Element) => element.closest('[lang]')?.getAttribute('lang') ?? null;

async function mount(load: () => Promise<{ default: unknown }>, props: Record<string, unknown>) {
  vi.resetModules();
  const svelte = await import('svelte');
  const state = await import('../../state');
  await state.initState();
  const root = document.createElement('main');
  root.setAttribute('lang', 'en');
  document.body.appendChild(root);
  const component = svelte.mount((await load()).default as Parameters<typeof svelte.mount>[0], { target: root, props });
  svelte.flushSync();
  cleanups.push(() => {
    svelte.unmount(component);
    root.remove();
  });
  return { root, flush: () => svelte.flushSync() };
}

beforeEach(() => resetDatabase());
afterEach(() => cleanups.splice(0).forEach((close) => close()));

describe('study text and browser translation', () => {
  it('Answers: English questions and answers are protected; the introduction is not', async () => {
    const page = await mount(() => import('./AnswersPage.svelte'), { answers: realMaterials.answers });
    const questions = [...page.root.querySelectorAll<HTMLElement>('.reading-card h2')];
    expect(questions).toHaveLength(realMaterials.answers.length);
    for (const question of questions) {
      expect(question.translate).toBe(false);
      expect(lang(question)).toBe('en');
    }
    expect(page.root.querySelector<HTMLElement>('.reading-card__english')!.translate).toBe(false);
    expect(page.root.querySelector<HTMLElement>('.page-stack > p.muted')!.translate).toBe(true);
  });

  it('Speaking prompts: the current prompt and every listed prompt are protected; the hint and headings are not', async () => {
    const page = await mount(() => import('./PracticePage.svelte'), { drills: realMaterials.drills });
    const hint = page.root.querySelector<HTMLElement>('.prompt-card__text')!;
    expect(hint.textContent).toContain('Random prompt');
    expect(hint.translate).toBe(true);

    page.root.querySelector<HTMLButtonElement>('.prompt-card button')!.click();
    page.flush();
    const prompt = page.root.querySelector<HTMLElement>('.prompt-card__text')!;
    expect(realMaterials.drills).toContain(prompt.textContent);
    expect(prompt.translate).toBe(false);
    expect(lang(prompt)).toBe('en');
    // The announcement region stays in place around the prompt.
    expect(prompt.closest('[aria-live="polite"]')).not.toBeNull();

    const listed = [...page.root.querySelectorAll<HTMLElement>('.drill-list li')];
    expect(listed).toHaveLength(realMaterials.drills.length);
    expect(listed.every((item) => item.translate === false && lang(item) === 'en')).toBe(true);
    expect(page.root.querySelector<HTMLElement>('.entry-group > h2')!.translate).toBe(true);
    expect(page.root.querySelector<HTMLElement>('.prompt-card button')!.translate).toBe(true);
  });

  it('Reverse practice: the prompt is the exercise and is protected, whatever its language; labels are not', async () => {
    const page = await mount(() => import('./ReversePracticePage.svelte'), { catalog: createCatalog(realMaterials) });
    const prompt = page.root.querySelector<HTMLElement>('.reverse-card__prompt')!;
    expect(prompt.translate).toBe(false);
    expect(lang(prompt)).toBe('uk');
    expect(page.root.querySelector<HTMLElement>('.field__label')!.translate).toBe(true);
  });
});
