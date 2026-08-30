// @ts-check
const eslint = require('@eslint/js');
const { defineConfig } = require('eslint/config');
const tseslint = require('typescript-eslint');
const angular = require('angular-eslint');
const prettier = require('eslint-config-prettier/flat');

module.exports = defineConfig([
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        // Trois zones cohabitent dans ce depot : sans ancrage explicite, le
        // mauvais tsconfig est resolu.
        tsconfigRootDir: __dirname,
      },
    },
    extends: [
      eslint.configs.recommended,
      tseslint.configs.recommended,
      tseslint.configs.stylistic,
      angular.configs.tsRecommended,
    ],
    // Sans ce processor, les templates inline echappent aux regles HTML et le
    // composant passe le lint sans que son template soit verifie.
    processor: angular.processInlineTemplates,
    rules: {
      '@angular-eslint/directive-selector': [
        'error',
        {
          type: 'attribute',
          prefix: 'app',
          style: 'camelCase',
        },
      ],
      '@angular-eslint/component-selector': [
        'error',
        {
          type: 'element',
          prefix: 'app',
          style: 'kebab-case',
        },
      ],
    },
  },
  {
    files: ['**/*.html'],
    // templateAccessibility n'est pas inclus dans templateRecommended
    extends: [angular.configs.templateRecommended, angular.configs.templateAccessibility],
  },
  // En dernier : il desactive des regles, tout bloc place apres les retablirait
  prettier,
]);
