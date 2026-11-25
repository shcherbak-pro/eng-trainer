import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createCatalog } from '../../content/catalog';
import { realMaterials } from '../../test/content';
import { describeExperimental } from '../../test/product';
import { last } from './testing';
import PronunciationPage from './PronunciationPage.svelte';
import { KIND_LABELS, practiceGroups } from './practiceItems';
import type { PracticeSession, PracticeState } from './session';

/**
 * The Pronunciation screen with a session under the test's control (ENG-V3-02, stage A):
 * what each state shows, what each control does, and what the screen never says.
 */
const BASE: PracticeState = { phase: 'checking', installed: false, downloadOffered: true, downloadBytes: 46_792_602, progress: null, notice: null, outcome: null };

function fakeSession(initial: Partial<PracticeState> = {}) {
  let state: PracticeState = { ...BASE, ...initial };
  const listeners = new Set<(state: PracticeState) => void>();
  const calls: string[] = [];
  const note = (name: string) => async (): Promise<void> => void calls.push(name);
  const session: PracticeSession = {
    subscribe(run) {
      listeners.add(run);
      run(state);
      return () => listeners.delete(run);
    },
    init: note('init'),
    prepare: note('prepare'),
    cancelPrepare: () => void calls.push('cancelPrepare'),
    removeModel: note('removeModel'),
    record: note('record'),
    stop: note('stop'),
    cancel: () => void calls.push('cancel'),
    clearOutcome: () => void calls.push('clearOutcome'),
    pageHidden: () => void calls.push('pageHidden'),
    recordedSeconds: () => 2.4,
    dispose: () => void calls.push('dispose')
  };
  return {
    session,
    calls,
    set(next: Partial<PracticeState>): void {
      state = { ...state, ...next };
      for (const listener of listeners) listener(state);
      flushSync();
    }
  };
}

