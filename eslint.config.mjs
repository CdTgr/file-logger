// @ts-check
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended'
import simpleImportSort from 'eslint-plugin-simple-import-sort'
import unusedImports from 'eslint-plugin-unused-imports'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  // ── Global ignores ──────────────────────────────────────────────────────────
  { ignores: ['dist/**', 'node_modules/**', 'src/public/**'] },

  // ── TypeScript ──────────────────────────────────────────────────────────────
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': 'off', // handled by unused-imports below
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-non-null-assertion': 'warn',
    },
  },

  // ── Unused imports ──────────────────────────────────────────────────────────
  {
    plugins: { 'unused-imports': unusedImports },
    rules: {
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'warn',
        {
          vars: 'all',
          varsIgnorePattern: '^_',
          args: 'after-used',
          argsIgnorePattern: '^_',
        },
      ],
    },
  },

  // ── Import sort ─────────────────────────────────────────────────────────────
  {
    plugins: { 'simple-import-sort': simpleImportSort },
    rules: {
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
    },
  },

  // ── General rules ───────────────────────────────────────────────────────────
  {
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
      curly: 'error',
      'padding-line-between-statements': [
        'error',
        { blankLine: 'always', prev: 'directive', next: '*' },
        { blankLine: 'always', prev: '*', next: 'return' },
      ],
      'no-console': [
        'warn',
        { allow: ['warn', 'error', 'info', 'time', 'timeEnd'] },
      ],
      'arrow-body-style': ['error', 'as-needed'],
    },
  },

  // ── Entry-point scripts (console output is intentional) ───────────────────
  {
    files: ['src/server.ts', 'src/ingest.ts', 'src/watcher.ts'],
    rules: { 'no-console': 'off' },
  },

  // ── Prettier (must be last to override formatting rules) ───────────────────
  eslintPluginPrettierRecommended,
)
