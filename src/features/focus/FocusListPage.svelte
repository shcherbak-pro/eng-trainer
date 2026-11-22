<script lang="ts">
  import { blockDescriptionLang } from '../../content/descriptionLanguage';
  import type { ContentCatalog } from '../../content/catalog';
  import type { TrainingBlock } from '../../content/types';
  import { pageForBlock } from '../../app/navigation';
  import { progress } from '../../state/progress';
  import FocusButton from '../../shared/entries/FocusButton.svelte';
  import IrregularVerbCard from '../../shared/entries/IrregularVerbCard.svelte';
  import PhraseCard from '../../shared/entries/PhraseCard.svelte';
  import WordCard from '../../shared/entries/WordCard.svelte';
  import SectionSpeechControl from '../../shared/speech/SectionSpeechControl.svelte';
  import EmptyState from '../../shared/ui/EmptyState.svelte';
  import { blockToSpeechItem, irregularVerbToSpeechItem, phraseToSpeechItem, wordToSpeechItem } from '../../shared/speech/speechFormatters';

  export let catalog: ContentCatalog;
  export let onOpenBlock: (block: TrainingBlock) => void;

  $: favoriteBlocks = catalog.blocks.filter((item) => $progress.favoriteBlocks.includes(item.id));
  $: favoritePhrases = catalog.phrases.filter((item) => $progress.favoritePhrases.includes(item.id) && !$progress.hiddenPhrases.includes(item.id));
  $: favoriteWords = catalog.wordIndex.filter((item) => $progress.favoriteWords.includes(item.id) && !$progress.hiddenWords.includes(item.id));
  $: favoriteIrregular = catalog.irregularVerbs.filter((item) => $progress.favoriteIrregular.includes(item.id) && !$progress.hiddenIrregular.includes(item.id));
  $: total = favoriteBlocks.length + favoritePhrases.length + favoriteWords.length + favoriteIrregular.length;
  $: speechItems = [
    ...favoriteBlocks.map(blockToSpeechItem),
    ...favoritePhrases.map(phraseToSpeechItem),
    ...favoriteWords.map(wordToSpeechItem),
    ...favoriteIrregular.map(irregularVerbToSpeechItem)
  ];
</script>

{#if total === 0}
  <EmptyState title="Your Focus list is empty" text="Use the Focus button on a phrase, word, verb or learning block to keep it here for repeated practice.">
    <a class="link-button" href="#phrases">Open the Library</a>
  </EmptyState>
{:else}
  <div class="list-header">
    <p class="list-header__count" role="status">{total} {total === 1 ? 'item' : 'items'} in your Focus list</p>
    <SectionSpeechControl controlId="focus-list" label="Listen to the list" items={speechItems} help="Reads everything in your Focus list." />
  </div>

  {#if favoriteBlocks.length}
    <section class="entry-group">
      <h2>Learning blocks</h2>
      <ul class="block-list">
        {#each favoriteBlocks as block (block.id)}
          <li class="block-row">
            <a class="block-row__open" href={`#${pageForBlock(block)}`} on:click|preventDefault={() => onOpenBlock(block)}>
              <span class="block-row__title">{block.title}</span>
              {#if block.description}<span class="block-row__meta" lang={blockDescriptionLang(block.id)}>{block.description}</span>{/if}
            </a>
            <div class="block-row__actions"><FocusButton kind="block" id={block.id} /></div>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if favoritePhrases.length}
    <section class="entry-group">
      <h2>Phrases</h2>
      <ul class="entry-list">{#each favoritePhrases as phrase (phrase.id)}<li><PhraseCard {phrase} /></li>{/each}</ul>
    </section>
  {/if}

  {#if favoriteWords.length}
    <section class="entry-group">
      <h2>Words</h2>
      <ul class="entry-list">{#each favoriteWords as item (item.id)}<li><WordCard {item} /></li>{/each}</ul>
    </section>
  {/if}

  {#if favoriteIrregular.length}
    <section class="entry-group">
      <h2>Irregular verbs</h2>
      <ul class="entry-list">{#each favoriteIrregular as verb (verb.id)}<li><IrregularVerbCard {verb} /></li>{/each}</ul>
    </section>
  {/if}
{/if}
