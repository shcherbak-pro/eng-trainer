<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { get } from 'svelte/store';
  import type { ContentCatalog } from '../../content/catalog';
  import { inCollection, resolvedCollection } from '../../content/userCatalog';
  import CollectionFilter from '../../shared/ui/CollectionFilter.svelte';
  import { progress, type UndoToken } from '../../state/progress';
  import { settings } from '../../state/settings';
  import type { Flashcard, FlashcardAnswer, FlashcardMode } from './types';
  import {
    actionForKey,
    answerCard,
    answerForSwipe,
    buildFlashcards,
    deckKey,
    filterDeck,
    getTopics,
    isHorizontalDrag,
    preserveUnavailableCards,
    resolveSession,
    shuffleSession,
    summarizeDeck
  } from './flashcards';
  import Button from '../../shared/ui/Button.svelte';
  import ConfirmDialog from '../../shared/ui/ConfirmDialog.svelte';
  import EmptyState from '../../shared/ui/EmptyState.svelte';
  import Icon from '../../shared/ui/Icon.svelte';
  import IconButton from '../../shared/ui/IconButton.svelte';
  import { showToast } from '../../shared/ui/toast';
  import SpeakButton from '../../shared/speech/SpeakButton.svelte';

  export let catalog: ContentCatalog;

  /** Time the card needs to leave the screen before the next one appears. */
  const EXIT_MS = 200;
  const LONG_TEXT_LENGTH = 70;

  let view: 'learn' | 'review' = 'learn';
  let flipped = false;
  let notice = '';
  let confirmReset = false;
  let reviewHeading: HTMLHeadingElement | undefined;
  let reviewToggle: HTMLButtonElement | undefined;

  // Swipe state.
  let pointerId: number | null = null;
  let startX = 0;
  let startY = 0;
  let dragging = false;
  let dragX = 0;
  let suppressClick = false;

  // Answer animation state.
  let busy = false;
  let exitDirection: -1 | 0 | 1 = 0;
  let exitTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingAnswer: (() => void) | null = null;
  let cardSerial = 0;

  $: collectionFilter = resolvedCollection(catalog, $settings.collectionFilter);
  $: cards = buildFlashcards(catalog).filter((card) => inCollection(card, collectionFilter));
  $: availableIds = new Set([...catalog.phrases, ...catalog.wordIndex].map((item) => item.id));
  $: cardById = new Map(cards.map((card) => [card.id, card]));
  $: topics = getTopics(cards);
  $: topicStats = topics.map((name) => {
    const summary = summarizeDeck(filterDeck(cards, 'topic', name), $progress);
    return { name, learned: summary.learned.length, total: summary.learned.length + summary.learning.length };
  });

  $: mode = $settings.flashcardMode;
  $: topic = topics.includes($settings.flashcardTopic) ? $settings.flashcardTopic : (topics[0] ?? '');
  $: currentDeckKey = collectionFilter ? `collection:${JSON.stringify([collectionFilter, deckKey(mode, topic)])}` : deckKey(mode, topic);
  $: deckLabel = mode === 'topic' ? topic : 'All Vocabulary';

  $: deck = summarizeDeck(filterDeck(cards, mode, topic), $progress);
  $: session = resolveSession(
    $progress.flashcardSessions[currentDeckKey],
    deck.learning.map((card) => card.id)
  );
  $: current = cardById.get(session.order[session.index]) ?? null;
  $: currentId = current?.id ?? '';

  $: remaining = deck.learning.length;
  $: learnedCount = deck.learned.length;
  $: total = remaining + learnedCount;
  $: learnedPercent = total ? Math.round((learnedCount / total) * 100) : 0;

  $: example = current?.examples[0] ?? null;
  $: swipeAnswer = dragging ? answerForSwipe(dragX) : null;
  $: swipeStyle = exitDirection
    ? `transform: translateX(${exitDirection * 130}%) rotate(${exitDirection * 14}deg); opacity: 0;`
    : `transform: translateX(${dragX}px) rotate(${dragX * 0.04}deg);`;

  // A different card or deck always starts on the front side.
  $: onCardChange(currentId, currentDeckKey);

  function onCardChange(_cardId: string, _deck: string): void {
    flipped = false;
    dragX = 0;
    dragging = false;
    pointerId = null;
  }

  function plural(count: number, word: string): string {
    return `${count} ${word}${count === 1 ? '' : 's'}`;
  }

  function exitDelay(): number {
    const reducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    return reducedMotion ? 0 : EXIT_MS;
  }

  function flip(): void {
    if (busy || !current) return;
    flipped = !flipped;
  }

  /** Swipes, buttons and arrow keys all end up here. */
  function answer(choice: FlashcardAnswer): void {
    if (busy || !current || view !== 'learn') return;

    const card = current;
    // The answer is newer intent for this card from the moment it is chosen, also
    // "Keep learning" on a card that is not learned: an older Undo can no longer apply.
    progress.noteIntent({ type: 'learned', id: card.id });
    const targetDeckKey = currentDeckKey;
    const targetSession = session;
    const savedSession = $progress.flashcardSessions[targetDeckKey];
    const targetAvailableIds = availableIds;

    const finish = (): void => {
      pendingAnswer = null;
      const next = answerCard(targetSession, card.id, choice);
      const startsNewRound =
        next.order.length > 0 && next.index === 0 && (choice === 'again' || targetSession.index > 0);

      busy = false;
      exitDirection = 0;
      dragX = 0;
      flipped = false;
      cardSerial += 1;
      notice = startsNewRound
        ? `End of the deck. Starting again with the ${plural(next.order.length, 'card')} you are still learning.`
        : '';

      progress.saveFlashcardSession(
        targetDeckKey,
        preserveUnavailableCards(savedSession, next, targetAvailableIds),
        choice === 'know' ? [card.id] : []
      );
    };

    busy = true;
    exitDirection = choice === 'know' ? 1 : -1;

    const delay = exitDelay();
    if (delay === 0) {
      finish();
    } else {
      pendingAnswer = finish;
      exitTimer = setTimeout(finish, delay);
    }
  }

  function setMode(next: FlashcardMode): void {
    if (busy) return;
    notice = '';
    settings.setFlashcardMode(next);
  }

  function setTopic(event: Event): void {
    notice = '';
    settings.setFlashcardTopic((event.target as HTMLSelectElement).value);
  }

  function shuffle(): void {
    if (busy || remaining < 2) return;
    notice = 'Deck shuffled.';
    flipped = false;
    cardSerial += 1;
    progress.saveFlashcardSession(currentDeckKey, preserveUnavailableCards(
      $progress.flashcardSessions[currentDeckKey], shuffleSession(session), availableIds
    ));
  }

  /** The "Learn again" buttons of the learned list, in order. */
  function learnAgainButtons(): HTMLButtonElement[] {
    return [...document.querySelectorAll<HTMLButtonElement>('.flashcards-review__list .learn-again')];
  }

  /** Focus that was on a control that has just been removed. */
  function focusLost(): boolean {
    const active = document.activeElement;
    return !active || active === document.body || !active.isConnected;
  }

  async function learnAgain(card: Flashcard): Promise<void> {
    const buttons = learnAgainButtons();
    const self = buttons.find((item) => item.dataset.cardId === card.id) ?? null;
    const hadFocus = self !== null && document.activeElement === self;
    const position = self ? buttons.indexOf(self) : -1;
    progress.relearnFlashcards([card.id]);
    const token = progress.issueUndo({ type: 'learned', id: card.id });
    showToast(`“${card.text}” is back in the deck.`, { actionLabel: 'Undo', onAction: () => undoLearnAgain(token, card.id) });

    // The row has left the list. Keyboard users continue with the row that took its place,
    // else the one before it, else the list heading. Focus the user moved elsewhere stays put.
    if (!hadFocus) return;
    await tick();
    if (!focusLost()) return;
    const remaining = learnAgainButtons();
    (remaining[Math.min(position, remaining.length - 1)] ?? reviewHeading)?.focus();
  }

  /**
   * Undo for "Learn again" restores the learned flag of this one card, nothing else.
   * "Learn again" changes no deck order or position, so none needs restoring. The Undo is
   * refused once the card was answered or changed again, after a Reset, and when it was
   * already used. It returns the restored row for keyboard focus or, when the learned list
   * is not on screen, the button that opens it.
   */
  async function undoLearnAgain(token: UndoToken, id: string): Promise<HTMLElement | null> {
    if (!progress.redeemUndo(token)) return null;
    if (!get(progress).learnedPhrases.includes(id)) progress.toggleLearnedPhrase(id);
    await tick();
    return learnAgainButtons().find((item) => item.dataset.cardId === id) ?? (reviewToggle?.isConnected ? reviewToggle : null);
  }

  /** After a deck reset the opener is gone: the list heading, else the current card, else the review button. */
  function afterResetFocus(): HTMLElement | null {
    return (view === 'review' ? reviewHeading : null) ?? document.querySelector<HTMLElement>('.flashcard__surface') ?? reviewToggle ?? null;
  }

  /** Resetting a deck needs an explicit confirmation; opening or cancelling it changes nothing. */
  function requestReset(): void {
    if (busy || !learnedCount) return;
    confirmReset = true;
  }

  function resetDeck(): void {
    confirmReset = false;
    if (busy || !learnedCount) return;

    const resetIds = new Set([...deck.learning, ...deck.learned].map((card) => card.id));
    const resetSession = preserveUnavailableCards(
      $progress.flashcardSessions[currentDeckKey],
      { order: cards.filter((card) => resetIds.has(card.id)).map((card) => card.id), index: 0 },
      availableIds
    );
    progress.resetFlashcardDeck(
      currentDeckKey,
      deck.learned.map((card) => card.id),
      resetSession.order.some((id) => !availableIds.has(id)) ? resetSession : undefined,
      [...resetIds]
    );
    view = 'learn';
    notice = '';
  }

  function onCardClick(): void {
    // A click that ends a drag is not a tap.
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    flip();
  }

  function onPointerDown(event: PointerEvent): void {
    if (busy || !event.isPrimary) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if ((event.target as Element | null)?.closest('.flashcard__speak')) return;

    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    dragging = false;
    suppressClick = false;
  }

  function onPointerMove(event: PointerEvent): void {
    if (event.pointerId !== pointerId) return;

    const deltaX = event.clientX - startX;
    const deltaY = event.clientY - startY;

    if (!dragging) {
      if (!isHorizontalDrag(deltaX, deltaY)) return;
      dragging = true;
      suppressClick = true;
      (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    }

    dragX = deltaX;
  }

  function onPointerUp(event: PointerEvent): void {
    if (event.pointerId !== pointerId) return;
    pointerId = null;
    if (!dragging) return;

    dragging = false;
    // The click that follows this pointerup is ignored; later clicks are not.
    setTimeout(() => (suppressClick = false), 0);

    const choice = answerForSwipe(dragX);
    if (choice) {
      answer(choice);
    } else {
      dragX = 0;
    }
  }

  function onPointerCancel(event: PointerEvent): void {
    if (event.pointerId !== pointerId) return;
    // The browser took over the gesture, usually to scroll the page.
    pointerId = null;
    dragging = false;
    dragX = 0;
  }

  function isTypingTarget(target: EventTarget | null): boolean {
    return target instanceof HTMLElement && (target.isContentEditable || target.matches('input, textarea, select'));
  }

  function isControlTarget(target: EventTarget | null): boolean {
    return target instanceof HTMLElement && target.closest('button, a, summary, [role="button"]') !== null;
  }

  function onKeydown(event: KeyboardEvent): void {
    if (view !== 'learn' || !current) return;
    if (event.defaultPrevented || event.repeat) return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;

    const action = actionForKey(event.key);
    if (!action || isTypingTarget(event.target)) return;

    if (action === 'flip') {
      // A focused button or link handles Enter and Space on its own.
      if (isControlTarget(event.target)) return;
      event.preventDefault();
      flip();
      return;
    }

    event.preventDefault();
    answer(action);
  }

  onDestroy(() => {
    clearTimeout(exitTimer);
    // Leaving the page while a card is still flying off must not lose the answer.
    pendingAnswer?.();
  });
</script>

<svelte:window on:keydown={onKeydown} />

<section class="flashcards-page" aria-label="Flashcards">
  <div class="flashcards-toolbar">
    <div class="flashcards-deck">
      <div class="segmented" role="group" aria-label="Deck">
        <button type="button" aria-pressed={mode === 'all'} on:click={() => setMode('all')}>All Vocabulary</button>
        <button type="button" aria-pressed={mode === 'topic'} disabled={!topics.length} on:click={() => setMode('topic')}>By Topic</button>
      </div>
      {#if mode === 'topic'}
        <label class="filter-select">
          <span class="visually-hidden">Topic</span>
          <select aria-label="Topic" value={topic} on:change={setTopic}>
            {#each topicStats as item (item.name)}
              <option value={item.name}>{item.name} ({item.learned}/{item.total} learned)</option>
            {/each}
          </select>
        </label>
      {/if}
      <CollectionFilter {catalog} />
    </div>

    <div class="flashcards-progress">
      <div class="flashcards-progress__stats" aria-live="polite">
        <span><strong>{remaining}</strong> remaining</span>
        <span><strong>{learnedCount}</strong> learned</span>
        {#if view === 'learn' && current}
          <span>Card <strong>{session.index + 1}</strong> of <strong>{remaining}</strong></span>
        {/if}
      </div>
      <div
        class="flashcards-progress__bar"
        role="progressbar"
        aria-label={`Learned cards in ${deckLabel}`}
        aria-valuemin="0"
        aria-valuemax={total}
        aria-valuenow={learnedCount}
      >
        <span style={`transform: scaleX(${total ? learnedCount / total : 0})`}></span>
      </div>
      {#if deck.hiddenCount}
        <p class="flashcards-progress__note">
          {plural(deck.hiddenCount, 'hidden item')} left out. Unhide on the Phrases or Words page to include.
        </p>
      {/if}
      <p class="flashcards-progress__note" role="status">{notice}</p>
    </div>

    <div class="flashcards-actions">
      <Button variant="secondary" size="sm" icon="shuffle" label="Shuffle remaining cards" disabled={view !== 'learn' || remaining < 2} onClick={shuffle}>Shuffle</Button>
      <Button
        variant="secondary"
        size="sm"
        icon={view === 'review' ? 'practice' : 'list'}
        label={view === 'review' ? 'Back to flashcards' : `Review learned vocabulary (${learnedCount})`}
        bind:element={reviewToggle}
        onClick={() => (view = view === 'review' ? 'learn' : 'review')}
      >{view === 'review' ? 'Back to flashcards' : `Review learned vocabulary (${learnedCount})`}</Button>
    </div>
  </div>

  {#if view === 'review'}
    <section class="flashcards-review" aria-labelledby="review-title">
      <h2 id="review-title" class="panel__title" tabindex="-1" bind:this={reviewHeading}>Learned vocabulary</h2>
      <p class="muted">{plural(learnedCount, 'learned card')} in {deckLabel}.</p>

      {#if learnedCount}
        <ul class="flashcards-review__list">
          {#each deck.learned as card (card.id)}
            <li>
              <div class="flashcards-review__text">
                <strong lang="en" translate="no">{card.text}</strong>
                <span class="entry__translation" lang={card.id.startsWith('user:') ? '' : 'uk'}>{card.translation}</span>
              </div>
              <div class="flashcards-review__actions">
                <SpeakButton text={card.text} label={`Listen: ${card.text}`} />
                <Button variant="secondary" size="sm" icon="undo" class="learn-again" data-card-id={card.id} onClick={() => void learnAgain(card)}>Learn again</Button>
              </div>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="muted">Nothing learned here yet. Swipe a card right or choose “I know it” to add it to this list.</p>
      {/if}
      <div class="flashcards-review__footer">
        <Button variant="secondary" icon="practice" onClick={() => (view = 'learn')}>Back to flashcards</Button>
        {#if learnedCount}<Button variant="danger" icon="reset" onClick={requestReset}>Reset progress for {deckLabel}</Button>{/if}
      </div>
    </section>
  {:else if current}
    <div class="flashcard-stage">
      {#key `${currentId}:${cardSerial}`}
        <!-- Swiping is a shortcut only: the buttons below and the arrow keys do the same. -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="flashcard-swipe"
          class:dragging
          class:exiting={exitDirection !== 0}
          style={swipeStyle}
          on:pointerdown={onPointerDown}
          on:pointermove={onPointerMove}
          on:pointerup={onPointerUp}
          on:pointercancel={onPointerCancel}
        >
          <article class="flashcard" class:flipped>
            <button
              type="button"
              class="flashcard__surface"
              aria-label={flipped
                ? `Back of the card: ${current.translation}. Press to show the English side.`
                : `Front of the card: ${current.text}. Press to show the translation.`}
              on:click={onCardClick}
            >
              <span class="flashcard__inner">
                <span class="flashcard__face flashcard__face--front" aria-hidden={flipped}>
                  <span class="tag-row">
                    {#each current.topics as name}<span>{name}</span>{/each}
                    {#if current.level}<span>{current.level}</span>{/if}
                  </span>
                  <span class="flashcard__term" class:long={current.text.length > LONG_TEXT_LENGTH} lang="en" translate="no">{current.text}</span>
                  {#if current.transcription}
                    <span class="flashcard__transcription ipa" translate="no">{current.transcription}</span>
                  {/if}
                  <span class="flashcard__hint">Say it aloud, then tap to see the meaning</span>
                </span>

                <span class="flashcard__face flashcard__face--back" aria-hidden={!flipped}>
                  <span class="flashcard__label">Translation</span>
                  <span class="flashcard__translation" class:long={current.translation.length > LONG_TEXT_LENGTH} lang={current.id.startsWith('user:') ? '' : 'uk'}>
                    {current.translation}
                  </span>
                  {#if example}
                    <span class="flashcard__example">
                      <span class="flashcard__label">Example</span>
                      <span class="example__text" lang="en" translate="no">{example.en}</span>
                      {#if example.ua}<span class="example__translation" lang={current.id.startsWith('user:') ? '' : 'uk'}>{example.ua}</span>{/if}
                    </span>
                  {/if}
                  {#if current.alternatives.length}
                    <span class="flashcard__meta">Also said: <span lang="en" translate="no">{current.alternatives.join('; ')}</span></span>
                  {/if}
                  {#if current.section}
                    <span class="flashcard__meta">Section: {current.section}</span>
                  {/if}
                </span>
              </span>
            </button>

            <div class="flashcard__speak">
              {#if !flipped}
                <SpeakButton text={current.text} label="Listen" />
              {:else if example}
                <SpeakButton text={example.en} label="Listen to example" />
              {/if}
            </div>
          </article>

          <span class="swipe-badge swipe-badge--know" class:visible={dragX > 0} class:ready={swipeAnswer === 'know' || exitDirection === 1} aria-hidden="true">
            I know it
          </span>
          <span class="swipe-badge swipe-badge--again" class:visible={dragX < 0} class:ready={swipeAnswer === 'again' || exitDirection === -1} aria-hidden="true">
            Keep learning
          </span>
        </div>
      {/key}

      <div class="flashcard-actions">
        <Button variant="secondary" icon="arrow-left" disabled={busy} onClick={() => answer('again')}>Keep learning</Button>
        <IconButton icon="flip" label="Flip card" variant="secondary" disabled={busy} onClick={flip} />
        <Button variant="known" iconEnd="arrow-right" disabled={busy} onClick={() => answer('know')}>I know it</Button>
      </div>

      <p class="flashcard-keys">
        Keyboard: <kbd>←</kbd> Keep learning, <kbd>→</kbd> I know it, <kbd>Enter</kbd> or <kbd>Space</kbd> flips the card
      </p>
      <p class="flashcard-touch-hint">Swipe right if you know it, left to keep learning</p>
    </div>
  {:else if total === 0}
    <EmptyState
      title="No cards in this deck"
      text={deck.hiddenCount
        ? 'Every item here is hidden. Unhide items on the Phrases or Words page to study them.'
        : 'This topic has no vocabulary yet. Choose another topic or switch to All Vocabulary.'}
    />
  {:else}
    <div class="flashcards-complete">
      <Icon name="check-circle" size={40} />
      <h2 class="panel__title">Deck complete</h2>
      <p>You know all {plural(total, 'card')} in {deckLabel}.</p>
      <div class="flashcards-review__footer">
        <Button variant="primary" icon="list" onClick={() => (view = 'review')}>Review learned vocabulary</Button>
        <Button variant="danger" icon="reset" onClick={requestReset}>Reset progress for {deckLabel}</Button>
      </div>
    </div>
  {/if}
</section>

<ConfirmDialog
  open={confirmReset}
  title={`Reset progress for “${deckLabel}”?`}
  confirmLabel="Reset this deck"
  onConfirm={resetDeck}
  onCancel={() => (confirmReset = false)}
  returnFocus={afterResetFocus}
>
  <p>{plural(learnedCount, 'learned card')} in this deck will return to the learning deck, and the deck starts from its first card.</p>
  <p>Other decks, your Focus list and hidden items are not changed.</p>
</ConfirmDialog>
