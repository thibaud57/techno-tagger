// @ts-check
const eslint = require("@eslint/js")
const { defineConfig } = require("eslint/config")
const tseslint = require("typescript-eslint")
const angular = require("angular-eslint")
const prettier = require("eslint-config-prettier/flat")

module.exports = defineConfig([
  {
    files: ["**/*.ts"],
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
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
      angular.configs.tsRecommended,
    ],
    // Sans ce processor, les templates inline echappent aux regles HTML et le
    // composant passe le lint sans que son template soit verifie.
    processor: angular.processInlineTemplates,
    rules: {
      // Une seule forme de fonction dans tout le TypeScript, exportee ou locale : sans la regle,
      // le style derive au premier fichier ecrit (cf. .claude/rules/typescript/types.md).
      "func-style": ["error", "expression"],
      // Un composant sans logique est une classe vide decoree : legitime en Angular
      "@typescript-eslint/no-extraneous-class": ["error", { allowWithDecorator: true }],
      // Un nombre interpole n'a qu'un rendu possible, contrairement a un objet ou un nullish
      // qui restent interdits. C'est le defaut de la regle, seul strict-type-checked le coupe.
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      "@angular-eslint/directive-selector": [
        "error",
        {
          type: "attribute",
          prefix: "app",
          style: "camelCase",
        },
      ],
      "@angular-eslint/component-selector": [
        "error",
        {
          type: "element",
          prefix: "app",
          style: "kebab-case",
        },
      ],
    },
  },
  {
    files: ["**/*.spec.ts"],
    rules: {
      // Un mock se lit par reference (`expect(service.method)`), jamais appele : aucun `this`
      // a perdre. `vi.mocked()` ne suffit pas, la lecture de la methode est deja la reference.
      "@typescript-eslint/unbound-method": "off",
      // Les crochets sur un membre protected pilotent le composant depuis son test sans
      // elargir sa surface publique.
      "@typescript-eslint/dot-notation": ["error", { allowProtectedClassPropertyAccess: true }],
    },
  },
  {
    files: ["**/*.html"],
    // templateAccessibility n'est pas inclus dans templateRecommended
    extends: [angular.configs.templateRecommended, angular.configs.templateAccessibility],
  },
  // En dernier : il desactive des regles, tout bloc place apres les retablirait
  prettier,
])
