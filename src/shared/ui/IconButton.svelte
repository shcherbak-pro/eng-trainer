<script lang="ts">
  import Icon from './Icon.svelte';
  import type { IconName } from './icons';

  export let icon: IconName;
  /** Required accessible name; also shown as a tooltip for pointer users. */
  export let label: string;
  export let variant: 'primary' | 'secondary' | 'quiet' | 'danger' | 'known' | 'focus' = 'quiet';
  /** Visual "on" state for state-changing buttons whose label already says what they do. */
  export let active = false;
  /** Toggle state (aria-pressed) for toggles whose label stays the same. */
  export let pressed: boolean | undefined = undefined;
  export let disabled = false;
  export let type: 'button' | 'submit' | 'reset' = 'button';
  export let round = false;
  export let onClick: (() => void) | undefined = undefined;
  export let element: HTMLButtonElement | undefined = undefined;
</script>

<!-- Other attributes, such as data-* hooks, are passed through; the declared ones above take precedence. -->
<button
  {...$$restProps}
  bind:this={element}
  class={`btn btn--${variant} btn--icon`}
  class:is-active={active}
  class:is-pressed={pressed === true}
  class:btn--round={round}
  {type}
  aria-label={label}
  aria-pressed={pressed}
  title={label}
  {disabled}
  on:click={onClick}
>
  <Icon name={icon} />
</button>
