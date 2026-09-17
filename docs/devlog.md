# Development Log

Running notes on what was built each day, and the decisions behind it that the
code cannot explain on its own.

---

## Day 9 — Farmer profile (server + client)

**Shipped.** A `farmerProfiles` collection, `/api/v1/farmers/me` (GET/PUT/PATCH)
behind `authenticate` + `authorise('farmer')`, a new `@agrisense/shared`
workspace holding the Zod schemas both halves validate against, profile state
in the client auth store, a `RequireProfile` route guard, a three-step
onboarding wizard at `/onboarding`, and a view/edit profile screen at
`/profile`. 70 server tests pass (32 new for `/farmers/me`, plus an index
assertion for the new collection); all three workspaces typecheck and lint
clean; the client builds.

### Decisions not specified in the brief

**Feature layout.** The brief asked for `server/src/routes/farmers.ts` and
`server/src/services/farmerProfile.service.ts`. Built instead as
`server/src/modules/farmers/` — routes, controller and service together — to
match `modules/auth/` and `modules/health/`, the `@modules` alias and the
"New modules mount here" note in `app.ts`. A third organisational pattern for
one feature seemed worse than consistency. Easy to move if the layered shape
was deliberate.

**`ref: 'Farmer'`, not `'User'`.** There is no `User` model; `farmers` is the
identity collection (`docs/schema.md` §1).

**The shared package is built twice, ESM and CommonJS.** Not planned. A single
CommonJS build typechecks and works in `vite dev` — Vite pre-bundles it — and
then fails the production build, because Rollup cannot read named exports out
of CommonJS: `import { DISTRICTS } from '@agrisense/shared'` errored only at
`vite build`. The package now emits `dist/esm` and `dist/cjs` behind an
`exports` map, relative imports inside it carry `.js` extensions (required for
the ESM output, harmless for the other), and `scripts/stamp-module-type.mjs`
writes a `package.json` into each output folder so Node reads each with the
right module system. Worth knowing before adding a second shared package.

**Locale and GeoJSON primitives moved.** `LOCALES`, `Locale`, `GeoPoint`,
`geoPointSchema` and friends now live in `@agrisense/shared`;
`server/src/shared/types.ts` re-exports them, so every existing `@shared`
import still works. Leaving a second copy in the API is the exact drift the new
package exists to prevent — the client was already hand-mirroring
`FARMER_ROLES` in a comment.

**`latitudeSchema` / `longitudeSchema` added to the shared package.** Step 3
collects a latitude and a longitude as two fields and has to validate them one
at a time; `geoPositionSchema` is a tuple and cannot be taken apart. These are
what it is built from, so there is one definition of `-90..90`.

**`isBootstrapping` added to the auth store**, beyond the fields the brief
listed. `RequireProfile` shows a full-page spinner while the app starts, and
hanging that off the existing `isLoading` would have thrown the spinner over
the whole screen every time the profile screen saved an edit.

**`RequireProfile` has a fourth state.** The brief lists three
(bootstrapping/unknown, unauthenticated, `none`, `complete`). If the bootstrap
finishes and the status is _still_ `unknown` — the fetch failed on something
other than "no profile", which offline is the common case — it shows an error
with a retry button. A spinner there never resolves, and routing to
`/onboarding` would ask a farmer to retype a profile the server may already
hold. `profileStatus` only becomes `none` when the server actually answers
`PROFILE_NOT_FOUND`.

**Non-farmer roles settle as `complete`, not `none`.** Officers and admins have
no farmer profile and `/farmers/me` would 403 them; marking them `none` would
route them to onboarding.

**The wizard's schema is derived, not the shared one verbatim.**
`farmerProfileSchema.omit({ location, preferredLanguage }).extend({ latitude,
longitude })`. A GeoJSON Point is the right shape to store and the wrong shape
to collect, and the wizard never asks for a language — one was chosen on S-01,
and the API defaults the field from the farmer record. Every rule still comes
from the shared package.

