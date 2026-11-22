import { defineConfig } from 'vitest/config';
import base from '../../../vitest.config';
export default defineConfig({ ...base, test: { ...base.test,
  include: ['docs/reviews/eng-v2-03-astra/independent.test.ts'],
  fileParallelism: false,
  testTimeout: 15000
} });
