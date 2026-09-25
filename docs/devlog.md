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

---

## Day 11 Part A — Crop calendar API (server)

**Shipped.** A `calendarTasks` collection, `/api/v1/calendar` (list, upcoming,
`PUT`, `PATCH`, complete, soft delete) behind `authenticate` + `authorise('farmer')`,
crop calendar templates for all five crops as reviewable data, task generation
wired into plot writes, and day-level date handling in `@agrisense/shared`. 122
server tests pass, 25 of them new. All three workspaces typecheck and lint
clean; the server and client both build.

### Decisions not specified in the brief

**The module is `server/src/modules/calendar/`, not `server/src/routes/`.** The
brief named the latter. Every feature in this API is a module — routes,
controller and service together, mounted through `@modules` — and a lone
`routes/` directory would be the only one of its kind. The rest of the brief
said to follow the plots patterns exactly, and this is one of them.

**`title` carries an i18n key on template tasks.** The model the brief specified
has `title` and `notes`; the template file it specified has `titleKey` and
`descriptionKey`. The only consistent reading is that a generated task stores the
key in `title` and the description key in `notes`, and that `source` is what
tells a client whether to translate the field or print it. A manual task's title
is what the farmer typed, in whatever language they typed it.

**`source` and `completedOn` are not writable through `PUT`.** A client that
could claim `template` could hide a task from regeneration, or hand the
generator a task it will delete; `source` is `$setOnInsert: 'manual'` and is
left alone on every replace. Completion is lifecycle state rather than content —
the same category as `version` and `deletedAt`, which `PUT` does not clear
either — so a phone replaying a two-day-old title edit cannot silently un-tick
finished work. `PATCH` _may_ set `completedOn`, including to `null`: a patch
names the field it means, and undoing an accidental tick has to be expressible.

**A second index.** The brief's `{ userId, plotId, deletedAt, dueDate }` cannot
serve `/calendar/upcoming`, which names no plot: `plotId` sits in the middle, so
an unconstrained query gets `userId` as its only usable prefix and sorts every
task the farmer owns in memory. `{ userId, deletedAt, dueDate }` was added
beside it.

**`/upcoming` includes overdue work and excludes completed work.** Neither is in
the name. A ticked task answers a different question from "what do I do next",
and a task due yesterday and not done is the most urgent thing a farmer owns —
a list that dropped it would hide a missed spray behind a clean screen. The
`days` window bounds the future end only.

**"Today" is today in Colombo.** `POST /:id/complete` takes the day from the
client when it sends one, because the phone knows what day it is where the
farmer is standing. The server's fallback shifts by +05:30 before taking the
date, or every completion between 18:30 and midnight UTC would be recorded
yesterday — which is the same bug the string dates exist to prevent.

**Regeneration is guarded on the planting day actually moving.** Every rebuild
mints new task ids, so regenerating on every `PUT` would churn a calendar the
phone is holding and force a reconcile of something that did not change.
`plot.service` reads the plot's `plantedAt` before the upsert for this, and only
for this; the upsert itself is still one atomic operation.

**Replaced template tasks are tombstoned, not removed.** A phone holding
yesterday's calendar has to be able to learn that those tasks are gone, and a
row that vanished tells it nothing — the same reasoning as every other delete in
`plots` and `calendarTasks`.

**Regeneration rebuilds the whole template, including activities whose old
counterpart was completed.** The completed task is kept as history and the fresh
one appears beside it. The alternative — suppressing an activity because
something of that type was ticked — is fuzzy matching on a plan the farmer just
corrected.

**Deleting a plot deletes its calendar, manual tasks included.** This is the one
place a manual task is not sacred: it is work on a field the farmer has just
said they no longer have, and left behind it would sit on the "what is due" list
with nothing to open.

**`GET /calendar` has a `limit` and no cursor.** The date range _is_ the paging;
a client wanting less asks for a narrower window. The cap (200, max 500) exists
so that a request with no range at all is still a bounded response.

**A backwards range is a `422`.** An empty list would be defensible and worse: a
client that swapped its two parameters would show "nothing due" rather than
saying what it asked for.

**`plotIdSchema` now points at a shared `uuidV4Schema`.** Two collections need
the same v4-only, lower-cased id, and a second copy of that regex is a second
thing to keep right. No behaviour change.

### Known gaps and risks

- **The agronomy is unreviewed.** Every `dayOffset` and `totalDays` in
  `crop-calendar-templates.json` is indicative dry-zone timing compiled from
  general guidance, and the file says so in its own `reviewStatus`. It needs an
  agronomist before release. That it is data rather than code is the point: the
  correction does not need a developer.
