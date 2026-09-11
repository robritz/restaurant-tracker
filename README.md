# Restaurant Tracker

> ⚠️ **Proof of Concept.** 

As a family full of neurodivergent folks, we often struggle to keep track of where everyone likes to eat, and what they like to eat. Each of us has different sensory needs when it comes to food. It can often be a challenge to remember where we all like to eat together. The goal of this app is to make this process easy and fun by centering the UX around simply taking a photo and uploading it later.

This is V2 of my `food-sensitivity` app.

## Tech stack

- **Next.js 15** (App Router) + **React 18**
- **Material UI 6** with a dark theme
- **exifr** for client-side EXIF parsing
- **Mapbox Search Box API** for nearby-business lookup
- **Supabase** for data storage (Postgres + Storage for the dish photos)

## Getting started

### Prerequisites

- Node.js 18+
- A free [Mapbox access token](https://account.mapbox.com/access-tokens/)
- [Docker](https://docs.docker.com/get-docker/), to run Supabase locally

### Setup

```bash
# 1. Install dependencies
npm install

# 2. Configure your Mapbox token
cp .env.local.example .env.local
# then edit .env.local and set MAPBOX_TOKEN=...

# 3. Start local Supabase (Docker), then copy the printed URL/keys into
# .env.local
npm run supabase:start
npm run supabase:status

# 4. Run the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and select a photo that has location data.

> **Tip:** Photos taken on a phone with location services enabled are the best test cases. Images shared via most messaging apps or social platforms have their EXIF/GPS stripped.

## Environment variables

| Variable                        | Description                                                    |
| -------------------------------- | --------------------------------------------------------------- |
| `MAPBOX_TOKEN`                   | Mapbox access token, used **server-side** only.                 |
| `SUPABASE_URL`                   | Supabase project URL. **Server-side only.**                     |
| `SUPABASE_ANON_KEY`              | Supabase anon/publishable key (RLS-enforced). **Server-side only.** |
| `SUPABASE_SERVICE_ROLE_KEY`      | Bypasses RLS. **Server-side only** -- never exposed to the browser. |

`MAPBOX_TOKEN` is read only inside the `/api/places` route, so it is never exposed to the browser.

## Supabase

`supabase/` is a Supabase CLI project (`supabase init`'d at the repo root; see
`supabase/config.toml`). Schema lives in `supabase/migrations/*.sql` --
`places` and `entries` plus the `entry-photos` storage bucket.

- `src/lib/supabase/client.ts` -- `createSupabaseClient()` (RLS-enforced) and
  `createSupabaseServiceRoleClient()` (bypasses RLS; server-side only). Both
  tables have RLS on with no policies, so the anon client can't read or write
  them yet -- every write goes through `createSupabaseServiceRoleClient()`
  inside `POST /api/entries`. Policies get added alongside auth.
- `src/lib/supabase/env.ts` -- reads the env vars above.

```bash
npm run supabase:start   # starts local Supabase in Docker
npm run supabase:status  # reprint the local URL/keys
npm run supabase:stop
```

After adding a migration under `supabase/migrations/`:

```bash
npm run supabase:reset   # reapply all migrations against the local database
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
| `npm run supabase:reset`  | Reapply migrations to the local database |
| `npm run gen:types`       | Regenerate Supabase TypeScript types    |

## Project structure

```
src/
├── app/
│   ├── api/places/route.ts   # Server route: nearby (lat/lon) or text (q) place search
│   ├── api/entries/route.ts  # Server route: save an Entry (place upsert + photo + insert)
│   ├── layout.tsx            # Root layout, MUI theme provider
│   └── page.tsx              # Home: photo select -> pick a place -> title -> save
├── lib/
│   └── supabase/
│       ├── client.ts         # createSupabaseClient() / createSupabaseServiceRoleClient()
│       ├── database.types.ts # Generated by `npm run gen:types`
│       └── env.ts            # Reads Supabase env vars
└── theme.ts                  # MUI dark theme

supabase/
├── config.toml                # Supabase CLI project config
└── migrations/                # places + entries tables, entry-photos bucket
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
- No auth -- entries are not scoped to a person, and writes go through the service-role key.
- Route handlers are tested; the UI is not.
- Photos without EXIF GPS fall back to manual restaurant search.
- Not optimized or hardened for production use.
