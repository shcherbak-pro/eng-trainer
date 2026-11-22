<script lang="ts">
  import type { ContentCatalog } from '../../content/catalog';
  import { progress } from '../../state/progress';
  import { translationLang } from '../../shared/text';
  import SpeakButton from '../../shared/speech/SpeakButton.svelte';
  import Button from '../../shared/ui/Button.svelte';

  export let catalog: ContentCatalog;

  type ReverseItem = {
    id: string;
    type: 'phrase' | 'word';
    prompt: string;
    promptLang: 'uk' | '';
    answer: string;
    example?: string;
  };

  let current: ReverseItem | null = null;
  let answer = '';
  let revealed = false;
  let result = '';

  function buildItems(): ReverseItem[] {
    const phraseItems = catalog.phrases
      .filter((item) => !$progress.hiddenPhrases.includes(item.id))
      .map((item) => ({ id: item.id, type: 'phrase' as const, prompt: item.translation, promptLang: translationLang(item), answer: item.phrase, example: item.example }));
    const wordItems = catalog.wordIndex
      .filter((item) => !$progress.hiddenWords.includes(item.id))
      .map((item) => ({ id: item.id, type: 'word' as const, prompt: item.meaning, promptLang: translationLang(item), answer: item.term, example: item.examples[0]?.en }));
    return [...phraseItems, ...wordItems];
  }

  function next(): void {
    const items = buildItems();
    current = items[Math.floor(Math.random() * items.length)] ?? null;
    answer = '';
    result = '';
    revealed = false;
  }

  function check(): void {
    if (!current) return;
    const expected = current.answer.toLowerCase().replace(/[.…]/g, '').trim();
    const actual = answer.toLowerCase().replace(/[.…]/g, '').trim();
    result = actual && expected.includes(actual) || actual === expected ? 'Looks close. Good job.' : 'Not exact yet. Show the answer and repeat it aloud.';
  }

  $: if (!current && catalog) next();
</script>

<div class="page-stack">
  <p class="muted">Read the Ukrainian meaning, say the English phrase aloud or type it, then check.</p>

  {#if current}
    <article class="reverse-card">
      <p class="entry__meta"><span class="badge">{current.type === 'phrase' ? 'Phrase' : 'Word'}</span></p>
      <h2 class="reverse-card__prompt" lang={current.promptLang} translate="no">{current.prompt}</h2>
      <label class="field">
        <span class="field__label">Your answer in English</span>
        <textarea bind:value={answer} rows="3" lang="en" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Type the English phrase…"></textarea>
      </label>
      <div class="reverse-card__actions">
        <Button variant="primary" icon="check" onClick={check}>Check answer</Button>
        <Button variant="secondary" icon={revealed ? 'eye-off' : 'eye'} pressed={revealed} onClick={() => (revealed = !revealed)}>Show answer</Button>
        <Button variant="quiet" icon="shuffle" onClick={next}>Next phrase</Button>
      </div>
      <p class="list-header__count" role="status">{result}</p>
      {#if revealed}
        <div class="practice-answer__reveal">
          <p class="practice-answer__english" lang="en" translate="no">{current.answer}</p>
          {#if current.example}<p class="example__text" lang="en" translate="no">{current.example}</p>{/if}
          <div class="reverse-card__actions">
            <SpeakButton text={current.answer} withText />
            {#if current.example}<SpeakButton text={current.example} label="Listen to example" withText />{/if}
          </div>
        </div>
      {/if}
    </article>
  {/if}
</div>
