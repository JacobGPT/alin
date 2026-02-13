module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
    'plugin:react/recommended',
    'plugin:react/jsx-runtime',
  ],
  ignorePatterns: ['dist', '.eslintrc.cjs'],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    project: ['./tsconfig.json', './tsconfig.node.json'],
    tsconfigRootDir: __dirname,
  },
  plugins: ['react-refresh', '@typescript-eslint', 'react'],
  settings: {
    react: {
      version: 'detect',
    },
  },
  rules: {
    'react-refresh/only-export-components': [
      'warn',
      { allowConstantExport: true },
    ],
    '@typescript-eslint/no-unused-vars': ['warn', { 
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_' 
    }],
    '@typescript-eslint/no-explicit-any': 'warn',
    'react/prop-types': 'off',
    'no-console': ['warn', { allow: ['warn', 'error'] }],
  },
  overrides: [
    // RULE 1: Core files (kernel, executive, memory) MAY NOT import from products
    {
      files: [
        'src/api/**/*.ts',
        'src/alin-kernel/**/*.ts',
        'src/store/**/*.ts',
        'src/services/**/*.ts',
        'src/alin-executive/**/*.ts',
        'src/alin-memory/**/*.ts',
      ],
      rules: {
        'no-restricted-imports': ['error', {
          patterns: [{
            group: ['**/products/**', '@products/*', '@products/**'],
            message: 'ALIN Architecture Violation: Core layers cannot import from products. Use productRegistry instead.',
          }],
        }],
      },
    },
    // RULE 2: Shared types may NOT import from any layer
    {
      files: ['src/types/**/*.ts', 'src/shared/**/*.ts'],
      rules: {
        'no-restricted-imports': ['error', {
          patterns: [{
            group: [
              '**/store/**', '**/services/**', '**/api/**',
              '**/components/**', '**/products/**',
              '@store/*', '@api/*', '@components/*', '@products/*',
              '@kernel/*', '@executive/*', '@memory/*', '@surface/*',
            ],
            message: 'ALIN Architecture Violation: Shared types cannot import from any layer.',
          }],
        }],
      },
    },
    // RULE 3: Kernel may NOT import stores, services, or surface
    {
      files: ['src/alin-kernel/**/*.ts'],
      rules: {
        'no-restricted-imports': ['error', {
          patterns: [{
            group: [
              '**/store/**', '**/services/**', '**/components/**',
              '@store/*', '@executive/*', '@memory/*', '@surface/*',
            ],
            message: 'ALIN Architecture Violation: Kernel can only import from shared types and other kernel primitives.',
          }],
        }],
      },
    },
    // RULE 4: Executive may NOT import React or surface
    {
      files: ['src/alin-executive/**/*.ts'],
      rules: {
        'no-restricted-imports': ['error', {
          patterns: [{
            group: ['react', 'react-dom', '**/components/**', '@components/*', '@surface/*', '**/alin-surface/**'],
            message: 'ALIN Architecture Violation: Executive layer cannot depend on React or surface concerns.',
          }],
        }],
      },
    },
  ],
}
