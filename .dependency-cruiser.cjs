/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular dependencies make module initialization order fragile.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'shared-must-be-runtime-agnostic',
      severity: 'error',
      comment: 'Shared contracts cannot depend on app runtime layers.',
      from: { path: '^src/shared' },
      to: { path: '^src/(background|chatpanel|options)(/|$)' },
    },
    {
      name: 'background-no-ui-imports',
      severity: 'error',
      comment: 'Background is backend-only and must not depend on UI surfaces.',
      from: { path: '^src/background(/|$)' },
      to: { path: '^src/(chatpanel|options)(/|$)' },
    },
    {
      name: 'chatpanel-no-background-or-options-imports',
      severity: 'error',
      comment: 'Chatpanel can import shared, but not background/options internals.',
      from: { path: '^src/chatpanel(/|$)' },
      to: { path: '^src/(background|options)(/|$)' },
    },
    {
      name: 'options-no-background-or-chatpanel-imports',
      severity: 'error',
      comment: 'Options can import shared, but not background/chatpanel internals.',
      from: { path: '^src/options(/|$)' },
      to: { path: '^src/(background|chatpanel)(/|$)' },
    },
    {
      name: 'chatpanel-features-no-app-imports',
      severity: 'error',
      comment: 'Chatpanel feature modules must not depend on app-level orchestration.',
      from: { path: '^src/chatpanel/features(/|$)' },
      to: { path: '^src/chatpanel/app(/|$)' },
    },
    {
      name: 'chatpanel-core-no-app-or-feature-imports',
      severity: 'error',
      comment:
        'Core modules must stay framework-agnostic and independent from app/features/template.',
      from: { path: '^src/chatpanel/core(/|$)' },
      to: { path: '^src/chatpanel/(app|features|template)(/|$)' },
    },
    {
      name: 'chatpanel-features-no-template-imports',
      severity: 'error',
      comment: 'Feature logic should not depend on template composition modules.',
      from: { path: '^src/chatpanel/features(/|$)' },
      to: { path: '^src/chatpanel/template(/|$)' },
    },
    {
      name: 'chatpanel-template-no-app-imports',
      severity: 'error',
      comment: 'Chatpanel templates/styles must stay independent from app orchestration.',
      from: { path: '^src/chatpanel/template(/|$)' },
      to: { path: '^src/chatpanel/app(/|$)' },
    },
    {
      name: 'chatpanel-no-legacy-root-module-imports',
      severity: 'error',
      comment:
        'Chatpanel internals should use core/features layers, not root-level legacy modules.',
      from: { path: '^src/chatpanel/(app|features|core)(/|$)' },
      to: {
        path: '^src/chatpanel/(?!chatpanel\\.ts$|template\\.ts$)[^/]+\\.ts$',
      },
    },
  ],
  options: {
    tsPreCompilationDeps: true,
    combinedDependencies: true,
    doNotFollow: { path: 'node_modules' },
    exclude: '(^dist/)|(^node_modules/)',
  },
};
