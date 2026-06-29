<script lang="ts">
  import MaterialIcon from './MaterialIcon.svelte';

  export let icon: string;
  export let label: string;
  export let variant: 'primary' | 'secondary' | 'focus' | 'danger' | 'learned-btn' = 'secondary';
  export let active = false;
  export let disabled = false;
  export let type: 'button' | 'submit' | 'reset' = 'button';
  export let onClick: (() => void) | undefined = undefined;
</script>

<button
  class:active
  class={`btn ${variant} btn--icon-only`}
  type={type}
  aria-label={label}
  title={label}
  disabled={disabled}
  on:click={onClick}
>
  <MaterialIcon name={icon} />
</button>
