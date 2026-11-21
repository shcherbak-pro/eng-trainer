// ENG-V2-02B-RC1 Fable re-review — model-based check of shared-deck order preservation (F1).
// Copied into <disposable-copy>/src/review-fable-rc1/ and run with Vitest there.
//
// The real session functions are composed exactly as FlashcardsPage composes them
// (answer, shuffle, single-deck reset, Learn again), while collections are removed and
// reimported, cards are hidden/unhidden and the page is "reloaded". After every step an
// independent oracle checks the persisted order, the visible cursor and the absence of
// ghost cards. The same simulation is then run against deliberate mutants to show the
// oracle detects the original F1 defect and plausible incorrect fixes.
import { describe, expect, it } from 'vitest';
import { answerCard, preserveUnavailableCards, resolveSession, shuffleSession } from '../features/flashcards/flashcards';

type Session = { order: string[]; index: number };
type Preserve = (saved: Session | undefined, next: Session, available: ReadonlySet<string>) => Session;

function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const BUILT_IN = Array.from({ length: 8 }, (_, i) => `phrase-b${i}`);
const COLLECTIONS: Record<string, string[]> = {
  A: Array.from({ length: 6 }, (_, i) => `user:A:entry:${i}`),
  B: Array.from({ length: 4 }, (_, i) => `user:B:entry:${i}`),
  C: Array.from({ length: 3 }, (_, i) => `user:C:entry:${i}`)
};
// Topic deck = a subset that mixes built-in and both collections; the catalog's available
// set is always larger than the deck, as in the application.
const TOPIC = new Set([BUILT_IN[1], BUILT_IN[4], BUILT_IN[6], ...COLLECTIONS.A.filter((_, i) => i % 2 === 0), ...COLLECTIONS.B.slice(0, 2), COLLECTIONS.C[0]]);

type Violation = { step: number; op: string; rule: string; detail: string };
let restoredCursorCases = 0;

