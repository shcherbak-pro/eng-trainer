<script lang="ts">
  import { tick } from 'svelte';
  import { get } from 'svelte/store';
  import { progress, type HideKind, type UndoToken } from '../../state/progress';
  import Button from '../ui/Button.svelte';
  import { showToast } from '../ui/toast';

  export let kind: HideKind;
  export let id: string;
  /** The entry's English text, for the confirmation message. */
  export let name = '';

  const HIDDEN = { phrase: 'hiddenPhrases', word: 'hiddenWords', irregular: 'hiddenIrregular' } as const;
  const FOCUS = { phrase: 'favoritePhrases', word: 'favoriteWords', irregular: 'favoriteIrregular' } as const;

  let button: HTMLButtonElement | undefined;

  $: hiddenList = $progress[HIDDEN[kind]];
  $: hidden = hiddenList.includes(id);
  $: key = `${kind}:${id}`;

  /** The Hide and Show buttons of the entries on this screen, in reading order. */
  function entryButtons(): HTMLButtonElement[] {
    return [...document.querySelectorAll<HTMLButtonElement>('main .entry-hide')];
  }

  async function hide(): Promise<void> {
    const self = button;
    const hadFocus = self !== undefined && document.activeElement === self;
    const position = self ? entryButtons().indexOf(self) : -1;
    const before = get(progress);
    const wasFocused = before[FOCUS[kind]].includes(id);
    const wasLearned = kind === 'phrase' && before.learnedPhrases.includes(id);
    progress.hideItem(kind, id);
    const token = progress.issueUndo({ type: 'hide', kind, id });
    showToast(name ? `Hidden: “${name}”.` : 'Hidden.', { actionLabel: 'Undo', onAction: () => undo(token, wasFocused, wasLearned) });

    // Keyboard users keep their place. While hidden entries are shown, this button stays (now "Show")
    // and keeps focus; otherwise the entry has left the list and focus moves to the entry that took its place.
    if (!hadFocus) return;
    await tick();
    if (self?.isConnected) return;
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    const buttons = entryButtons();
    const next = buttons[Math.min(position, buttons.length - 1)] ?? document.querySelector<HTMLElement>('main .chip-toggle') ?? document.querySelector<HTMLElement>('main h1');
    next?.focus();
  }

  /**
   * Undo reverses only what hiding changed for this one entry, with the same entry-level
   * operations: show it again and, if hiding removed them, put it back in the Focus list
   * and mark it learned again. Nothing else is restored. The Undo is refused once anything
   * newer touched this entry's hidden, Focus or learned state, after a Reset, and when it
   * was already used. It returns the restored entry's button for keyboard focus.
   */
  async function undo(token: UndoToken, wasFocused: boolean, wasLearned: boolean): Promise<HTMLElement | null> {
    if (!progress.redeemUndo(token)) return null;
    if (get(progress)[HIDDEN[kind]].includes(id)) progress.unhideItem(kind, id);
    if (wasFocused && !get(progress)[FOCUS[kind]].includes(id)) progress.toggleFavorite(kind, id);
    if (wasLearned && !get(progress).learnedPhrases.includes(id)) progress.toggleLearnedPhrase(id);
    await tick();
    return entryButtons().find((item) => item.dataset.hideFor === key) ?? null;
  }
</script>

<Button
  variant="quiet"
  size="sm"
  class="entry-hide"
  data-hide-for={key}
  bind:element={button}
  icon={hidden ? 'eye' : 'eye-off'}
  label={hidden ? 'Show item' : 'Hide item'}
  onClick={() => (hidden ? progress.unhideItem(kind, id) : void hide())}
>
  {hidden ? 'Show' : 'Hide'}
</Button>
