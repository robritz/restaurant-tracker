# Places are shared and deduped, not per-Entry snapshots

Each Entry references a Place rather than storing its own copy of the restaurant's name, address, and coordinates. Places are deduped by Mapbox's place ID, so multiple Entries at the same restaurant — whether found via the nearby-suggestion list or manual location search — resolve to a single shared Place record.

This was chosen even though the app is starting very basic (v1 is just: photo → pick a place → title it → save) because the data is explicitly meant to power a future interactive map of pins, where one restaurant should read as one pin regardless of how many dishes were photographed there. Storing a denormalized snapshot per Entry instead would be simpler now, but recovering shared identity later would require a backfill migration to match denormalized rows back into canonical places — a real cost avoided by deduping from the start.

## Amendment: Places stay unowned once Entries are owned

Ownership (ADR-0004) applies to Entries, not to Places. A Place remains shared reference data describing a real establishment, so two Households that eat at the same restaurant resolve to the same `places` row and see only their own Entries there. Any authenticated caller may read and insert a Place; nobody may update or delete one, so one Household cannot rename a restaurant out from under another.

The price is that the *existence* of a Place is globally visible — "someone, sometime, ate here" is shared knowledge. That is Mapbox metadata with no names attached, and it is the cost of keeping dedup working across Households.

The leak boundary this creates lives in one query. `/api/place-logs` uses `entries!inner` so a Place with no Entries never reaches the map; once Entries are owned, that join must filter Entries by Household **before** deciding which Places exist, or a shared Place would betray that another Household has eaten there.
