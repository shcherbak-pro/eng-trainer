<script lang="ts">
  import Icon from './Icon.svelte';
  import type { IconName } from './icons';

  /** Visual role. "danger" is only for destructive actions. */
  export let variant: 'primary' | 'secondary' | 'quiet' | 'danger' | 'known' | 'focus' = 'secondary';
  export let size: 'sm' | 'md' | 'lg' = 'md';
  export let icon: IconName | undefined = undefined;
  export let iconEnd: IconName | undefined = undefined;
  export let type: 'button' | 'submit' = 'button';
  export let disabled = false;
  /** Accessible name when it must say more than the visible text. It must contain the visible text. */
  export let label: string | undefined = undefined;
  /** Toggle state (aria-pressed). Leave undefined for ordinary buttons. */
  export let pressed: boolean | undefined = undefined;
  export let expanded: boolean | undefined = undefined;
  export let controls: string | undefined = undefined;
  export let describedby: string | undefined = undefined;
  export let busy = false;
  export let wide = false;
  export let onClick: ((event: MouseEvent) => void) | undefined = undefined;
  export let element: HTMLButtonElement | undefined = undefined;
  let className = '';
  export { className as class };
</script>

<!-- Other attributes, such as data-* hooks, are passed through; the declared ones above take precedence. -->
<button
  {...$$restProps}
  bind:this={element}
  {type}
  class={`btn btn--${variant} btn--${size} ${className}`}
  class:btn--wide={wide}
  class:is-pressed={pressed === true}
  {disabled}
  aria-label={label}
  aria-pressed={pressed}
  aria-expanded={expanded}
  aria-controls={controls}
  aria-describedby={describedby}
  aria-busy={busy || undefined}
  on:click={onClick}
>
  {#if icon}<Icon name={icon} size={size === 'sm' ? 18 : 20} />{/if}
  <span class="btn__text"><slot /></span>
  {#if iconEnd}<Icon name={iconEnd} size={size === 'sm' ? 18 : 20} />{/if}
</button>