**Validation messages are ours, not Zod's.** One translated message per field
rather than per failure. Zod's are English ("String must contain at least 2
character(s)"), which is the wrong language for two thirds of this audience;
and for someone reading with difficulty, "Enter your full name, at least 2
letters" beats knowing which bound they tripped.

**The draft schema is separate from the validation schema.** sessionStorage
holds work in progress, so it has to accept a half-typed name and an empty crop
list. A lenient schema keeps junk out without deciding what is valid.

**`ChoiceGroup` is a new shared component**, built on real radios and
checkboxes rather than buttons with `aria-pressed`, so arrow-key navigation and
"3 of 5" announcements come for free. District and crop pickers compose it.

**"Enter coordinates by hand" is always available.** The brief asks for the
manual fallback when permission is _denied_; without an explicit way in, a
farmer who never taps GPS, or taps it and gets a timeout, cannot finish.

**A language switcher on the profile screen.** `auth.language.hint` already
promised "You can change this later from your profile", which was untrue.

**PATCH sends `location` whole** if either coordinate is dirty — half a
coordinate pair is not a location — and an empty patch short-circuits without a
request.

### Known gaps and risks

- **The Tamil and Sinhala strings are machine-written and need a native
  reviewer.** Key parity is verified (96 keys in all three catalogues) but
  wording, register and the administrative terms are not.
- **Crop icons are approximations.** lucide has no onion or brinjal, so those
  borrow a bulb-and-shoot and a purple cluster. `crops.imageUrl`
  (`docs/schema.md` §5) is where the real artwork belongs; `crops.ts` should be
  replaced by it, not extended.
- **`landSizeAcres` vs `plots.areaHectares`.** Two units for land area in one
  schema. Implemented as specified; it will confuse someone eventually.
- **The write-through to `farmers` is two writes, not a transaction.** The
  in-memory MongoDB the tests run against is a standalone and has none. A crash
  between them leaves the farmer record stale until the next save.
- **No client tests.** The client workspace has no test runner; adding one is a
  new dependency and was out of scope. The wizard, the guard and the
  dirty-field diffing are covered by typecheck and lint only.
- **Not exercised in a real browser.** No browser driver in the repo. Modules
  transform, the production build succeeds and the dev server serves cleanly,
  but the GPS permission path, the sessionStorage resume and the step
  transitions have not been clicked through.

### Dependencies added

`react-hook-form` and `@hookform/resolvers` (item 8 names both), agreed
beforehand. They land in a lazy chunk shared by `/onboarding` and `/profile`:
**~17 kB gzipped**, and the initial entry bundle is unchanged at 384,591 bytes
(384,590 before). Also `@agrisense/shared` as a workspace dependency of both
`server` and `client`.

---

## Day 10 Part B — Plot screens (client)

**Shipped.** A client-side UUID v4 helper, a Zustand `plotStore` over
`/api/v1/plots`, and three screens behind `RequireProfile`: a card list at
`/plots` with an empty state and a floating add button, and one shared form at
`/plots/new` and `/plots/:id/edit`, with delete behind a confirmation dialog.
Two new UI primitives (`Textarea`, `ConfirmDialog`). Tamil and Sinhala keys
added alongside the English ones — 136 keys in each of the three catalogues,
parity verified. The client typechecks, lints and builds; the entry bundle is
unchanged at 384,591 bytes, and dropping the leaflet map from `/plots` takes
its chunk out of the build entirely.

### Decisions not specified in the brief

**`PUT` for the edit too, carrying `boundary` through.** The obvious reading is
`PATCH` for an edit, as `/profile` does. It is wrong here: `PUT` replaces the
whole resource, `PATCH` cannot clear an optional field, and the form owns every
writable field except `boundary` — so a farmer correcting a plot's name with
`PUT` would silently erase an outline these screens cannot draw. `toPlotInput`
takes the existing boundary and hands it back, which makes `PUT` safe and keeps
the screens on the same endpoint offline sync will replay into. Polygon drawing
is out of scope (centroid plus acres only), so nothing here can create one yet;
the carry-through is for the day something can.