function simulate(seed: number, preserve: Preserve, deck: 'all' | 'topic', steps = 60): Violation[] {
  const random = rng(seed);
  const pick = <T,>(list: T[]) => list[Math.floor(random() * list.length)];
  const present: Record<string, boolean> = { A: true, B: true, C: false };
  const learned = new Set<string>();
  const hidden = new Set<string>();
  const inDeck = (id: string) => deck === 'all' || TOPIC.has(id);
  const canonical = () => [...BUILT_IN, ...COLLECTIONS.A, ...COLLECTIONS.B, ...COLLECTIONS.C];
  const isAvailable = (id: string) => !id.startsWith('user:') ? BUILT_IN.includes(id) : present[id.split(':')[1]];
  const available = () => new Set(canonical().filter(isAvailable));
  const deckCards = () => canonical().filter((id) => isAvailable(id) && inDeck(id));
  const learning = () => deckCards().filter((id) => !learned.has(id) && !hidden.has(id));
  // A saved order may start with stale IDs from older content; only absent user: IDs must survive.
  let saved: Session | undefined = random() < 0.5 ? undefined : (() => {
    const order = [...canonical().filter(inDeck), 'phrase-obsolete', ...(deck === 'topic' ? [BUILT_IN[0]] : [])];
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    return { order: order.filter((id) => !COLLECTIONS.C.includes(id)), index: Math.floor(random() * 5) };
  })();
  const violations: Violation[] = [];
  const view = () => resolveSession(saved, learning());
  const current = () => { const v = view(); return v.order[v.index]; };

  for (let step = 0; step < steps; step++) {
    const before = { saved, view: view(), learningSet: new Set(learning()), current: current() };
    const absentBefore = (saved?.order ?? []).filter((id) => id.startsWith('user:') && !isAvailable(id));
    const ops = ['again', 'again', 'know', 'shuffle', 'reset', 'learnAgain', 'toggle', 'toggle', 'hide', 'reload'];
    const op = pick(ops);
    let expectedCurrent: string | undefined | null = null; // null = not checked
    let cursorRule = 'cursor';
    let wrote = false;
    const fail = (rule: string, detail: unknown) => violations.push({ step, op, rule, detail: JSON.stringify(detail).slice(0, 300) });

    if (op === 'again' || op === 'know') {
      const v = before.view;
      if (!v.order.length) continue;
      const card = v.order[v.index];
      const next = answerCard(v, card, op);
      saved = preserve(saved, next, available());
      wrote = true;
      if (op === 'know') learned.add(card);
      const rest = op === 'know' ? v.order.filter((id) => id !== card) : v.order;
      expectedCurrent = op === 'again' ? v.order[(v.index + 1) % v.order.length] : (rest.length ? rest[v.index < rest.length ? v.index : 0] : undefined);
      // Oracle for answers: the persisted order keeps every surviving ID in place and only
      // drops cards that left the learning pool; new learning cards are appended.
      const nowLearning = new Set(learning());
      const kept = [...new Set(before.saved?.order ?? [])].filter((id) => (id.startsWith('user:') && !isAvailable(id)) || nowLearning.has(id));
      const appended = learning().filter((id) => !kept.includes(id));
      const expectedOrder = [...kept, ...appended];
      if (JSON.stringify(saved.order) !== JSON.stringify(expectedOrder)) fail('answer-order', { got: saved.order, expected: expectedOrder });
    } else if (op === 'shuffle') {
      const v = before.view;
      if (v.order.length < 2) continue;
      const shuffled = shuffleSession(v, random);
      saved = preserve(saved, shuffled, available());
      wrote = true;
      expectedCurrent = shuffled.order[0];
      const visible = resolveSession(saved, learning()).order;
      if (JSON.stringify(visible) !== JSON.stringify(shuffled.order)) fail('shuffle-visible-sequence', { visible, shuffled: shuffled.order });
    } else if (op === 'reset') {
      const deckIds = deckCards().filter((id) => !hidden.has(id));
      const learnedHere = deckIds.filter((id) => learned.has(id));
      if (!learnedHere.length) continue;
      const resetIds = new Set(deckIds);
      const resetSession = preserve(saved, { order: deckCards().filter((id) => resetIds.has(id)), index: 0 }, available());
      for (const id of learnedHere) learned.delete(id);
      saved = resetSession.order.some((id) => !available().has(id)) ? resetSession : undefined;
      wrote = true;
      expectedCurrent = deckIds[0];
      const visible = resolveSession(saved, learning()).order;
      if (JSON.stringify(visible) !== JSON.stringify(deckIds)) fail('reset-visible-sequence', { visible, deckIds });
    } else if (op === 'learnAgain') {
      const candidates = [...learned].filter((id) => isAvailable(id) && inDeck(id));
      if (!candidates.length) continue;
      learned.delete(pick(candidates));
    } else if (op === 'toggle') {
      const name = pick(['A', 'B', 'C']);
      const wasPresent = present[name];
      present[name] = !wasPresent;
      if (!wasPresent && before.current && saved) {
        // Reimport. The persisted cursor slot is saved.order[saved.index]. When that card was
        // the one on screen (the normal case after any answer during the absence), the
        // current card must not change. Otherwise the cursor resolves to the first visible
        // card at or after the persisted slot, which may be a restored card.
        const persisted = saved.order[saved.index];
        if (persisted === before.current) { expectedCurrent = before.current; cursorRule = 'cursor-no-jump-after-reimport'; }
        else {
          // Visible order = saved IDs still learning (saved order) + learning IDs not saved;
          // the cursor is the first visible card at or after the persisted slot, else wraps.
          const nowLearning = learning();
          const savedVisible = [...new Set(saved.order)].filter((id) => nowLearning.includes(id));
          const visible = [...savedVisible, ...nowLearning.filter((id) => !savedVisible.includes(id))];
          const k = [...new Set(saved.order.slice(0, saved.index))].filter((id) => nowLearning.includes(id)).length;
          expectedCurrent = visible[k < visible.length ? k : 0];
          cursorRule = 'cursor-restored-persisted-slot';
          restoredCursorCases++;
        }
      }
    } else if (op === 'hide') {
      const candidates = deckCards();
      const id = pick(candidates);
      if (hidden.has(id)) hidden.delete(id); else hidden.add(id);
    } else {
      expectedCurrent = before.current; // reload changes nothing
    }

    // Invariants after every step.
    const afterOrder = saved?.order ?? [];
    for (const id of absentBefore) if (!afterOrder.includes(id)) fail('absent-id-lost', id);
    if (wrote && before.saved) {
      // Absent IDs keep their relative order.
      const project = (order: string[]) => order.filter((id) => absentBefore.includes(id));
      if (JSON.stringify(project([...new Set(before.saved.order)])) !== JSON.stringify(project(afterOrder))) fail('absent-relative-order', { before: before.saved.order, after: afterOrder });
    }
    if (new Set(afterOrder).size !== afterOrder.length) fail('duplicate-slot', afterOrder);
    const v = view();
    for (const id of v.order) if (!isAvailable(id) || !learning().includes(id)) fail('ghost-card', id);
    if (expectedCurrent !== null && v.order[v.index] !== expectedCurrent) fail(cursorRule, { got: v.order[v.index], expected: expectedCurrent, op, saved: saved && { index: saved.index, at: saved.order[saved.index] } });
  }
  return violations;
}

