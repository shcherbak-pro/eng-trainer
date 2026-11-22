import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { revealFocusedChip } from './revealFocusedChip';

// Native geometry, text wrapping and keyboard activation are exercised by focused-chips.mjs.
// These tests force deferred lifecycle boundaries, even when a canceled callback is delivered.
describe('focused situation revelation lifecycle', () => {
  let strip: HTMLDivElement;
  let chip: HTMLButtonElement;
  let outside: HTMLInputElement;
  let callbacks: FrameRequestCallback[];
  let resize: () => void;
  let disconnect: ReturnType<typeof vi.fn>;
  let action: ReturnType<typeof revealFocusedChip>;

  beforeEach(() => {
    callbacks = [];
    disconnect = vi.fn();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => callbacks.push(callback));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resize = callback; }
      observe() {}
      disconnect = disconnect;
    });
    vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
    vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(390);
    strip = document.createElement('div');
    chip = document.createElement('button');
    chip.textContent = 'Before a work meeting';
    chip.style.outlineWidth = '2px';
    chip.style.outlineOffset = '2px';
    outside = document.createElement('input');
    strip.append(chip);
    document.body.append(strip, outside);
    vi.spyOn(strip, 'clientWidth', 'get').mockReturnValue(200);
    vi.spyOn(strip, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 200, 60));
    vi.spyOn(chip, 'getBoundingClientRect').mockReturnValue(new DOMRect(160, 108, 120, 44));
    action = revealFocusedChip(strip);
  });

  afterEach(() => {
    action.destroy();
    document.body.replaceChildren();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function deliverEvenCanceledFrames(): void {
    for (const callback of callbacks.splice(0)) callback(0);
  }

  it('does not scroll an old target after focus moves outside the strip', () => {
    chip.focus();
    expect(callbacks.length).toBeGreaterThan(0);
    outside.focus();
    deliverEvenCanceledFrames();
    expect(strip.scrollLeft).toBe(0);
    expect(document.activeElement).toBe(outside);
    expect(window.scrollBy).not.toHaveBeenCalled();
  });

  it('leaves a manually scrolled, selected but unfocused chip alone on resize', () => {
    chip.setAttribute('aria-pressed', 'true');
    outside.focus();
    strip.scrollLeft = 37;
    resize();
    deliverEvenCanceledFrames();
    expect(strip.scrollLeft).toBe(37);
    expect(document.activeElement).toBe(outside);
    expect(window.scrollBy).not.toHaveBeenCalled();
  });

  it('cancels and disconnects on destroy, including callbacks delivered before DOM removal', () => {
    chip.focus();
    action.destroy();
    expect(disconnect).toHaveBeenCalled();
    expect(cancelAnimationFrame).toHaveBeenCalled();
    deliverEvenCanceledFrames();
    resize();
    deliverEvenCanceledFrames();
    expect(strip.scrollLeft).toBe(0);
    expect(document.activeElement).toBe(chip);
    expect(window.scrollBy).not.toHaveBeenCalled();
  });
});