**The card opens the edit form; there is no read-only detail screen.**
Everything a plot holds fits on the form, and a detail screen would be a list
of values with an Edit button above it — one tap of overhead per change, for a
farmer wearing gloves.

**Delete lives on the edit screen, not on the card.** A trash icon beside a
full-width link on a 360px screen is an accidental-tap hazard, and the
confirmation dialog is the second line of defence rather than the first.

**`client/src/lib/uuid.ts`, as the brief names it.** Every other client helper
is under `src/shared/utils/`. Built where it was asked for; it is a one-line
move if the convention was meant to win.

**`ConfirmDialog` is a native `<dialog>`.** Focus trapping, inertness and
Escape come with the element. Not `window.confirm`, which blocks the renderer
and cannot be translated — and the translation is the point on this app.

**`plotStore` resets when the signed-in account changes.** A shared phone is
the normal case here, not the edge one, and without it the next farmer to sign
in sees the previous one's plots until the fetch lands.

**The list is kept in the server's own order.** `mergePlot` inserts by
`updatedAt` descending with `_id` as the tie-break, exactly as `plot.service`
sorts, so a plot fetched by id for a deep link cannot land at the front and put
the list in an order the next cursor disagrees with.

**`FarmListPage` and the `PlotDetailPage` stub are gone.** Day-1 scaffolding
over a local Dexie `farms` table, which the plots API supersedes; `/plots`
cannot be owned by both. The leaflet map it carried is in git history, and
belongs with the boundary editor rather than in a list that has no boundaries
to draw.

### Known gaps and risks

- **The Tamil and Sinhala strings are machine-written and need a native
  reviewer**, as on Day 9. Key parity is verified; wording and register are
  not.
- **Not exercised in a real browser.** Same as Day 9: no browser driver in the
  repo. Typecheck, lint and the production build pass, but the GPS path, the
  date field, the confirmation dialog and the 360px layout have not been
  clicked through.
- **No client tests**, so the store's paging merge and the form's `PUT` body
  are covered by the typechecker only.
- **Cursor paging is a "Show more" button.** Correct, and not what a farmer
  with a hundred plots expects. Nobody has that many yet.
- **`plantedAt` is a day stored as an instant.** Written and read as midnight
  UTC so the round trip is stable, which is right for `+05:30` and would show
  the previous day to anyone west of Greenwich.
- **Plots are not offline-first yet.** The store is memory-only and every
  action needs a connection; the Dexie outbox (Week 6) is where that belongs,
  and a second cached copy of the list here would only have to be reconciled
  with it later.

### Dependencies added

None. `crypto.randomUUID` falls back to the `uuid` package, which was already a
dependency of the API client.

---

## Day 10 Part C — Mobile home shell (client)

**Shipped.** A home screen at `/` behind `RequireProfile`, laid out for a 360px
phone: a greeting by name, a leaf-scan card, a plots summary card, and a two-up
row for market prices and the profile. A rebuilt farmer shell around it — a
compact header with a connectivity slot and a notification bell, and a
four-tab bottom nav whose targets clear 48px. One flag per unfinished feature
in `app/features.ts`, read by the nav, the cards and the router. LKR currency
formatting in the i18n layer, before the screen that needs it exists. Tamil and
Sinhala keys alongside the English ones — 152 keys in each of the three
catalogues, parity verified. Housekeeping: `baseUrl` is gone from every
tsconfig in the repo. 96 server tests pass, all three workspaces typecheck and
lint clean, and the client builds to 13 chunks totalling 662,586 bytes of JS.

### Decisions not specified in the brief

**The home screen is nearly empty, and that is the feature.** Recent scans,
live prices, a weather forecast and outbreak alerts are all things a dashboard
here would show, and not one of them has a data source before Week 5. The cost
of a placeholder card with a plausible number in it is not a wasted afternoon;
it is that a farmer who discovers one number on this app was invented has no
reason to believe the disease warning when it arrives.

**Four bottom-nav tabs, not five.** Market prices was the fifth. On a 360px
phone a fifth column is 72px, which cannot hold a 48px target with a wrapped
"சுயவிவரம்"-length label under it. Prices live on the home screen as a card
until Week 7, and the tab comes back when there is something behind it.