const MUTANTS: Record<string, Preserve> = {
  'pre-RC1 (save the visible session directly)': (_saved, next) => next,
  'absent IDs moved to the end': (saved, next, available) => {
    const absent = [...new Set(saved?.order ?? [])].filter((id) => id.startsWith('user:') && !available.has(id));
    return { order: [...next.order, ...absent], index: next.index };
  },
  'cursor index not remapped': (saved, next, available) => ({ order: preserveUnavailableCards(saved, next, available).order, index: next.index }),
  'learned/hidden known cards retained': (saved, next, available) => {
    const out = preserveUnavailableCards(saved, next, available);
    const extra = (saved?.order ?? []).filter((id) => !id.startsWith('user:') && !out.order.includes(id) && available.has(id));
    return { order: [...out.order, ...extra], index: out.index };
  }
};

const results: Record<string, unknown> = {};

describe('F1 model: shared-deck order preservation', () => {
  for (const deck of ['all', 'topic'] as const) {
    it(`RC1 preserveUnavailableCards satisfies the oracle (${deck} deck, 3,000 random runs × 60 steps)`, () => {
      let violations: Violation[] = [];
      restoredCursorCases = 0;
      for (let seed = 1; seed <= 3000; seed++) violations = violations.concat(simulate(seed, preserveUnavailableCards, deck).map((v) => ({ ...v, seed } as Violation)));
      results[`rc1-${deck}`] = { runs: 3000, steps: 60, violations: violations.length, sample: violations.slice(0, 3), reimportsWhereThePersistedCursorWasARemovedCard: restoredCursorCases };
      expect(violations.slice(0, 5)).toEqual([]);
    }, 120_000);
    for (const [name, mutant] of Object.entries(MUTANTS)) {
      it(`detects mutant: ${name} (${deck} deck)`, () => {
        const rules = new Map<string, number>();
        for (let seed = 1; seed <= 300; seed++) for (const v of simulate(seed, mutant, deck)) rules.set(v.rule, (rules.get(v.rule) ?? 0) + 1);
        results[`mutant-${deck}-${name}`] = Object.fromEntries(rules);
        expect(rules.size).toBeGreaterThan(0);
      }, 60_000);
    }
  }
  it('writes the results', async () => {
    const { writeFile } = await import('node:fs/promises');
    const target = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.FABLE_RESULT;
    if (target) await writeFile(target, JSON.stringify(results, null, 2) + '\n');
  });
});
