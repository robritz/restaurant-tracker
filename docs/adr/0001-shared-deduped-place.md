# Places are shared and deduped, not per-Entry snapshots

Each Entry references a Place rather than storing its own copy of the restaurant's name, address, and coordinates. Places are deduped by Mapbox's place ID, so multiple Entries at the same restaurant — whether found via the nearby-suggestion list or manual location search — resolve to a single shared Place record.

This was chosen even though the app is starting very basic (v1 is just: photo → pick a place → title it → save) because the data is explicitly meant to power a future interactive map of pins, where one restaurant should read as one pin regardless of how many dishes were photographed there. Storing a denormalized snapshot per Entry instead would be simpler now, but recovering shared identity later would require a backfill migration to match denormalized rows back into canonical places — a real cost avoided by deduping from the start.
