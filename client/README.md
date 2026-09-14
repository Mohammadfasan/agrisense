# @agrisense/client

React 18 + TypeScript + Vite PWA. No SSR — the app is installed to the device
and must work with no connection at all.

```bash
npm run dev:client        # http://localhost:5173
npm run build --workspace client
```

`/api` is proxied to `http://localhost:4000` in development, so there is no CORS
hop and `VITE_API_URL` can stay empty.

## Layout

```
src/
├── app/          Shell: router, providers, layout, service worker
├── features/     One folder per slice: auth, home, farm, scan, market, profile, officer
├── db/           Dexie (IndexedDB): schema.ts, repositories/, sync/
└── shared/       api client, components, hooks, i18n, styles, utils
```

`@/` resolves to `src/` (declared in `tsconfig.app.json` and `vite.config.ts` —
both must agree).

Each feature exposes a barrel `index.ts`; routes import from the barrel, never
from a file inside another feature.

## Routing

`app/router.tsx`. Guards are pathless layout routes that render `<Outlet />`
(or `children`), so each wraps a whole subtree:

| Path                                                        | Guard                                                                |
| ----------------------------------------------------------- | -------------------------------------------------------------------- |
| `/login`                                                    | public                                                               |
| `/`, `/plots`, `/plots/:id`, `/scan`, `/market`, `/profile` | `ProtectedRoute`                                                     |
| `/officer/*`                                                | `ProtectedRoute` → `RoleRoute` (officer, admin) → `DesktopOnlyRoute` |

`ProtectedRoute` passes the original path to `/login` as router state, and
sign-in returns there. `RoleRoute` is navigation only — the API's `authorise()`
is the real check.

## API client

`shared/api/client.ts` attaches the access token to every request. On a 401 it
calls `/auth/refresh` and replays the request once.

- A burst of 401s shares a single refresh. This is required, not an
  optimisation: the server rotates refresh tokens and revokes the session when
  one is presented twice.
- If the server rejects the refresh token (400/401/403), auth state is cleared
  and the app redirects to `/login`. A network error or 5xx leaves the session
  alone, so losing signal never signs a farmer out.
- The refresh call goes through a separate axios instance with no interceptors,
  so it can never trigger another refresh.

## Offline model

Writes never block on the network:

1. A repository writes the row to IndexedDB **and** appends to the `outbox`
   table in one Dexie transaction.
2. The UI reads through `useLiveQuery`, so it re-renders from the local write
   immediately.
3. `db/sync/syncEngine.ts` drains the outbox oldest-first on reconnect and on a
   30 s timer, stopping at the first failure so writes stay ordered.

Rows carry a client-generated UUID as their primary key, so a record can be
created, referenced and displayed before the server has ever seen it.

## Design tokens

Defined in `tailwind.config.ts`. The four brand hexes are exactly Tailwind's
`green-600`, `red-600`, `amber-500` and `gray-500`, so each token aliases its
source scale — `bg-primary` is the specified `#16a34a`, and `bg-primary-700` is
a real hover shade from the same ramp rather than a hand-mixed guess.

| Token     | Hex       | Source scale |
| --------- | --------- | ------------ |
| `primary` | `#16a34a` | green        |
| `danger`  | `#dc2626` | red          |
| `warning` | `#f59e0b` | amber        |
| `muted`   | `#6b7280` | gray         |

`min-h-touch` / `min-w-touch` / `p-touch` are 44px, the WCAG 2.5.5 minimum. Use
them on anything tappable — the `.btn` component class already does.

Font stack is Inter → Noto Sans Tamil → Noto Sans Sinhala. Sinhala and Tamil
glyphs are taller than Latin, so `:lang(si)` and `:lang(ta)` get extra
line-height in `shared/styles/index.css`.

## UI primitives

`shared/components` exports `Button` (primary, secondary, danger; `loading`),
`Input` (always labelled; `hint`, `error`), `Card` (`padding`), `Spinner` and
`EmptyState`. Import them from the barrel:

```tsx
import { Button, Card } from '@/shared/components';
```

Every interactive primitive is at least 44px tall (`min-h-touch`), colours come
from the `primary`/`danger`/`warning`/`muted` tokens in `tailwind.config.ts`,
and button styles live in `shared/styles/index.css` so `className="btn-primary"`
and `<Button>` always match.

In development, **`/dev/components`** renders every primitive in every variant
and state. The route is not registered in production builds.

## i18n

`en`, `ta` and `si` catalogues hold only the keys translated so far — today,
the app and auth shells. Every `t()` call still passes an English default as
its second argument:

```tsx
t('farm.title', 'My farms');
```

so a screen renders correctly before its strings reach the catalogues. A key
missing from `ta` or `si` falls back to `en`, then to that default.

Language is picked by `i18next-browser-languagedetector`: a choice saved under
`agrisense.lang` in `localStorage` first, then the device language (`ta-LK`
resolves to `ta`), then `en`. Every change is written back to the same key.
The language also sets `document.documentElement.lang`, which is what drives
the per-script line-height.

## Bundle

Routes are code-split with React Router's `lazy`, and vendor code is chunked in
`vite.config.ts`. Leaflet and Recharts are the two heaviest dependencies and
neither is needed to sign in, so both stay off the initial load — that is worth
several seconds on a 3G connection.
