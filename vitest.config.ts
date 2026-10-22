import { defineConfig } from 'vitest/config'

export default defineConfig({
  define: { __OFFPIX_PROFILE__: JSON.stringify('full'), __OFFPIX_PAGES_PARTS__: JSON.stringify([]) },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
  },
})
