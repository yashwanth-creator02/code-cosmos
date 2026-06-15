import typescriptEslint from 'typescript-eslint';

export default [
  {
    ignores: [
      'out/**',
      'dist/**',
      'node_modules/**',
      '.vscode-test/**',
      '*.vsix',
      'webview/main.js',
      'webview/main.js.map',
      'webview/bridge/messageBridge.js',
      'webview/bridge/messageBridge.js.map',
    ],
  },
  {
    files: ['**/*.ts'],
  },
  {
    plugins: {
      '@typescript-eslint': typescriptEslint.plugin,
    },

    languageOptions: {
      parser: typescriptEslint.parser,
      ecmaVersion: 2022,
      sourceType: 'module',
    },

    rules: {
      '@typescript-eslint/naming-convention': [
        'warn',
        {
          selector: 'import',
          format: ['camelCase', 'PascalCase'],
        },
      ],

      curly: 'warn',
      eqeqeq: 'warn',
      'no-throw-literal': 'warn',
      semi: 'warn',
    },
  },
];
