import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

// Pure layers: domain rules, pricing and wire contracts must not touch the
// database, the framework, or the clock (STEP 04 gate M1, ADR-0009).
const PURE_LAYERS = [
  'src/domain/**/*.ts',
  'src/pricing/**/*.ts',
  'src/api/**/*.ts',
  'src/shared/**/*.ts',
  'src/import/**/*.ts',
  'src/review/**/*.ts',
];

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: PURE_LAYERS,
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['pg', 'pg-*'], message: 'Pure layers cannot depend on the database driver.' },
            {
              group: ['@/db', '@/db/*', '**/db/*'],
              message: 'Pure layers cannot depend on persistence.',
            },
            {
              group: ['next', 'next/*', 'react', 'react-dom'],
              message: 'Pure layers cannot depend on the framework.',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: 'Pure layers receive `asOf` explicitly; do not read the clock.',
        },
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: 'Pure layers receive `asOf` explicitly; do not read the clock.',
        },
        {
          selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']",
          message: 'Pure layers must be deterministic.',
        },
      ],
    },
  },
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'coverage/**',
    'next-env.d.ts',
    'node_modules/**',
    'tools/**',
    '.import/**',
  ]),
]);
