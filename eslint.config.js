import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'desktop/**', 'public/**', 'third_party/**', 'playwright-report/**', 'test-results/**', 'tools/inspect-glb.mjs'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    // The simulation is plain TypeScript: no React, three.js, DOM or browser storage.
    files: ['src/sim/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [
        { group: ['react', 'react-dom', 'react/*'], message: 'src/sim must not import React.' },
        { group: ['three', 'three/*'], message: 'src/sim must not import three.js.' },
        { group: ['@/render/*', '@/ui/*', '@/audio/*', '@/save/*', '../render/*', '../ui/*', '../audio/*', '../save/*'], message: 'src/sim must not depend on render, ui, audio or save.' },
      ] }],
      'no-restricted-globals': ['error', 'window', 'document', 'localStorage', 'sessionStorage', 'indexedDB', 'navigator', 'requestAnimationFrame', 'fetch', 'performance', 'Audio', 'Image', 'HTMLElement'],
    },
  },
);
