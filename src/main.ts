import { mount } from 'svelte';
import App from './app/App.svelte';
import { startThemeSync } from './app/theme';
import './app.css';

const target = document.getElementById('app');

if (!target) {
  throw new Error('App target element #app was not found');
}

startThemeSync();

const app = mount(App, { target });

export default app;
