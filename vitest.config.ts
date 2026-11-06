import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    // The HTML report inlines tokens.css via ?raw; Vitest blanks CSS it isn't told to process.
    css: { include: [/tokens\.css/] },
  },
});