describeExperimental('Pronunciation screen', () => {
  const catalog = createCatalog(realMaterials);
  /** The first topic, as the screen lists it. Its first entry is a sentence frame with two targets. */
  const topic = practiceGroups(catalog)[0];
  let root: HTMLElement;
  let component: ReturnType<typeof mount> | null;
  let fake: ReturnType<typeof fakeSession>;

  const text = (node: ParentNode | null = root): string => (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const action = (name: string): HTMLButtonElement | null => root.querySelector<HTMLButtonElement>(`[data-action="${name}"]`);
  const actions = (): string[] => [...root.querySelectorAll<HTMLElement>('[data-action]')].map((button) => button.dataset.action!);
  const click = (name: string): void => {
    action(name)!.click();
    flushSync();
  };

  function open(initial: Partial<PracticeState> = {}): void {
    fake = fakeSession(initial);
    component = mount(PronunciationPage, { target: root, props: { catalog, createSession: () => fake.session } });
    flushSync();
  }

  beforeEach(() => {
    root = document.createElement('div');
    document.body.appendChild(root);
    component = null;
  });

  afterEach(() => {
    if (component) unmount(component);
    root.remove();
    vi.useRealTimers();
  });

  it('opens as a prototype for disposable profiles, reads the model state, and says what the result is not', () => {
    open();
    const page = root.querySelector('[data-experimental-feature]')!;
    expect(page.getAttribute('data-experimental-feature')).toBe('pronunciation-prototype');
    expect(page.getAttribute('data-phase')).toBe('checking');
    expect(fake.calls).toEqual(['init']);
    expect(text()).toContain('Prototype: use a disposable browser profile');
    expect(text()).toContain('Use it only in a browser profile made for testing, with made-up learning data.');
    expect(text()).toContain('Your speech is recognized on this device. The recording is not stored and is not sent anywhere.');
    expect(text()).toContain('It is not a score of your pronunciation.');
    expect(actions()).toEqual([]);
  });

  it('names the pinned model and runtime, the product and its database, and the other versions', () => {
    open();
    expect(text(root.querySelector('[data-model-fact="model"]'))).toBe('Moonshine tiny, 8-bit quantized (onnx-community/moonshine-tiny-ONNX, revision a6da1241cd30, MIT)');
    expect(text(root.querySelector('[data-model-fact="runtime"]'))).toBe('onnxruntime-web 1.31.1, WebAssembly, one thread (MIT)');
    expect(text(root.querySelector('[data-build-fact="product"]'))).toBe('experimental-v3');
    expect(text(root.querySelector('[data-build-fact="database"]'))).toBe('eng-trainer-v3');
    expect([...root.querySelectorAll<HTMLAnchorElement>('a[data-version-link]')].map((link) => [link.dataset.versionLink, link.getAttribute('href')])).toEqual([
      ['stable-v2', '/eng-trainer/'],
      ['legacy-v1', '/eng-trainer/v1/']
    ]);
  });

  it('without a model: states the exact size before any download, and downloads only on the click', () => {
    open({ phase: 'no-model' });
    expect(text(root.querySelector('[data-model-state]'))).toBe('Recording needs a speech model of 46.8 MB (46,792,602 bytes). It is downloaded once from this site, checked file by file and kept in this browser.');
    expect(actions()).toEqual(['install-model']);
    expect(text(action('install-model'))).toBe('Download and install (46.8 MB)');
    expect(fake.calls).toEqual(['init']);
    click('install-model');
    expect(fake.calls).toEqual(['init', 'prepare']);
    // No phrase and no record control while there is no model.
    expect(root.querySelector('[data-target-text]')).toBeNull();
  });

  it('on a page that offers no download there is no download control', () => {
    open({ phase: 'no-model', downloadOffered: false });
    expect(text(root.querySelector('[data-model-state]'))).toBe('This page does not offer a model download, so recording is not available here.');
    expect(actions()).toEqual([]);
  });

  it('an installed model can be loaded or deleted', () => {
    open({ phase: 'no-model', installed: true });
    expect(text(root.querySelector('[data-model-state]'))).toBe('The speech model is in this browser. Load it to record.');
    expect(actions()).toEqual(['load-model', 'delete-model']);
    click('load-model');
    click('delete-model');
    expect(fake.calls).toEqual(['init', 'prepare', 'removeModel']);
  });

  it('shows the download progress, and Cancel stops it', () => {
    open({ phase: 'installing', progress: { loaded: 11_698_150, total: 46_792_602 } });
    const progress = root.querySelector('progress')!;
    expect([progress.value, progress.max]).toEqual([11_698_150, 46_792_602]);
    expect(text(root.querySelector('[data-model-state]'))).toContain('11.7 of 46.8 MB');
    expect(actions()).toEqual(['cancel-install']);
    click('cancel-install');
    expect(fake.calls).toContain('cancelPrepare');

    fake.set({ phase: 'loading', progress: null });
    expect(text(root.querySelector('[data-model-state]'))).toBe('Loading the speech model…');
    expect(actions()).toEqual(['cancel-install']);
  });

  it('explains a failed preparation and an unsupported browser', () => {
    open({ phase: 'no-model', notice: 'A downloaded file is not the expected one and was discarded. Nothing was installed.' });
    expect(text(root.querySelector('.notice--error'))).toContain('The speech model is not loaded');
    expect(text(root.querySelector('.notice--error'))).toContain('A downloaded file is not the expected one and was discarded.');

    fake.set({ phase: 'unsupported', notice: 'This browser has no Workers.' });
    expect(text(root.querySelector('[data-model-state]'))).toBe('Recording is not available here. This browser has no Workers.');
    expect(actions()).toEqual([]);
    expect(root.querySelector('.notice--error')).toBeNull();
  });

  it('with the model loaded: shows a phrase to say and one Record control', () => {
    open({ phase: 'ready', installed: true });
    const first = topic.items[0];
    expect(first.target).toEqual({ contract: 1, entryId: 'phrase-001', kind: 'frame', text: 'I would start by saying that' });
    expect(text(root.querySelector('[data-target-text]'))).toBe(first.target.text);
    expect(root.querySelector('[data-target-text]')!.getAttribute('lang')).toBe('en');
    expect(root.querySelector('[data-target-entry]')!.getAttribute('data-target-entry')).toBe('phrase-001');
    expect(root.querySelector('[data-target-kind]')!.getAttribute('data-target-kind')).toBe('frame');
    expect(text(root.querySelector('.prompt-card'))).toContain(`${KIND_LABELS.frame} 1 of ${topic.items.length}`);
    // A part of an entry says which entry it comes from.
    expect(text(root.querySelector('.prompt-card'))).toContain(`From: ${catalog.phrases[0].phrase}`);
    expect(actions()).toEqual(['delete-model', 'previous', 'next', 'record']);
    expect(text(action('record'))).toBe('Record');
    expect(text()).toContain('Recording stops by itself after 20 seconds.');

    click('record');
    expect(fake.calls).toEqual(['init', 'record']);
  });

  it('Next, Previous and Topic choose another phrase, end a recording and clear the last result', () => {
    open({ phase: 'ready', installed: true });
    click('next');
    expect(text(root.querySelector('[data-target-text]'))).toBe(topic.items[1].target.text);
    expect(topic.items[1].target.text).not.toBe(topic.items[0].target.text);
    expect(fake.calls).toEqual(['init', 'cancel', 'clearOutcome']);
    click('previous');
    expect(text(root.querySelector('[data-target-text]'))).toBe(topic.items[0].target.text);
    // Previous from the first phrase goes to the last one of the topic.
    click('previous');
    expect(text(root.querySelector('.prompt-card .muted'))).toMatch(/ (\d+) of \1$/);

    const select = root.querySelector<HTMLSelectElement>('[data-control="group"]')!;
    select.value = 'irregular-verbs';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    expect(root.querySelector('[data-target-kind]')!.getAttribute('data-target-kind')).toBe('verb-forms');
    expect(text(root.querySelector('.prompt-card .muted'))).toBe('Verb forms 1 of 339');
    expect(text(root.querySelector('[data-target-text]'))).toBe('be, was/were, been');
  });

  it('while recording: Stop and Cancel, the elapsed time, and no way to change the phrase', () => {
    vi.useFakeTimers();
    open({ phase: 'ready', installed: true });
    fake.set({ phase: 'starting' });
    expect(actions()).toEqual(['previous', 'next', 'cancel']);
    expect(text(root.querySelector('[data-record-status]'))).toBe('Waiting for the microphone. The browser may ask for permission.');

    fake.set({ phase: 'recording' });
    vi.advanceTimersByTime(250);
    flushSync();
    expect(actions()).toEqual(['previous', 'next', 'stop', 'cancel']);
    expect(text(root.querySelector('[data-record-status]'))).toBe('Recording: 2.4 s. Say the phrase, then choose Stop.');
    expect(action('next')!.disabled).toBe(true);
    expect(root.querySelector<HTMLSelectElement>('[data-control="group"]')!.disabled).toBe(true);
    click('stop');
    expect(fake.calls).toContain('stop');

    fake.set({ phase: 'recognizing' });
    expect(actions()).toEqual(['previous', 'next', 'cancel']);
    expect(text(root.querySelector('[data-record-status]'))).toBe('Recognizing on this device…');
    click('cancel');
    expect(fake.calls).toContain('cancel');
  });

  it('shows what the recognizer heard, with the two cautions, and offers to record again', () => {
    open({ phase: 'ready', installed: true, outcome: { kind: 'heard', text: 'Let me explain.', audioSeconds: 2.04, elapsedMs: 310 } });
    const outcome = root.querySelector('[data-outcome]')!;
    expect(outcome.getAttribute('data-outcome')).toBe('heard');
    expect(text(outcome)).toBe('The recognizer heard: Let me explain. 2.0 s recorded, recognized in 0.3 s. A recognizer can mishear correct speech, and it can also turn a mispronounced word into the expected one. A difference is not a mistake, and a match is not a proof.');
    expect(text(action('record'))).toBe('Record again');

    fake.set({ outcome: { kind: 'heard', text: '', audioSeconds: 2, elapsedMs: 100 } });
    expect(text(root.querySelector('[data-heard-text]'))).toBe('(no words)');
  });

  it('says why a recording has no result, without blaming the speaker', () => {
    open({ phase: 'ready', installed: true, outcome: { kind: 'unable', message: 'Nothing was heard. Check that the microphone is on and not muted, then record again.' } });
    const outcome = root.querySelector('[data-outcome]')!;
    expect(outcome.getAttribute('data-outcome')).toBe('unable');
    expect(text(outcome)).toBe('No result for this recording Nothing was heard. Check that the microphone is on and not muted, then record again.');
    expect(text(action('record'))).toBe('Record again');
  });

  it('never shows a score, a percentage, a grade or a verdict', () => {
    const cautions = ['It is not a score of your pronunciation.', 'A recognizer can mishear correct speech, and it can also turn a mispronounced word into the expected one. A difference is not a mistake, and a match is not a proof.'];
    const verdict = /score|grade|percent|%|accura|correct|wrong|mistake|well done|good job|try harder|\bpass(?:ed)?\b|\bfail(?:ed)?\b/i;
    open({ phase: 'ready', installed: true });
    // The page text without the phrase to say, which is study material.
    const shown = (): string => {
      const copy = root.cloneNode(true) as HTMLElement;
      copy.querySelector('.prompt-card')?.remove();
      copy.querySelector('[data-control="group"]')?.remove();
      return cautions.reduce((all, caution) => all.split(caution).join(''), text(copy));
    };

    const states: Partial<PracticeState>[] = [
      { outcome: null },
      { outcome: { kind: 'heard', text: 'Let me explain.', audioSeconds: 2, elapsedMs: 310 } },
      { outcome: { kind: 'heard', text: '', audioSeconds: 2, elapsedMs: 310 } },
      { outcome: { kind: 'unable', message: 'The recording is shorter than one second. Record the whole phrase.' } },
      { phase: 'recording', outcome: null },
      { phase: 'recognizing' }
    ];
    for (const state of states) {
      fake.set({ phase: 'ready', ...state });
      expect(shown()).not.toMatch(verdict);
      // No colour scale either: the result carries no class that depends on the text.
      expect(root.querySelector('.heard')?.className ?? 'heard').toMatch(/^heard(?: svelte-\w+)?$/);
    }
    expect(root.querySelectorAll('meter, [role="meter"], [role="progressbar"]')).toHaveLength(0);
  });

  it('a hidden page tells the session, and leaving the screen disposes of it', () => {
    open({ phase: 'recording', installed: true });
    const visibility = vi.spyOn(document, 'visibilityState', 'get');
    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(fake.calls).not.toContain('pageHidden');
    visibility.mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(fake.calls).toContain('pageHidden');

    unmount(component!);
    component = null;
    expect(last(fake.calls)).toBe('dispose');
    // The listener is gone: a later event reaches no session.
    const before = fake.calls.length;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(fake.calls).toHaveLength(before);
    visibility.mockRestore();
  });
});