- **The i18n keys have no translations yet.** 50 activities × 2 keys × 3
  languages, all for Part B. Until then a client renders the key.
- **Regeneration is not transactional.** The deployment is a single mongod and
  this repo takes no dependency on a replica set, so the tombstone and the
  rebuild are two writes. The exposure is a delete that lands without its
  rebuild — an empty calendar, recoverable by re-saving the plot — which is why
  the delete is scoped to outstanding template tasks only and can never touch a
  manual or completed one.
- **`reminderAt` is stored and read by nothing.** Week 9. The field exists so
  the contract settles before the worker does.
- **Sri Lanka's UTC offset is a constant**, not a lookup. The country has
  observed +05:30 with no daylight saving since 2006; if that ever changes, one
  constant in `domain/dates.ts` is where it lives.
- **`npm run format:check` now flags ~80 files.** All of it is CRLF in the
  Windows working tree against Prettier's `endOfLine: "lf"`; the committed
  content is LF, and the count grew because the pre-commit stash rewrites files
  through git's autocrlf filter. A `.gitattributes` with `* text=auto eol=lf`
  would end it, and is a repo-wide commit of its own.

### Dependencies added

None.

---

## Day 11 Part B — Calendar screens (client)

**Shipped.** A Zustand `calendarStore` over `/api/v1/calendar`, a crop calendar
screen at `/plots/:id/calendar` with add/edit in a bottom sheet, a crop-stage
bar and next-due line on every plot card, an upcoming-tasks card on the home
screen, and day formatting in the i18n layer with Tamil and Sinhala month
names. 319 keys in each of the three catalogues, parity verified, including
translations for all 50 crop calendar activities. 124 server tests pass (two
new); all three workspaces typecheck and lint clean; the client builds.

### Decisions not specified in the brief

**The calendar is a list of four buckets, not a month grid.** A grid on a 360px
phone is thirty cells of four characters, and it answers "what is the date" —
which the farmer knows — instead of "what do I do now", which is why they
opened it. Overdue, today, this week, later; empty buckets are not rendered at
all, because four headings with nothing under three of them looks broken.

**Two targets per row, deliberately apart.** The body of the row opens the
editor; a 48px tick against the right edge completes the task. They are taken
in opposite circumstances — the tick standing in a field with muddy hands, the
editor sitting down — and a mis-tap between them costs either a lost record or
an unwanted form. The tick is a toggle: completing is undone by tapping again,
which sends `PATCH { completedOn: null }`, the only request that can express it.

**Completion sends the day the phone thinks it is.** The API would default to
today in Colombo, which is right for Sri Lanka and wrong for the farmer's own
device if it is ever set to something else. The client knows better and says so.

**Month names come from the catalogues, not `Intl`.** The Android WebViews this
app targets ship trimmed ICU data, and a device with no Sinhala calendar
answers in English — which looks like a working app to everyone testing it and
a broken one to the farmer holding it. The order of day, month and year is a
catalogue string too: Sinhala names the month first and the year before both.

**Only today and tomorrow are relative.** "In 3 days" reads as precision the
reader then has to do arithmetic on. Yesterday is a date rather than
"yesterday": the row is already marked overdue, and softening the day it was
due would work against that.

**`todayIso` reads the device's local date parts, never `toISOString`.** At
09:00 in Colombo it is still 03:30 UTC, and reading the UTC day would file every
morning's work as overdue until half past five — and the reverse after 18:30.

**The plot card became two stacked targets.** The body opens the plot, the strip
along the bottom opens its calendar and carries the next thing due. It had to
stop being one `<Link>`: an anchor inside an anchor is not markup a browser or a
screen reader can make sense of. The strip is there with nothing due as well,
because a card that sometimes has a way into the calendar is one the farmer has
to re-learn every time the season turns over.

**One request fills every card's next-due line.** `useNextTask` reads that
plot's own calendar when the farmer has opened it, and otherwise the cross-plot
`upcoming` list, which one request fills for the whole screen. The cost is that
the window is 14 days: a plot whose next job is a month out shows no line. A
calendar fetch per card would be a request per row, and "next: harvest, in 74
days" on every card is noise.

**The crop-stage bar is drawn from `CROP_GROWING_DAYS`, published in
`@agrisense/shared` this day.** The season lengths live in the agronomy file the
server reads and the client cannot; rather than a second hand-kept copy, the
server now refuses to boot if the two disagree. The day is spelled out beside
the bar — "Day 34 of 120" — because a bar on its own is a shape, and a farmer
deciding whether to order fertiliser wants the number.

