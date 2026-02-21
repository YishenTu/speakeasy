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
  ],
  options: {
    tsPreCompilationDeps: true,
    combinedDependencies: true,
    doNotFollow: { path: 'node_modules' },
    exclude: '(^dist/)|(^node_modules/)',
  },
};
