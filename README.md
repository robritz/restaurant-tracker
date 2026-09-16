# Restaurant Tracker

> ⚠️ **Proof of Concept.** 

As a family full of neurodivergent folks, we often struggle to keep track of where everyone likes to eat, and what they like to eat. Each of us has different sensory needs when it comes to food. It can often be a challenge to remember where we all like to eat together. The goal of this app is to make this process easy and fun by centering the UX around simply taking a photo and uploading it later.

This is V2 of my `food-sensitivity` app.

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

That login belongs to a **Household**, which is the family rather than a person (see [`CONTEXT.md`](CONTEXT.md) and [ADR 0004](docs/adr/0004-household-owns-entries.md)). A second phone joining the same map later is a membership row, not a shared password. Entries are not yet scoped to a Household — that lands next.

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

- `src/lib/supabase/client.ts` -- `createSupabaseClient()` (anonymous,
  RLS-enforced) and `createSupabaseServiceRoleClient()` (bypasses RLS;
  server-side only). `places` and `entries` have RLS on with no policies, so
  every write still goes through the service-role client inside
  `POST /api/entries`. Their policies arrive when Entries gain an owner.
- `src/lib/supabase/server.ts` -- `createSupabaseServerClient()`, the
  RLS-enforced client that runs as the signed-in caller, reading the session
  from cookies.
- `src/lib/supabase/middleware.ts` -- reads and refreshes the session for the
  middleware. The only place a token refresh happens.
- `src/lib/supabase/cookies.ts` -- marks session cookies `HttpOnly`.
- `src/lib/supabase/env.ts` -- reads the env vars above.

`households` and `household_members` *do* have policies: each is readable
only by its own members.

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

## Scripts

| Command                  | Description                            |
| ------------------------- | --------------------------------------- |
| `npm run dev`             | Start the development server            |
| `npm run build`           | Production build                        |
| `npm run start`           | Serve the production build              |
| `npm run lint`            | Run ESLint                              |
| `npm test`                | Run the test suite                      |
| `npm run supabase:start`  | Start local Supabase (Docker)           |
| `npm run supabase:stop`   | Stop local Supabase                     |
| `npm run supabase:status` | Print local Supabase URL/keys           |
| `npm run supabase:reset`  | Reapply migrations locally, then re-seed |
| `npm run seed`            | Create the Household and its login      |
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
│   ├── layout.tsx                     # Root layout: document shell and MUI theme only
│   ├── login/page.tsx                 # The sign-in screen (outside the app's chrome)
│   └── (app)/                         # Everything behind the login
│       ├── layout.tsx                 # Tab bar + the persistent map
│       ├── map/page.tsx               # Map tab route (the map itself lives in the layout)
│       └── page.tsx                   # Add: photo select -> pick a place -> title -> save
├── middleware.ts                      # The gate: redirect vs 401, and session refresh
├── components/
│   ├── AppTabs.tsx                    # Add / Map tabs, and sign out
│   ├── LoginForm.tsx                  # Email + password, posted to /api/auth/login
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
│   │   └── redirect.ts                # Where to land after signing in, minus open redirects
│   ├── map/
│   │   ├── geolocation.ts             # What a failed locate-me says, and for how long
│   │   ├── pins.ts                    # Camera framing and pin stacking
│   │   └── selection.ts               # The selected Place's URL, and push vs replace
│   ├── photos.ts                      # Thumbnail generation
│   └── supabase/
│       ├── client.ts                  # createSupabaseClient() / createSupabaseServiceRoleClient()
│       ├── server.ts                  # The signed-in caller's RLS-enforced client
│       ├── middleware.ts              # Session read + refresh for the middleware
│       ├── cookies.ts                 # HttpOnly session cookies
│       ├── database.types.ts          # Generated by `npm run gen:types`
│       └── env.ts                     # Reads Supabase env vars
└── theme.ts                           # MUI dark theme

scripts/
└── seed-household.mjs         # Creates the one Household and its login

supabase/
├── config.toml                # Supabase CLI project config
└── migrations/                # places, entries, households, household_members
```

## Testing

`vitest` runs against files under `src/`, no browser/jsdom environment.
Route Handlers are tested by importing the route module directly,
constructing a `Request`, and asserting on the returned `Response` --
mocking the outbound Mapbox `fetch` or the Supabase client as needed. See
`src/app/api/places/route.test.ts` for the pattern.

```bash
npm test
```

## Known limitations (it's a POC)

- Only surfaces `food_and_drink` businesses within a fixed ~60m radius.
- One Household, seeded by hand -- no self-signup, and no way to invite a second login into the same Household yet.
- Entries are not yet scoped to a Household; table writes still go through the service-role key.
- Route handlers are tested; the UI is not.
- Photos without EXIF GPS fall back to manual restaurant search.
- Not optimized or hardened for production use.
