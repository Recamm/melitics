import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
          exclude: ['src/platforms/**/*.test.ts'],
          clearMocks: true,
          restoreMocks: true,
        },
      },
      {
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: ['src/platforms/**/*.test.ts'],
          clearMocks: true,
          restoreMocks: true,
        },
      },
    ],
  },
});