import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration.
 *
 * Deliberately standalone: no React Native preset, no jsdom, no Babel pipeline.
 * The networking engine is pure TypeScript, so it is tested in a plain Node
 * environment. That is the payoff of keeping `src/core` free of any React or
 * Expo imports - if this config ever needs an RN transform, the architecture
 * has been violated.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      // Only pure logic is held to a coverage bar. UI files are covered by
      // type-checking and device testing, not by unit tests.
      include: ['src/core/**/*.ts', 'src/utils/**/*.ts'],
      exclude: ['src/core/errors.ts'],
      reporter: ['text-summary', 'html'],
      thresholds: {
        lines: 95,
        functions: 95,
        branches: 90,
        statements: 95,
      },
    },
  },
});
