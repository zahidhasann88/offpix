import js from '@eslint/js'
import ts from '@typescript-eslint/eslint-plugin'
import tsParser from '@typescript-eslint/parser'

export default [
  js.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { parser: tsParser },
    plugins: { '@typescript-eslint': ts },
    rules: {
      // TypeScript already reports undefined names and unused variables precisely.
      'no-undef': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'error',
    },
  },
  {
    files: ['build/sw-template.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        self: 'readonly', caches: 'readonly', fetch: 'readonly', Response: 'readonly', Headers: 'readonly', URL: 'readonly',
        // Replaced with the precache list at build time (build/offpix-plugins.ts).
        __PRECACHE__: 'readonly',
      },
    },
  },
]
