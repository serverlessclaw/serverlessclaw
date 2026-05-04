import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierPlugin from 'eslint-plugin-prettier/recommended';

export default tseslint.config(
  {
    ignores: [
      '.sst/',
      '**/.sst/',
      '.turbo/',
      '**/.turbo/',
      '.opencode/',
      '**/.opencode/',
      '.git/',
      'node_modules/',
      '**/node_modules/',
      'dist/',
      '**/dist/',
      'apps/dashboard/.next/',
      'apps/dashboard/.open-next/',
      'apps/dashboard/out/',
      'apps/dashboard/build/',
      'coverage/',
      '**/coverage/',
      'test-results/',
      '**/test-results/',
      'reports/',
      '**/reports/',
      '*.zip',
      '*.tsbuildinfo',
      '*.tmp',
      'lint_report.json',
      'sst-env.d.ts',
      '**/sst-env.d.ts',
      '.aiready/',
      '**/.aiready/',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettierPlugin,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/preserve-caught-error': 'off',
      'preserve-caught-error': 'off',
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
