<script lang="ts">
  import { ICONS, type IconName } from './icons';

  export let name: IconName;
  /** Rendered size in CSS pixels; the drawing grid is always 24 × 24. */
  export let size = 20;
</script>

<svg class="icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
  {#each ICONS[name] as shape}
    {#if 'd' in shape}
      <path d={shape.d} class:icon__fill={shape.fill} />
    {:else}
      <circle cx={shape.cx} cy={shape.cy} r={shape.r} class:icon__fill={shape.fill} />
    {/if}
  {/each}
</svg>

<style>
  .icon {
    flex: none;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.75;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .icon__fill {
    fill: currentColor;
    stroke: none;
  }
</style>
