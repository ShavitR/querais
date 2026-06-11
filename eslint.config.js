// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/artifacts/**',
      '**/cache/**',
      '**/typechain-types/**',
      '**/coverage/**',
      'packages/contracts/exports/**',
      'packages/contracts/deployments/**',
      'packages/contracts/src/abis.ts', // auto-generated from artifacts
      'apps/dashboard/**', // dashboard has its own (Vite/React) lint scope
      'sdk-python/**', // Python toolchain (ruff/pytest) — incl. its local .venv
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
);
