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
      // Core engines, view/formatting utilities, SQLite migrations & repository,
      // and pure/ephemeral stores are all held to the coverage bar.
      include: [
        'src/core/**/*.ts',
        'src/utils/**/*.ts',
        'src/database/migrations.ts',
        'src/database/plans-repository.ts',
        'src/database/web-fallback.ts',
        'src/store/plan-store.ts',
        'src/store/network-store.ts',
        'src/store/vlsm-store.ts',
      ],
      exclude: ['src/core/errors.ts', 'src/utils/index.ts'],
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
