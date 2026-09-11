-- Places are shared and deduped by Mapbox place id (see
-- docs/adr/0001-shared-deduped-place.md). Entries reference a Place rather
-- than storing their own snapshot of name/address/coordinates.
create table public.places (
  id uuid primary key default gen_random_uuid(),
  mapbox_id text not null unique,
  name text not null,
  address text not null,
  latitude double precision not null,
  longitude double precision not null
);

-- An Entry is one photo + one title (the dish name) + one Place + a
-- captured-at timestamp (see CONTEXT.md). No owner/person column yet -- no
-- auth exists.
create table public.entries (
  id uuid primary key default gen_random_uuid(),
  place_id uuid not null references public.places (id),
  title text not null,
  photo_path text not null,
  captured_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index entries_place_id_idx on public.entries (place_id);

-- RLS on with no policies: the browser-exposed anon key can neither read nor
-- write these tables. Every write goes through POST /api/entries, which uses
-- the service role key (RLS-exempt). Policies get added alongside auth.
alter table public.places enable row level security;
alter table public.entries enable row level security;

insert into storage.buckets (id, name, public)
values ('entry-photos', 'entry-photos', false);
