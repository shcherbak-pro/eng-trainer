<script lang="ts">
  import Icon from './Icon.svelte';
  import type { IconName } from './icons';

  /** Success, information, warning and error look different by icon and title, not by colour alone. */
  export let tone: 'info' | 'success' | 'warning' | 'error' = 'info';
  export let title = '';
  /** Live-region role. Errors interrupt (alert); other changes are polite (status). "none" is static text. */
  export let role: 'alert' | 'status' | 'none' | undefined = undefined;
  /** Lets the page move focus to this notice, for example an error summary. */
  export let focusable = false;
  export let element: HTMLDivElement | undefined = undefined;
  let className = '';
  export { className as class };

  const icons: Record<typeof tone, IconName> = { info: 'info', success: 'check-circle', warning: 'warning', error: 'error' };
  const titleId = `notice-${Math.random().toString(36).slice(2, 10)}`;
  $: liveRole = role === 'none' ? undefined : (role ?? (tone === 'error' ? 'alert' : 'status'));
  // A notice that has a role is named by its title, so focusing it announces what it is about.
  $: labelledBy = title && liveRole ? titleId : undefined;
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex (tabindex is only ever -1: focus is moved here by script, never by Tab.) -->
<div bind:this={element} class={`notice notice--${tone} ${className}`} role={liveRole} aria-labelledby={labelledBy} tabindex={focusable ? -1 : undefined}>
  <Icon name={icons[tone]} />
  <div class="notice__body">
    {#if title}<p class="notice__title" id={titleId}>{title}</p>{/if}
    <slot />
    {#if $$slots.actions}<div class="notice__actions"><slot name="actions" /></div>{/if}
  </div>
</div>
