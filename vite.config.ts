import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: '/flip-a-coin/',
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
