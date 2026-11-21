<script lang="ts">
  import type { ContentCatalog } from '../../content/catalog';
  import { progress } from '../../state/progress';
  import SpeakButton from '../../shared/speech/SpeakButton.svelte';
  import IconButton from '../../shared/ui/IconButton.svelte';

  export let catalog: ContentCatalog;

  type ReverseItem = {
    id: string;
    type: 'phrase' | 'word';
    prompt: string;
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
      .map((item) => ({ id: item.id, type: 'phrase' as const, prompt: item.translation, answer: item.phrase, example: item.example }));
    const wordItems = catalog.wordIndex
      .filter((item) => !$progress.hiddenWords.includes(item.id))
      .map((item) => ({ id: item.id, type: 'word' as const, prompt: item.meaning, answer: item.term, example: item.examples[0]?.en }));
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
    result = actual && expected.includes(actual) || actual === expected ? 'Looks close. Good job.' : 'Not exact yet. Reveal and repeat it aloud.';
  }

  $: if (!current && catalog) next();
</script>

<section class="section-stack">
  <div class="toolbar-card">
    <div>
      <h2>Reverse Practice</h2>
      <p>Бачиш український переклад — згадуєш англійську фразу.</p>
    </div>
    <IconButton icon="shuffle" label="Next random item" variant="primary" onClick={next} />
  </div>

  {#if current}
    <article class="card practice-card">
      <p class="tag-row"><span>{current.type}</span></p>
      <h3>{current.prompt}</h3>
      <label>
        Your answer
        <textarea bind:value={answer} placeholder="Type the English phrase here…"></textarea>
      </label>
      <div class="card__actions">
        <IconButton icon="fact_check" label="Check answer" variant="primary" onClick={check} />
        <IconButton
          icon={revealed ? 'visibility_off' : 'visibility'}
          label={revealed ? 'Hide answer' : 'Show answer'}
          variant="secondary"
          onClick={() => revealed = !revealed}
        />
      </div>
      {#if result}<p class="notice">{result}</p>{/if}
      {#if revealed}
        <div class="answer-box">
          <strong>{current.answer}</strong>
          {#if current.example}<p>{current.example}</p>{/if}
          <SpeakButton text={current.answer} />
          {#if current.example}<SpeakButton text={current.example} label="Speak example" />{/if}
        </div>
      {/if}
    </article>
  {/if}
</section>
