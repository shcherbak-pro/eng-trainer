import { defineConfig } from 'vitest/config';
import base from '../../../vitest.config';
// This diagnostic deliberately reproduces an unhandled rejection. Each expected
// rejection is captured and asserted, and its full stack is saved in reset-race.json.
export default defineConfig({ ...base, test: { ...base.test,
  include: ['docs/reviews/eng-v2-03-astra/race-probe.test.ts'],
  fileParallelism: false, testTimeout: 15000, dangerouslyIgnoreUnhandledErrors: true
} });
