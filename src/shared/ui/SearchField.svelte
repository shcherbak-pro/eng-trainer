<script lang="ts">
  import Icon from './Icon.svelte';

  export let label: string;
  export let value = '';
  export let placeholder = '';
  export let onInput: (value: string) => void;
</script>

<label class="search-field">
  <span class="visually-hidden">{label}</span>
  <Icon name="search" />
  <input
    type="search"
    {value}
    {placeholder}
    autocomplete="off"
    spellcheck="false"
    enterkeyhint="search"
    on:input={(event) => onInput((event.currentTarget as HTMLInputElement).value)}
  />
</label>
