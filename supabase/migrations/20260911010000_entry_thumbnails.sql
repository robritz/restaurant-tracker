-- Entries carry a thumbnail generated at upload time, plus its upright
-- dimensions. The dimensions are what let the map's masonry gallery reserve
-- each tile's height before the image arrives, so the grid doesn't reflow as
-- photos load.
--
-- NOT NULL with no backfill: there is no data worth preserving, so the
-- database is emptied and re-migrated rather than backfilled. That keeps the
-- read path free of a "what if this is missing" branch.
alter table public.entries
  add column thumbnail_path text not null,
  add column width integer not null,
  add column height integer not null;
