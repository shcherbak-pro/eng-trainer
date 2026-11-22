<script lang="ts">
  import { topicRoute } from '../../app/navigation';
  import type { LearningTopic, TrainingBlock } from '../../content/types';
  import type { TopicCompletion } from './homeStats';

  /** Entry cards for the learning topics of the active Learn Pass (ENG-V2-03). */
  export let topics: LearningTopic[];
  export let blocks: TrainingBlock[];
  export let completion: TopicCompletion[];
  export let onOpenBlock: (block: TrainingBlock) => void;

  $: entries = topics
    .map((topic) => ({ topic, block: blocks.find((block) => block.id === topic.blockId), counts: completion.find((item) => item.name === topic.title) }))
    .filter((entry): entry is { topic: LearningTopic; block: TrainingBlock; counts: TopicCompletion | undefined } => entry.block !== undefined);
</script>

{#if entries.length}
  <section class="home-topics" aria-labelledby="home-topics-title">
    <h2 id="home-topics-title" class="home-section-title">Learning topics</h2>
    <ul class="topic-cards">
      {#each entries as entry (entry.topic.id)}
        <li>
          <a class="topic-card" href={`#${topicRoute(entry.topic.id)}`} on:click|preventDefault={() => onOpenBlock(entry.block)}>
            <span class="topic-card__title">{entry.topic.title}</span>
            <span class="topic-card__description">{entry.topic.description}</span>
            {#if entry.counts}
              <span class="topic-card__meta">{entry.counts.learned} of {entry.counts.available} practice cards learned</span>
            {/if}
          </a>
        </li>
      {/each}
    </ul>
  </section>
{/if}