// RC2: a viewport-height change moves the fixed tab bar without resizing the strip or any label, so
// the ResizeObserver never fires (it is never called below). Native coverage: height-resize.mjs.
describe('focused situation revelation after viewport-height changes (RC2)', () => {
  const HEIGHT = 844;
  const BAR = 100;
  let strip: HTMLDivElement;
  let chips: HTMLButtonElement[];
  let search: HTMLInputElement;
  let bar: HTMLDivElement;
  let barTop: number;
  let frames: Map<number, FrameRequestCallback>;
  let canceled: Set<number>;
  let nextFrame: number;
  let observed: ReturnType<typeof vi.fn>;
  let scrollBy: ReturnType<typeof vi.spyOn>;
  let action: ReturnType<typeof revealFocusedChip>;

  /** A chip box in viewport coordinates; reveals move it the way a page scroll would. */
  function place(chip: HTMLButtonElement, top: number): void {
    vi.spyOn(chip, 'getBoundingClientRect').mockImplementation(() => new DOMRect(Number(chip.dataset.left), top, 120, 96));
  }

  beforeEach(() => {
    frames = new Map();
    canceled = new Set();
    nextFrame = 0;
    observed = vi.fn();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { nextFrame += 1; frames.set(nextFrame, callback); return nextFrame; });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { canceled.add(id); });
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} constructor() { observed(); } });
    vi.stubGlobal('innerHeight', HEIGHT);
    scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
    vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(320);
    search = document.createElement('input');
    search.type = 'search';
    bar = document.createElement('div');
    bar.className = 'tab-bar';
    barTop = HEIGHT - BAR;
    vi.spyOn(bar, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, barTop, 320, BAR));
    strip = document.createElement('div');
    chips = ['Before a work meeting', 'Coffee and lunch breaks', 'Free time and weekends'].map((label, index) => {
      const chip = document.createElement('button');
      chip.textContent = label;
      chip.dataset.left = String(8 + index * 140);
      chip.style.outlineWidth = '2px';
      chip.style.outlineOffset = '2px';
      // Keyboard focus is what jsdom cannot report; the guard itself is unchanged.
      vi.spyOn(chip, 'matches').mockImplementation((selector: string) => (selector === ':focus-visible' ? document.activeElement === chip : Element.prototype.matches.call(chip, selector)));
      strip.append(chip);
      return chip;
    });
    document.body.append(search, strip, bar);
    vi.spyOn(strip, 'clientWidth', 'get').mockReturnValue(320);
    vi.spyOn(strip, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 392, 320, 104));
    for (const chip of chips) place(chip, 396);
    action = revealFocusedChip(strip);
  });

  afterEach(() => {
    action.destroy();
    document.body.replaceChildren();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const live = () => [...frames.keys()].filter((id) => !canceled.has(id));
  /** What the browser does: run only the frames that are still requested. */
  function runFrames(): void {
    for (const id of live()) { const callback = frames.get(id)!; frames.delete(id); callback(0); }
  }
  /** A harsher harness: deliver even canceled callbacks, as a late frame might. */
  function runEvenCanceledFrames(): void {
    for (const [id, callback] of [...frames]) { frames.delete(id); callback(0); }
  }
  function setHeight(height: number): void {
    vi.stubGlobal('innerHeight', height);
    barTop = height - BAR;
    window.dispatchEvent(new Event('resize'));
  }
  function focusAndSettle(chip: HTMLButtonElement): void {
    chip.focus();
    runFrames();
    scrollBy.mockClear();
  }

  it('reveals the keyboard-focused chip when only the viewport height changes', () => {
    const coffee = chips[1];
    focusAndSettle(coffee);
    setHeight(480);
    expect(live()).toHaveLength(1);
    runFrames();
    // Outline bottom 396 + 96 + 4 = 496 must clear the bar's new top, 380.
    expect(scrollBy).toHaveBeenCalledExactlyOnceWith({ top: 116, behavior: 'instant' });
    expect(document.activeElement).toBe(coffee);
    expect(strip.scrollLeft).toBe(0);
    expect(observed).toHaveBeenCalledTimes(1); // the observer exists but is never notified: no size changed
  });

  it('reveals again after the height is restored and reduced once more', () => {
    const coffee = chips[1];
    focusAndSettle(coffee);
    setHeight(480);
    runFrames();
    place(coffee, 280); // the page has scrolled the chip up by 116 px
    setHeight(HEIGHT);
    runFrames();
    place(coffee, 396); // the learner scrolls back down; the chip keeps focus
    setHeight(480);
    runFrames();
    expect(scrollBy.mock.calls).toEqual([[{ top: 116, behavior: 'instant' }], [{ top: 116, behavior: 'instant' }]]);
    expect(document.activeElement).toBe(coffee);
  });

  it('neither reveals a chip nor takes focus while Search has focus', () => {
    focusAndSettle(chips[1]);
    search.focus();
    setHeight(480);
    expect(live()).toHaveLength(0);
    runEvenCanceledFrames();
    expect(scrollBy).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(search);
  });

  it('keeps the manual scroll position of a selected chip that does not have focus', () => {
    chips[2].setAttribute('aria-pressed', 'true');
    search.focus();
    strip.scrollLeft = 37;
    setHeight(480);
    runEvenCanceledFrames();
    expect(strip.scrollLeft).toBe(37);
    expect(scrollBy).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(search);
  });

  it('does not reveal or measure the former owner when focus moves to another chip first', () => {
    const [before, coffee] = chips;
    focusAndSettle(coffee);
    place(before, 120); // the next owner is visible after the resize
    setHeight(480);
    const reads = vi.mocked(coffee.getBoundingClientRect);
    reads.mockClear();
    before.focus();
    runEvenCanceledFrames();
    expect(reads).not.toHaveBeenCalled();
    expect(scrollBy).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(before);
  });

  it('cancels queued resize work on destroy and stops listening', () => {
    const coffee = chips[1];
    focusAndSettle(coffee);
    setHeight(480);
    const pending = live();
    action.destroy();
    expect(pending.every((id) => canceled.has(id))).toBe(true);
    const reads = [coffee, strip, bar].map((element) => vi.mocked(element.getBoundingClientRect));
    for (const read of reads) read.mockClear();
    strip.remove();
    expect(() => { runEvenCanceledFrames(); setHeight(470); runEvenCanceledFrames(); }).not.toThrow();
    expect(frames.size).toBe(0);
    for (const read of reads) expect(read).not.toHaveBeenCalled();
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it('coalesces a burst of resize events into one reveal, without a follow-up loop', () => {
    const coffee = chips[1];
    focusAndSettle(coffee);
    for (const height of [700, 620, 540, 500, 470, 480]) setHeight(height);
    expect(live()).toHaveLength(1);
    runFrames();
    expect(scrollBy).toHaveBeenCalledExactlyOnceWith({ top: 116, behavior: 'instant' });
    place(coffee, 280);
    expect(live()).toHaveLength(0);
    setHeight(480);
    runFrames();
    expect(scrollBy).toHaveBeenCalledTimes(1);
  });
});
