# Legacy Reference Inventory

Reference repository inspected: `/Volumes/MiDisco/equipo/opencloud-client`.

The reference repository was treated as read-only. It is not the foundation of Departify V2 and no directory was copied wholesale.

## Inventory

| Area                     | Reference evidence                                | Classification                       | Decision                                                                                                                                                                                            |
| ------------------------ | ------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build stack              | `package.json`, `vite.config.ts`, `tsconfig.json` | Reusable with adaptation             | Vite, React, React Router, React Query, Vitest, and Tailwind v4 are appropriate for the portal runtime. Config was rewritten inside `apps/portal` to match the Departify monorepo.                  |
| Design system tokens     | `src/design-system/tokens.css`                    | Reusable with adaptation             | The token approach is useful. Product-specific legacy comments, aliases, and broad visual language were not copied. Departify now has a minimal token layer in `apps/portal/src/styles/tokens.css`. |
| Classname helper         | `src/design-system/cn.ts`                         | Reusable later with adaptation       | The helper is generic, but Sprint 2 does not need class merging yet. Deferred until real UI primitives exist.                                                                                       |
| Theme provider           | `src/design-system/theme.tsx`                     | Reusable with adaptation             | The provider shape is useful, but storage keys and branding are legacy-specific. Deferred until theming is a real portal requirement.                                                               |
| App provider composition | `src/app/App.tsx`                                 | Reusable with adaptation             | The provider layering pattern is approved. Departify uses a new `AppProviders` boundary with React Query only. Toasts, i18n, theme, and auth are deferred.                                          |
| Routing                  | `src/app/router.tsx`                              | Reusable with adaptation             | React Router is approved. Legacy route map, guards, pages, auth redirects, and lazy page structure were discarded. Departify starts with one foundation route.                                      |
| Entrypoint               | `src/main.tsx`                                    | Reusable with adaptation             | The strict React root pattern is approved and rewritten for Departify.                                                                                                                              |
| i18n                     | `src/i18n/*`                                      | Reusable with adaptation             | The provider/catalog approach is useful, but the catalog contains product-specific strings. Deferred until Sprint 2+ explicitly scopes i18n.                                                        |
| Layout shell             | `src/layout/*`                                    | Discarded for Sprint 2               | Shell, sidebar, topbar, command palette, and notifications are product UX, not infrastructure foundation.                                                                                           |
| Components               | `src/components/*`                                | Mixed; mostly discarded for Sprint 2 | Generic primitives may be evaluated individually later. Auth, department, metrics, table, timeline, and product cards are not approved for bootstrap.                                               |
| Pages                    | `src/pages/*`                                     | Discarded                            | Pages are legacy product functionality and must not be migrated automatically.                                                                                                                      |
| API layer                | `src/api/*`                                       | Discarded                            | API clients, schemas, queries, and orchestration are business/backend coupling. Not part of portal infrastructure sprint.                                                                           |
| Hooks                    | `src/hooks/*`                                     | Reusable later with adaptation       | `useMediaQuery` and `useDebounce` are generic, but not needed in Sprint 2. Deferred.                                                                                                                |
| Utilities                | `src/utils/*`                                     | Reusable later with adaptation       | Some pure helpers are candidates, but auth redirect and lazy page helpers are tied to legacy routing. Deferred until concrete need.                                                                 |
| Tests                    | `src/**/*.test.*`, `src/test/*`                   | Reusable with adaptation             | Testing approach is approved. Departify now has a minimal Vitest smoke test for the portal shell.                                                                                                   |

## Approved For Sprint 2

- Vite + React portal runtime.
- React Router as the routing boundary.
- React Query provider as future data-fetching infrastructure.
- Tailwind v4-compatible CSS entry and token layer.
- Vitest + Testing Library test harness.
- Strict React root mounting.

## Explicitly Not Approved For Sprint 2

- Legacy pages.
- Legacy layouts.
- Authentication guards and login flows.
- API clients and schemas.
- Business Brain, departments, analytics, tasks, marketplace, memory, integrations, or orchestration features.
- Full design-system component migration.
- i18n catalog migration.
