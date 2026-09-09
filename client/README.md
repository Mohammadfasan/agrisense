# @agrisense/client

React 18 + TypeScript + Vite PWA. No SSR — the app is installed to the device
and must work with no connection at all.

```bash
npm run dev:client        # http://localhost:5173
npm run build --workspace client
```

`/api` is proxied to `http://localhost:4000` in development, so there is no CORS
hop and `VITE_API_BASE_URL` can stay empty.

## Layout

```
src/
├── app/          Shell: router, providers, layout, service worker
├── features/     One folder per slice: auth, farm, scan, market, officer
├── db/           Dexie (IndexedDB): schema.ts, repositories/, sync/
└── shared/       api client, components, hooks, i18n, styles
```

`@/` resolves to `src/` (declared in `tsconfig.app.json` and `vite.config.ts` —
both must agree).

Each feature exposes a barrel `index.ts`; routes import from the barrel, never
from a file inside another feature.

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

## i18n

`en`, `ta` and `si` catalogues start **empty**. Every `t()` call passes an
English default as its second argument:

```tsx
t('farm.title', 'My farms');
```

so the UI renders correctly before a single string is translated. The chosen
language persists to `localStorage` and sets `document.documentElement.lang`,
which is what drives the per-script line-height.

## Bundle

Routes are code-split with React Router's `lazy`, and vendor code is chunked in
`vite.config.ts`. Leaflet and Recharts are the two heaviest dependencies and
neither is needed to sign in, so both stay off the initial load — that is worth
several seconds on a 3G connection.
