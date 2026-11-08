import js from '@eslint/js'
import ts from 'typescript-eslint'

// Selected from tutor-platform/eslint.config.js; framework and style rules stay local to that app.
export default ts.config(
  { ignores: ['node_modules/**', 'dist/**', 'dist-desktop/**', 'output/**', '.playwright-cli/**'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...ts.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      eqeqeq: ['error', 'always'],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'error',
      '@typescript-eslint/no-unsafe-type-assertion': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: false }],
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/only-throw-error': 'error',
      '@typescript-eslint/prefer-promise-reject-errors': 'error',
      '@typescript-eslint/no-base-to-string': 'error',
      '@typescript-eslint/no-misused-spread': 'error',
      '@typescript-eslint/use-unknown-in-catch-callback-variable': 'error',
      '@typescript-eslint/return-await': ['error', 'error-handling-correctness-only'],
      '@typescript-eslint/restrict-template-expressions': ['error', {
        allow: [], allowArray: false, allowAny: false, allowBoolean: false,
        allowNullish: false, allowNumber: true, allowNever: false, allowRegExp: false,
      }],
      '@typescript-eslint/restrict-plus-operands': ['error', {
        allowAny: false, allowBoolean: false, allowNullish: false,
        allowNumberAndString: false, allowRegExp: false,
      }],
    },
  },
)
