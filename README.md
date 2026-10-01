# Restaurant Tracker

[![CI](https://github.com/robritz/restaurant-tracker/actions/workflows/ci.yml/badge.svg)](https://github.com/robritz/restaurant-tracker/actions/workflows/ci.yml)

As a family full of neurodivergent folks, we often struggle to keep track of where everyone likes to eat, and what they like to eat. Each of us has different sensory needs when it comes to food. It can often be a challenge to remember where we all like to eat together. 

The goal of this app is to make this process easy and fun by centering the UX around simply taking a photo and uploading it later. We can focus on snapping a quick photo of our food (like OG Instagram days). A day, week, month, or year later we can select the image to remember where we ate and save its location. 

This is V2 of my `food-sensitivity` app. It is in active development.

<img width="411" height="885" alt="Screenshot 2026-09-30 at 21 15 21" src="https://github.com/user-attachments/assets/b4a76fb9-d7d3-4cfb-9e3c-d8a47d7b6adb" />
<img width="412" height="883" alt="Screenshot 2026-09-30 at 21 15 48" src="https://github.com/user-attachments/assets/83350ed1-372f-4d2d-b7b7-8313923f8de6" />
<img width="411" height="881" alt="Screenshot 2026-09-30 at 21 16 08" src="https://github.com/user-attachments/assets/c1adf58d-8935-4ced-8fe8-02c78789a172" />
<img width="410" height="884" alt="Screenshot 2026-09-30 at 21 16 22" src="https://github.com/user-attachments/assets/ed9e9196-9f0b-437c-b2ec-9c2a6f74a852" />
<img width="411" height="883" alt="Screenshot 2026-09-30 at 21 16 41" src="https://github.com/user-attachments/assets/7fc2ad58-06aa-4752-aacf-52c6343730ab" />


## Tech stack

- **Next.js 15** (App Router) + **React 18**
- **Material UI 6** with a dark theme
- **exifr** for client-side EXIF parsing
- **Mapbox Search Box API** for nearby-business lookup
- **Supabase** for data storage (Postgres + Storage for the dish photos) and for the login

## Getting started

### Prerequisites

- Node.js 20.9+ (the seed script uses `node --env-file`)
- A free [Mapbox access token](https://account.mapbox.com/access-tokens/)
- [Docker](https://docs.docker.com/get-docker/), to run Supabase locally

### Setup

```bash
# 1. Install dependencies
npm install

# 2. Configure your Mapbox tokens
cp .env.local.example .env.local
# then edit .env.local and set MAPBOX_TOKEN=... (server-side place search)
# and NEXT_PUBLIC_MAPBOX_PUBLIC_TOKEN=... (the browser map)

# 3. Start local Supabase (Docker), then copy the printed URL/keys into
# .env.local
npm run supabase:start
npm run supabase:status

# 4. Pick a HOUSEHOLD_EMAIL and HOUSEHOLD_PASSWORD in .env.local, then create
# the Household and its login. `npm run supabase:reset` also runs this, so a
# reset database always leaves a working login.
npm run seed

# 5. Run the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), sign in with the credential you seeded, and select a photo that has location data.

## Accounts

The app is closed: every page and every API route requires a session. There is **no self-signup** — `enable_signup` is off in `supabase/config.toml`, and the one login is created by `npm run seed` from the values in `.env.local`.

That login belongs to a **Household**, which is the family rather than a person (see [`CONTEXT.md`](CONTEXT.md) and [ADR 0004](docs/adr/0004-household-owns-entries.md)). Every Entry belongs to a Household, and the database enforces it: one Household's dishes are not merely filtered out of another's responses, they are not readable at all.

### A second phone

A second person joins by **invitation from the Household's admin**, not by registering ([ADR 0006](docs/adr/0006-invites-create-credentials.md)). On the Household screen the admin creates an invite link and sends it however they like; whoever opens it chooses their own email and password, and lands on the same map. No password is ever shared.

An invite works **once** and **expires after seven days**, and only its SHA-256 hash is stored — the token lives in the link and nowhere else, so it is shown exactly once and a lost link means issuing another. A token can only ever join the Household that issued it, and always joins as a plain member.

#### Who may do what

The account `npm run seed` creates is the Household's **admin**. Everyone who joins afterwards is a plain member.

| | Admin | Member |
| --- | --- | --- |
| See the map, log a dish | yes | yes |
| Issue and revoke invites | yes | no |
| Remove another phone | yes | no |
| Remove themselves | **no** | yes |

The admin cannot remove themselves, so a Household always keeps the account that runs it and can never be stranded with Entries nobody can reach; signing out is how that phone steps away. A plain member can leave whenever they like, and cannot remove the account that invited them.

Removing a phone is deleting its membership, and takes effect on its next query: every policy reads membership live, so there is no cached grant to wait out.

Self-signup stays off throughout. `/join/<token>` and the route behind it are the only things reachable without a session, because a joiner by definition has none; issuing and revoking stay behind the login.

> **Tip:** Photos taken on a phone with location services enabled are the best test cases. Images shared via most messaging apps or social platforms have their EXIF/GPS stripped.

## Environment variables

| Variable                        | Description                                                    |
| -------------------------------- | --------------------------------------------------------------- |
| `MAPBOX_TOKEN`                   | Mapbox access token, used **server-side** only.                 |
| `NEXT_PUBLIC_MAPBOX_PUBLIC_TOKEN` | Mapbox token for the browser map. **Shipped to the client** -- scope it to `styles:read`/`fonts:read` and URL-restrict it at Mapbox. |
| `SUPABASE_URL`                   | Supabase project URL. **Server-side only.**                     |
| `SUPABASE_ANON_KEY`              | Supabase anon/publishable key (RLS-enforced). **Server-side only.** |
| `SUPABASE_SERVICE_ROLE_KEY`      | Bypasses RLS. **Server-side only** -- never exposed to the browser. |
| `HOUSEHOLD_EMAIL`                | Email for the seeded login. Read by `npm run seed` only.        |
| `HOUSEHOLD_PASSWORD`             | Password for the seeded login. Read by `npm run seed` only.     |
| `HOUSEHOLD_NAME`                 | Optional display name for the Household. Defaults to "Our Household". |

`MAPBOX_TOKEN` is read only inside the `/api/places` route, so it is never exposed to the browser. The map needs a token in the browser and cannot use that one, which is why there are two -- see [ADR 0002](docs/adr/0002-separate-public-mapbox-token.md). Without `NEXT_PUBLIC_MAPBOX_PUBLIC_TOKEN` the map tab explains that the map is unconfigured and logs an error in development; the list of places keeps working.

## Supabase

`supabase/` is a Supabase CLI project (`supabase init`'d at the repo root; see
`supabase/config.toml`). Schema lives in `supabase/migrations/*.sql` --
`places`, `entries`, `households` and `household_members`, plus the
`entry-photos` storage bucket.

Photos in that bucket are keyed `<household>/<place>/<uuid>`, so everything
one family uploaded sits under a single prefix and removing their data later
is a prefix delete rather than a migration that joins through `entries`. The
bucket is private and the paths are never guessed at -- a short-lived signed
URL is the only way in, and `/api/entries/[id]/photo` reads the Entry under
RLS before it signs anything -- so the prefix is for operators, not access
control.

- `src/lib/supabase/client.ts` -- `createSupabaseClient()` (anonymous,
  RLS-enforced) and `createSupabaseServiceRoleClient()` (bypasses RLS;
  server-side only). The service-role client is now
  reached for **only to sign and upload photos**, never to read or write a
  table
  (`docs/adr/0005-service-role-for-storage-only.md`). A route that uses it
  for a table read has silently opted out of every policy below.
- `src/lib/supabase/server.ts` -- `createSupabaseServerClient()`, the
  RLS-enforced client that runs as the signed-in caller, reading the session
  from cookies.
- `src/lib/auth/household.ts` -- `requireHousehold()`, the one seam every
  route that touches a table goes through. Returns the caller's Household
  *and* that client together, since a client without the Household cannot
  record an Entry and the id without the client invites filtering by hand.
  It is also what the route tests mock.
- `src/lib/supabase/middleware.ts` -- reads and refreshes the session for the
  middleware. The only place a token refresh happens.
- `src/lib/supabase/cookies.ts` -- marks session cookies `HttpOnly`.
- `src/lib/supabase/env.ts` -- reads the env vars above.

Four `SECURITY DEFINER` functions sit alongside the policies, each scoped so
it can only ever answer about the caller:

- `household_ids_for_current_user()` -- which Households the caller is in.
  Most policies above are written against it.
- `admin_household_ids_for_current_user()` -- which the caller *runs*. The
  invite policies and half of the membership-delete rule use this instead.
- `current_household_membership()` -- the caller's own membership row, which
  `requireHousehold()` reads. Needed because the select policy on
  `household_members` is household-wide: a caller sees every member, so
  reading a role off that table without filtering would hand back an
  arbitrary member's.
- `household_for_invite(token_hash)` -- the Household a live invite belongs
  to, or null. The one function granted to `anon`, because whoever is
  redeeming an invite has no session yet; it returns an opaque id and nothing
  else, so a bad token learns only that it is bad.
- `accept_household_invite(token_hash)` -- claims an invite and joins
  `auth.uid()` to its Household as a plain member, atomically.
  `authenticated` only: there is no anonymous path into a Household, and a
  credential already in one is refused, since the app assumes one Household
  per credential.
- `household_members_for_current_user()` -- the caller's fellow members, with
  their emails and roles. Emails live in `auth.users`, which no policy here
  can reach.

Every table has policies, and they -- not the routes -- are what keep one
Household's dishes away from another's:

- `households` and `household_members` are readable only by their own members.
  Deleting a membership -- which is how access is revoked -- is governed by
  two policies, OR'd: the admin may delete any member but themselves, and
  anyone else may delete only themselves. Between them an admin cannot leave
  and a member cannot be removed by a peer.
- `household_invites` are readable, issuable and revocable only by the **admin**
  of the Household they belong to, so an invite cannot be aimed at anyone
  else's map. There is no update policy: `accepted_at` is set only by
  `accept_household_invite()`, which is what makes "single use" something
  that cannot be undone by rewriting the row.
- `entries` are readable and insertable only by the Household that owns them.
  A route that forgets to filter cannot leak another Household's dishes,
  because the rows are not there to return. There is deliberately no update
  or delete policy; those arrive with the features that need them.
- `places` are readable and insertable by any signed-in caller -- they are
  shared reference data carrying no dish and no owner, which is what lets a
  search find a restaurant another family recorded first. There is **no
  update or delete policy for anyone**: a Place is shared, so an edit by one
  Household would rewrite the name and address under every other Household's
  pins. This is why `POST /api/entries` resolves a Place with
  `ON CONFLICT DO NOTHING` rather than an upsert, which would need `update`
  and is refused outright.

### Self-signup, and a trap in `[auth.email]`

Self-signup is off, which is what stops a deployed URL from being an open
door. It is turned off by the **global** `[auth] enable_signup = false` in
`supabase/config.toml`.

Not by `[auth.email] enable_signup`, which reads as though it means the same
thing and does not: the Supabase CLI maps it to
`GOTRUE_EXTERNAL_EMAIL_ENABLED`, so setting it to `false` disables email as a
way of *signing in* at all. Main carried that for a fortnight -- a fresh
checkout could seed a Household and then not log into it -- and nobody
noticed, because a config change only takes effect on
`supabase stop && supabase start`, and a long-running local stack keeps
serving the settings it booted with.

`src/test/auth-config.integration.test.ts` now asserts both halves against a
running stack: a seeded member can sign in, and a stranger cannot sign up.

```bash
npm run supabase:start   # starts local Supabase in Docker
npm run supabase:status  # reprint the local URL/keys
npm run supabase:stop
```

After adding a migration under `supabase/migrations/`:

```bash
npm run supabase:reset   # reapply all migrations locally, then re-seed the Household
npm run gen:types        # regenerate src/lib/supabase/database.types.ts
```

The repo is linked to a hosted Supabase project, and the schema above has
been pushed to it:

```bash
supabase db push --dry-run   # preview what would be applied remotely
supabase db push             # apply pending migrations to the hosted project
supabase migration list      # compare local and remote migration state
```

Deploying the app needs `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and
`SUPABASE_SERVICE_ROLE_KEY` set to the hosted project's values -- the
`.env.local` written during setup points at local Supabase.

### Deployment

Production is deployed by the CI workflow, not by Vercel's Git integration,
so that nothing reaches the live site until the suites have passed. Before
this, Vercel built on push and knew nothing about a workflow run -- a commit
whose CI failed had already been deployed.

`vercel.json` sets `git.deploymentEnabled.main` to `false`, which stops Vercel
auto-deploying *that branch only*. Every other branch still gets a preview on
push, so a pull request has a URL to click before the suites finish; only
production waits.

The deploy job needs three repository secrets, under
**Settings -> Secrets and variables -> Actions**:

| Secret | Where it comes from |
| ------------------- | ----------------------------------------------------- |
| `VERCEL_TOKEN`      | <https://vercel.com/account/tokens> |
| `VERCEL_ORG_ID`     | `.vercel/project.json` after `npx vercel link`, or project settings |
| `VERCEL_PROJECT_ID` | the same place |

Nothing else moves into GitHub. The job runs `vercel pull`, so `SUPABASE_URL`,
the keys and the Mapbox tokens stay in Vercel's own environment settings
rather than being duplicated as secrets in two places.

**Add those secrets before merging a change to this workflow.** They are inert
until something reads them, and without them the deploy job fails while
`vercel.json` has already stopped Vercel from covering for it -- production
would keep serving its last deployment and quietly stop receiving new ones.

## Scripts

| Command                  | Description                            |
| ------------------------- | --------------------------------------- |
| `npm run dev`             | Start the development server            |
| `npm run build`           | Production build                        |
| `npm run start`           | Serve the production build              |
| `npm run lint`            | Run ESLint                              |
| `npm run typecheck`       | Type-check without emitting             |
| `npm test`                | Run the unit test suite (no Docker needed) |
| `npm run test:integration` | Run the integration suite (needs local Supabase) |
| `npm run supabase:start`  | Start local Supabase (Docker)           |
| `npm run supabase:stop`   | Stop local Supabase                     |
| `npm run supabase:status` | Print local Supabase URL/keys           |
| `npm run supabase:reset`  | Reapply migrations locally, then re-seed |
| `npm run seed`            | Create the Household and its admin login |
| `npm run gen:types`       | Regenerate Supabase TypeScript types    |

## Project structure

```
src/
├── app/
│   ├── api/places/route.ts            # Server route: nearby (lat/lon) or text (q) place search
│   ├── api/entries/route.ts           # Server route: save an Entry (place upsert + photo + insert)
│   ├── api/entries/[id]/photo/route.ts # Server route: signed URL for an Entry's full photo
│   ├── api/place-logs/route.ts        # Server route: one summary per Place, for the map's pins
│   ├── api/place-logs/[id]/route.ts   # Server route: one Place with the dishes eaten there
│   ├── api/auth/login/route.ts        # Server route: exchange email + password for a session
│   ├── api/auth/logout/route.ts       # Server route: end the session
│   ├── api/invites/route.ts           # Server route: issue an invite into your Household
│   ├── api/invites/[id]/route.ts      # Server route: revoke an invite
│   ├── api/invites/accept/route.ts    # Server route: redeem one (public -- a joiner has no session)
│   ├── api/members/[memberId]/route.ts # Server route: remove a phone's access
│   ├── layout.tsx                     # Root layout: document shell and MUI theme only
│   ├── login/page.tsx                 # The sign-in screen (outside the app's chrome)
│   ├── join/[token]/page.tsx          # Redeem an invite (also outside the chrome)
│   └── (app)/                         # Everything behind the login
│       ├── layout.tsx                 # Tab bar + the persistent map
│       ├── map/page.tsx               # Map tab route (the map itself lives in the layout)
│       ├── household/page.tsx         # Who is in the Household; invite, remove, leave
│       └── page.tsx                   # Add: photo select -> pick a place -> title -> save
├── middleware.ts                      # The gate: redirect vs 401, and session refresh
├── components/
│   ├── AppTabs.tsx                    # Add / Map tabs, household, and sign out
│   ├── LoginForm.tsx                  # Email + password, posted to /api/auth/login
│   ├── JoinForm.tsx                   # Choose a sign-in against an invite
│   ├── HouseholdMembers.tsx           # Members and roles, invite links, revocation
│   ├── SignOutButton.tsx              # Ends the session with a hard navigation
│   ├── CaptureForm.tsx                # The Add tab's flow
│   ├── PersistentMap.tsx              # Keeps the map alive across tab navigation
│   ├── MapView.tsx                    # Map + panel, and the selected Place in the URL
│   ├── PlaceMap.tsx                   # One pin per Place, framing and selection
│   ├── PlaceLogList.tsx               # Every Place you've eaten at
│   ├── PlaceLogPanel.tsx              # The selected Place and its dishes
│   └── DishGallery.tsx                # The dishes photographed at one Place
├── lib/
│   ├── auth/
│   │   ├── household.ts               # requireHousehold(): the caller's Household, role + an RLS client
│   │   ├── admin.ts                   # The one "that's the admin's" message
│   │   └── redirect.ts                # Where to land after signing in, minus open redirects
│   ├── invites/
│   │   ├── token.ts                   # Minting, hashing and expiring an invite token
│   │   └── state.ts                   # Whether an invite row reads as live, used or expired
│   ├── map/
│   │   ├── geolocation.ts             # What a failed locate-me says, and for how long
│   │   ├── pins.ts                    # Camera framing and pin stacking
│   │   └── selection.ts               # The selected Place's URL, and push vs replace
│   ├── navigation.ts                  # hardNavigate(): the session-boundary document load
│   ├── photos.ts                      # Thumbnail generation
│   └── supabase/
│       ├── client.ts                  # createSupabaseClient() / createSupabaseServiceRoleClient()
│       ├── server.ts                  # The signed-in caller's RLS-enforced client
│       ├── middleware.ts              # Session read + refresh for the middleware
│       ├── cookies.ts                 # HttpOnly session cookies
│       ├── database.types.ts          # Generated by `npm run gen:types`
│       └── env.ts                     # Reads Supabase env vars
└── theme.ts                           # MUI dark theme

test/
├── households.ts              # Two-Household fixture for the integration suite
├── policies.integration.test.ts  # What a signed-in member can and cannot do
├── invites.integration.test.ts   # Invites, joining, roles and revocation against real policies
├── two-members.integration.test.ts # Both phones through the real routes
└── setup-env.ts               # Loads .env.local for the integration suite

scripts/
└── seed-household.mjs         # Creates the one Household and its login

supabase/
├── config.toml                # Supabase CLI project config
└── migrations/                # places, entries, households, household_members, household_invites, roles
```

## Testing

`vitest` runs against files under `src/`, no browser/jsdom environment.
Route Handlers are tested by importing the route module directly,
constructing a `Request`, and asserting on the returned `Response`.

There are two suites, deliberately separate.

**Unit** (`npm test`) mocks the outbound Mapbox `fetch` or the Supabase
client, so it is hermetic and needs no Docker. It pins how each route is
*wired*: that reads go through the RLS-enforced client, that the Household is
stamped on a write, that a missing Entry is a 404 rather than a 403. See
`src/app/api/places/route.test.ts` for the pattern.

**Integration** (`npm run test:integration`) needs the local Supabase stack
running (`npm run supabase:start`). It seeds **two Households** that share a
restaurant, then runs the real route handlers against the real database,
stubbing only `requireHousehold()` -- the seam the routes already use -- to
hand back a genuinely signed-in client. Everything past that seam, every
policy included, is real. Fixtures live in `src/test/households.ts` and clean
up after themselves.

The split exists because the two catch different failures. Mocking the client
is what makes the unit suite fast, and also what makes it blind: drop the
policy on `entries` and every unit test still passes, because the mock returns
whatever rows it was told to. The integration suite is the one that fails.
That boundary is invisible while only one Household exists, which is exactly
why it is tested with two.

```bash
npm test                  # unit
npm run test:integration  # boundary, needs local Supabase
```

Both suites run in CI on every pull request and on pushes to `main`
(`.github/workflows/ci.yml`), which starts its own Supabase in the runner.
That workflow is what actually enforces the boundary: before it existed, the
integration suite ran only when someone remembered to type the command, which
meant the guarantee the suite exists to protect rested on habit.

The workflow deliberately fails rather than passing on an empty run --
`passWithNoTests` is off in both configs -- so a glob that stops matching the
integration tests is a red build, not a green one with nothing behind it.

It runs the same npm scripts a developer would, so there is one definition of
how this project is linted, typechecked, started and tested. Lint is in CI
alongside typecheck, and was wired in only once it ran clean -- a step that is
red from its first run is a step everyone learns to ignore.

## Known limitations (it's a POC)

- Only surfaces `food_and_drink` businesses within a fixed ~60m radius.
- One Household, seeded by hand. A second phone joins by invite from a member; there is still no self-signup, and no way to create a *second* Household from inside the app.
- Photo objects predating Household-keyed paths keep their old `<place>/<uuid>` layout, so "remove a Household by prefix" does not yet cover them.
- Route handlers are tested; the UI is not.
- Photos without EXIF GPS fall back to manual restaurant search.
- Not optimized or hardened for production use.
