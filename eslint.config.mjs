import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierPlugin from 'eslint-plugin-prettier/recommended';

export default tseslint.config(
  {
    ignores: [
      '.sst/',
      '.git/',
      'node_modules/',
      'dist/',
      'dashboard/',
      'sst-env.d.ts',
      'scripts/sst-env.d.ts',
      '.aiready/',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettierPlugin,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-alert': 'error',
    },
  },
  {
    files: ['sst.config.ts'],
    rules: {
      '@typescript-eslint/triple-slash-reference': 'off',
    },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  }
);
