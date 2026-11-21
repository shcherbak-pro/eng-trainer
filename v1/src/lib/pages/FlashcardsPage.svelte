<script lang="ts">
  import { onDestroy } from 'svelte';
  import { progress } from '../stores/progress';
  import type { Materials } from '../types/materials';
  import type { Flashcard, FlashcardAnswer, FlashcardMode } from '../types/flashcards';
  import {
    actionForKey,
    answerCard,
    answerForSwipe,
    buildFlashcards,
    deckKey,
    filterDeck,
    getTopics,
    isHorizontalDrag,
    resolveSession,
    shuffleSession,
    summarizeDeck
  } from '../utils/flashcards';
  import EmptyState from '../components/EmptyState.svelte';
  import IconButton from '../components/IconButton.svelte';
  import MaterialIcon from '../components/MaterialIcon.svelte';
  import SpeakButton from '../components/SpeakButton.svelte';

  export let materials: Materials;

  /** Time the card needs to leave the screen before the next one appears. */
  const EXIT_MS = 200;
  const LONG_TEXT_LENGTH = 70;

  let view: 'learn' | 'review' = 'learn';
  let flipped = false;
  let notice = '';

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

  $: cards = buildFlashcards(materials);
  $: cardById = new Map(cards.map((card) => [card.id, card]));
  $: topics = getTopics(cards);
  $: topicStats = topics.map((name) => {
    const summary = summarizeDeck(filterDeck(cards, 'topic', name), $progress);
    return { name, learned: summary.learned.length, total: summary.learned.length + summary.learning.length };
  });

  $: mode = $progress.flashcardMode;
  $: topic = topics.includes($progress.flashcardTopic) ? $progress.flashcardTopic : (topics[0] ?? '');
  $: currentDeckKey = deckKey(mode, topic);
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
    const targetDeckKey = currentDeckKey;
    const targetSession = session;

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

      progress.saveFlashcardSession(targetDeckKey, next, choice === 'know' ? card.learnIds : []);
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
    progress.setFlashcardMode(next);
  }

  function setTopic(event: Event): void {
    notice = '';
    progress.setFlashcardTopic((event.target as HTMLSelectElement).value);
  }

  function shuffle(): void {
    if (busy || remaining < 2) return;
    notice = 'Deck shuffled.';
    flipped = false;
    cardSerial += 1;
    progress.saveFlashcardSession(currentDeckKey, shuffleSession(session));
  }

  function learnAgain(card: Flashcard): void {
    progress.relearnFlashcards(card.learnIds);
  }

  function resetDeck(): void {
    if (busy || !learnedCount) return;

    const confirmed =
      typeof window === 'undefined' ||
      window.confirm(
        `Reset progress for "${deckLabel}"? ${plural(learnedCount, 'learned card')} will return to the learning deck.`
      );
    if (!confirmed) return;

    progress.resetFlashcardDeck(
      currentDeckKey,
      deck.learned.flatMap((card) => card.learnIds)
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

<section class="section-stack flashcards-page">
  <div class="toolbar-card controls-stack flashcards-toolbar">
    <div class="flashcards-toolbar__header">
      <h2>Flashcards</h2>
      <div class="control-actions">
        <IconButton icon="shuffle" label="Shuffle remaining cards" variant="secondary" disabled={view !== 'learn' || remaining < 2} onClick={shuffle} />
        <IconButton
          icon={view === 'review' ? 'style' : 'checklist'}
          label={view === 'review' ? 'Back to flashcards' : 'Review learned vocabulary'}
          variant="secondary"
          active={view === 'review'}
          onClick={() => (view = view === 'review' ? 'learn' : 'review')}
        />
        <IconButton icon="restart_alt" label={`Reset progress for ${deckLabel}`} variant="danger" disabled={!learnedCount} onClick={resetDeck} />
      </div>
    </div>
    <p class="flashcards-toolbar__intro">Swipe right if you know it, left to keep learning. Tap the card to flip it.</p>

    <div class="flashcards-deck">
      <div class="segmented" role="group" aria-label="Deck">
        <button type="button" class:active={mode === 'all'} aria-pressed={mode === 'all'} on:click={() => setMode('all')}>
          All Vocabulary
        </button>
        <button
          type="button"
          class:active={mode === 'topic'}
          aria-pressed={mode === 'topic'}
          disabled={!topics.length}
          on:click={() => setMode('topic')}
        >
          By Topic
        </button>
      </div>

      {#if mode === 'topic'}
        <label>
          Topic
          <select value={topic} on:change={setTopic}>
            {#each topicStats as item (item.name)}
              <option value={item.name}>{item.name} ({item.learned}/{item.total} learned)</option>
            {/each}
          </select>
        </label>
      {/if}
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
        <span style={`width: ${learnedPercent}%`}></span>
      </div>
      {#if deck.hiddenCount}
        <p class="flashcards-progress__note muted">
          {plural(deck.hiddenCount, 'hidden item')} left out. Unhide on the Phrases or Words page to include.
        </p>
      {/if}
      <p class="flashcards-progress__note" role="status">{notice}</p>
    </div>
  </div>

  {#if view === 'review'}
    <div class="card flashcards-review">
      <div class="card__header">
        <div>
          <h3>Learned vocabulary</h3>
          <p class="muted">{plural(learnedCount, 'learned card')} in {deckLabel}.</p>
        </div>
        <button type="button" class="btn secondary" on:click={() => (view = 'learn')}>Back to flashcards</button>
      </div>

      {#if learnedCount}
        <ul class="flashcards-review__list">
          {#each deck.learned as card (card.id)}
            <li>
              <div class="flashcards-review__text">
                <strong>{card.text}</strong>
                <span class="translation">{card.translation}</span>
              </div>
              <div class="flashcards-review__actions">
                <SpeakButton text={card.text} label={`Speak: ${card.text}`} />
                <button type="button" class="btn focus" on:click={() => learnAgain(card)}>Learn again</button>
              </div>
            </li>
          {/each}
        </ul>
        <div class="card__actions">
          <button type="button" class="btn danger" on:click={resetDeck}>Reset progress for {deckLabel}</button>
        </div>
      {:else}
        <p class="muted">Nothing learned here yet. Swipe a card right or press “I know it” to add it to this list.</p>
      {/if}
    </div>
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
                  <span class="flashcard__term" class:long={current.text.length > LONG_TEXT_LENGTH}>{current.text}</span>
                  {#if current.transcription}
                    <span class="flashcard__transcription">{current.transcription}</span>
                  {/if}
                  <span class="flashcard__hint"><MaterialIcon name="touch_app" /> Tap to flip</span>
                </span>

                <span class="flashcard__face flashcard__face--back" aria-hidden={!flipped}>
                  <span class="flashcard__label">Translation</span>
                  <span class="flashcard__translation" class:long={current.translation.length > LONG_TEXT_LENGTH}>
                    {current.translation}
                  </span>
                  {#if example}
                    <span class="flashcard__example">
                      <span class="flashcard__label">Example</span>
                      <span class="example">{example.en}</span>
                      {#if example.ua}<span class="translation">{example.ua}</span>{/if}
                    </span>
                  {/if}
                  {#if current.alternatives.length}
                    <span class="flashcard__meta"><strong>Common alternatives:</strong> {current.alternatives.join('; ')}</span>
                  {/if}
                  {#if current.section}
                    <span class="flashcard__meta"><strong>Section:</strong> {current.section}</span>
                  {/if}
                </span>
              </span>
            </button>

            <div class="flashcard__speak">
              {#if !flipped}
                <SpeakButton text={current.text} label="Speak" />
              {:else if example}
                <SpeakButton text={example.en} label="Speak example" icon="record_voice_over" />
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
        <button type="button" class="btn focus" disabled={busy} on:click={() => answer('again')}>
          <MaterialIcon name="arrow_back" /> Keep learning
        </button>
        <IconButton icon="flip" label="Flip card" variant="secondary" disabled={busy} onClick={flip} />
        <button type="button" class="btn learned-btn" disabled={busy} on:click={() => answer('know')}>
          I know it <MaterialIcon name="arrow_forward" />
        </button>
      </div>

      <p class="flashcard-keys muted">
        Keyboard: <kbd>←</kbd> Keep learning · <kbd>→</kbd> I know it · <kbd>Enter</kbd> / <kbd>Space</kbd> Flip
      </p>
      <p class="flashcard-touch-hint muted">Swipe right: I know it · Swipe left: Keep learning</p>
    </div>
  {:else if total === 0}
    <EmptyState
      title="No cards in this deck"
      text={deck.hiddenCount
        ? 'Every item here is hidden. Unhide items on the Phrases or Words page to study them.'
        : 'This topic has no vocabulary yet. Choose another topic or switch to All Vocabulary.'}
    />
  {:else}
    <div class="card flashcards-complete">
      <MaterialIcon name="celebration" />
      <h3>Deck complete</h3>
      <p>You know all {plural(total, 'card')} in {deckLabel}.</p>
      <div class="card__actions">
        <button type="button" class="btn primary" on:click={() => (view = 'review')}>Review learned vocabulary</button>
        <button type="button" class="btn danger" on:click={resetDeck}>Reset progress</button>
      </div>
    </div>
  {/if}
</section>
