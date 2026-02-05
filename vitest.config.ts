import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'shared'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: [
      'server-plugin/__tests__/**/*.test.ts',
      'extension/__tests__/**/*.test.ts',
    ],
    coverage: {
      provider: 'v8',
      include: [
        'server-plugin/src/**/*.ts',
        'extension/src/**/*.ts',
        'shared/**/*.ts',
      ],
    },
  },
});