**Template tasks are editable, and the sheet is seeded with the translation.**
A template task stores an i18n key; a farmer moving a date must not be shown
`calendar.task.paddy.sowing.title` in the field they are editing. Saving stores
the words they saw. The task stays `source: template` — the server owns that
field — so a regeneration will still replace it, which is the documented Day 11A
behaviour and remains the sharp edge of this design.

**The upcoming card is absent, not empty, when there is nothing due.** A farmer
with a clear week should get a shorter screen, and a card that is sometimes
empty in a fixed position teaches people to stop reading that position.

**Home and the plots list reach into the calendar feature's modules rather than
its barrel.** The barrel would pull the calendar screen and the task sheet —
react-hook-form with them — into the first chunk a farmer loads. The same reason
`HomePage` already deep-imported `plotStore`.

**A picker of two columns rather than three.** "பூச்சி கட்டுப்பாடு" does not fit
a 110px cell, and a picker that looks right in English and wrapped in the two
languages most of this audience reads is not a picker that was checked.

### A bug this work uncovered

**`plotSchema` and `calendarTaskSchema` rejected what the API actually sends.**
Both inherited `notes` (and `plantedAt`) from the _write_ shape, where they are
`optional()`. The API stores them as `null` — `PUT` replaces the whole record,
so an omitted field is written as null rather than left off. The results were
silent on the server and total on the client: one plot without notes made the
whole list fail to parse and `/plots` showed its error state, and a null
`plantedAt` went through `z.coerce.date()` as **1 January 1970**, which the new
crop-stage bar would have rendered as ready to harvest.

Fixed by saying `nullish()` on the read schemas, and each suite now parses real
API output through the schema the PWA's store uses. That assertion belongs on
the client; there is no runner there yet, so it lives where it can be made
today. This is exactly the class of defect the "not exercised in a browser" gap
has been hiding since Day 9.

### Known gaps and risks

- **Still not exercised in a real browser.** No driver in the repo, and these
  screens sit behind a session, a profile and a running API. The bug above was
  found by reading the schema against the service, not by opening the app —
  which is the argument for a client test runner rather than for more reading.
- **No client tests.** Adding a runner means adding a dependency, which needs a
  decision rather than a commit. The store's merge into two lists, `groupTasks`,
  `cropStage` and the date helpers are pure functions sitting there waiting for
  one.
- **Nothing checks that every template key has a translation.** Verified once,
  key by key, against the server's template file when these were written; an
  activity added to the agronomy file later will render its key on the row and
  no test will say so. The check belongs in the client runner that does not
  exist.
- **The Tamil and Sinhala strings are machine-written**, as on every day since
  Day 9 — and there are now 100 of them carrying agronomic instruction, which
  raises the stakes of a bad translation from awkward to wrong. The agronomy
  underneath them is still unreviewed.
- **The calendar is not offline-first.** Every action needs a connection; the
  Dexie outbox is Week 6, and a second cached copy here would only have to be
  reconciled with it later. Same position as `plotStore`.
- **A completed template task and its regenerated counterpart coexist.** Day
  11A's decision, visible now: correcting a planting day after ticking off the
  sowing leaves the old tick in "Done" and a fresh sowing task in the plan.
  Correct as a record, and it will read as a duplicate to somebody.
- **`npm run format:check` still flags files on line endings alone.** CRLF in
  the Windows working tree against Prettier's `endOfLine: "lf"`; the committed
  content is LF. A `.gitattributes` with `* text=auto eol=lf` would end it.

### Dependencies added

None.

## Day 17 — Grad-CAM (2026-09-25)

- GradCAM class on model.features[-1] (7x7), forward + gradient hooks.
  Reusable in the FastAPI service. Input requires_grad so gradients flow through frozen layers.
- Correct predictions: heatmaps sit on lesions (potato/tomato late blight,
  pepper bacterial spot, tomato early blight at the leaf edge). No background shortcut.
- Dangerous errors: 7 of 8 PlantVillage cases are potato_late_blight with a
  small lesion at the leaf edge; the heatmap focuses on healthy tissue in the center.
  The model misses early-stage disease. 3 potato leaves predicted as pepper_healthy
  (crop masking would fix these).
- Rice field photos: heatmaps spread over the whole field; tiny spots can't be localized.
- The Day 16 policy (healthy >= 0.90) would escalate 11 of the 12 dangerous errors shown.
- Week 5 ideas: photo guidance ("fill the screen with the damaged spot");
  show the heatmap only for disease results.
- Limitation: 7x7 heatmap = ~32x32 px per cell; shows area, not exact lesion outline.