**A disabled feature is not routable.** `FEATURES.scan.enabled` gates the nav
item, the home card _and_ the route, so there is no state where the tab is grey
but typing `/scan` opens a half-built screen. Turning the feature on is editing
one `false`. A side effect worth noting: with `/market` unmounted, recharts is
no longer in the production build at all.

**Disabled things are `<span>`s and `<div>`s, not disabled `<button>`s.** A card
for a feature that does not exist is not a control that happens to be off — it
is text, and it becomes a real `<Link>` the moment its flag flips. So it stays
out of the tab order, and the "coming soon" badge carries the reason for
everyone, with an `sr-only` copy where the badge would not fit (the nav, the
bell).

**48px targets, not the 44px the guideline allows.** WCAG 2.5.5 is written for
someone sitting down. This audience is standing in a field, one hand on the
phone, sun on the glass, often with wet hands. New `touch-md` token; the old
`touch` (44px) stays for forms.

**The plots total is shown only when the whole list is loaded.** `/plots` is
cursor-paged, so summing the store after one page would under-report the acres
of anyone with more plots than a page holds — and a partial total is
indistinguishable from a correct one. Until the list is complete the card says
"Plots" and leads to the screen that can explain itself.

**`ConnectivityStatus` replaces `OfflineBanner`.** Offline is this user's
normal condition, not an incident, and a full-width warning bar several times
an hour trains someone to ignore the bar. It is a chip in the header instead,
and it is where Week 6 appends "· N pending" from the outbox. It reads no sync
state today on purpose: a count rendered over a sync engine that does not exist
is a claim the app cannot back.

**Currency is in the i18n layer with no price screen to use it.** The first
place a number gets a currency beside it is the place the symbol gets
hardcoded, and on this project the symbol that would be hardcoded is `₹` —
every Indian-market example and every Tamil-language design reference writes
it. This is Sri Lanka: LKR, "Rs.". The digits are grouped by `Intl` in the
farmer's language and the symbol comes from the catalogues, because `Intl`'s
own LKR symbol disagrees with itself across locales — on one runtime `si` gives
"රු." while `ta` and `en` both give "LKR".

**Tamil and Sinhala get their own rupee abbreviation** — "ரூ." and "රු." — not
a transliterated "Rs.". It is one catalogue string per language if that call is
wrong; what cannot appear in any of them is the Indian sign.

**`baseUrl` removal changed the server's aliases, not just the client's.** The
client's `@/*` was already the erroring one and is now `./src/*`, matching
`vite.config.ts`. The server's eight aliases were written against
`baseUrl: "./src"` and are now rooted at their own tsconfig. Verified through
all three consumers: `tsc`, `tsc-alias` on the build output, and
`vite-tsconfig-paths` under vitest.

### Known gaps and risks

- **The Tamil and Sinhala strings are machine-written and need a native
  reviewer**, as on Days 9 and 10B. Key parity is verified; wording and
  register are not. The greeting and the rupee abbreviations are the two worth
  a second opinion first.
- **Still not exercised in a real browser.** No browser driver in the repo, and
  the screen sits behind a session and a profile. Typecheck, lint, the server
  suite and the production build pass; the 360px layout, the wrapped nav labels
  and the disabled states have not been looked at on a phone.
- **No client tests.** Adding a runner to the client means adding a dependency,
  which needs a decision rather than a commit. `formatCurrency` and the plots
  summary — the rounding, the plural forms, the paged-list guard — are the
  first things worth covering when there is one.
- **The notification bell is inert chrome.** It is on screen so that the place a
  farmer will look for a district warning does not move in Week 8, which is a
  bet that it reads as "not yet" rather than as "broken".
- **`README.md` and `client/package.json` fail `format:check`** on line endings
  alone (CRLF in the working tree). Pre-existing, untouched here, and a
  whole-file rewrite either way — left for a commit that is about nothing else.

### Dependencies added

None.
