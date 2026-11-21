<script lang="ts">
  import type { ContentCatalog } from '../../content/catalog';
  import type { TrainingBlock } from '../../content/types';
  import { progress } from '../../state/progress';
  import PhraseCard from '../../shared/entries/PhraseCard.svelte';
  import WordCard from '../../shared/entries/WordCard.svelte';
  import IrregularVerbCard from '../../shared/entries/IrregularVerbCard.svelte';
  import EmptyState from '../../shared/ui/EmptyState.svelte';
  import SectionSpeechControl from '../../shared/speech/SectionSpeechControl.svelte';
  import IconButton from '../../shared/ui/IconButton.svelte';
  import { blockToSpeechItem, irregularVerbToSpeechItem, phraseToSpeechItem, wordToSpeechItem } from '../../shared/speech/speechFormatters';

  export let catalog: ContentCatalog;
  export let onOpenBlock: (block: TrainingBlock) => void;

  $: favoriteBlocks = catalog.blocks.filter((item) => $progress.favoriteBlocks.includes(item.id));
  $: favoritePhrases = catalog.phrases.filter((item) => $progress.favoritePhrases.includes(item.id) && !$progress.hiddenPhrases.includes(item.id));
  $: favoriteWords = catalog.wordIndex.filter((item) => $progress.favoriteWords.includes(item.id) && !$progress.hiddenWords.includes(item.id));
  $: favoriteIrregular = catalog.irregularVerbs.filter((item) => $progress.favoriteIrregular.includes(item.id) && !$progress.hiddenIrregular.includes(item.id));
  $: isEmpty = !favoriteBlocks.length && !favoritePhrases.length && !favoriteWords.length && !favoriteIrregular.length;
  $: speechItems = [
    ...favoriteBlocks.map(blockToSpeechItem),
    ...favoritePhrases.map(phraseToSpeechItem),
    ...favoriteWords.map(wordToSpeechItem),
    ...favoriteIrregular.map(irregularVerbToSpeechItem)
  ];
</script>

<section class="section-stack">
  <div class="toolbar-card focus-toolbar">
    <div>
      <h2>Focus List</h2>
      <p>Your favorite blocks, phrases, words, and verbs for focused revision.</p>
    </div>
    <SectionSpeechControl controlId="focus-list" label="Listen focus" items={speechItems} help="Reads all materials from your Focus List." />
  </div>

  {#if isEmpty}
    <EmptyState title="Focus list is empty" text="Add blocks, phrases, words or verbs to focus from any learning page." />
  {:else}
    {#if favoriteBlocks.length}
      <h3>Blocks</h3>
      <div class="block-grid">
        {#each favoriteBlocks as block}
          <article class="card block-card">
            <p class="tag-row"><span>{block.tag ?? block.type}</span></p>
            <h3>{block.title}</h3>
            <p>{block.description}</p>
            <div class="card__actions">
              <IconButton icon="arrow_forward" label={`Open ${block.title}`} variant="primary" onClick={() => onOpenBlock(block)} />
              <IconButton icon="star" label={`Remove ${block.title} from Focus List`} variant="focus" active onClick={() => progress.toggleFavorite('block', block.id)} />
            </div>
          </article>
        {/each}
      </div>
    {/if}

    {#if favoritePhrases.length}
      <h3>Phrases</h3>
      <div class="cards-list">{#each favoritePhrases as phrase}<PhraseCard {phrase} />{/each}</div>
    {/if}

    {#if favoriteWords.length}
      <h3>Words</h3>
      <div class="cards-list">{#each favoriteWords as item}<WordCard {item} />{/each}</div>
    {/if}

    {#if favoriteIrregular.length}
      <h3>Irregular verbs</h3>
      <div class="cards-list">{#each favoriteIrregular as verb}<IrregularVerbCard {verb} />{/each}</div>
    {/if}
  {/if}
</section>
