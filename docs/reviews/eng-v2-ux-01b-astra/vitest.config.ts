import { defineConfig, mergeConfig } from 'vitest/config';
import base from '../../../vite.config';
export default mergeConfig(base, defineConfig({
 resolve:{conditions:['browser']},
 test:{environment:'jsdom',include:['docs/reviews/eng-v2-ux-01b-astra/*.test.ts'],setupFiles:['src/test/setup.ts'],testTimeout:10000}
}));
