# Restaurant Tracker

Tracks photos of dishes a family has eaten, tied to the restaurant and location where they ate them, to eventually power an interactive map of pins.

## Language

**Entry**:
A single saved record: one photo of a dish, its title, the Place it was eaten at, and when it was captured. The atomic unit of tracking — there is no larger "visit" or "occasion" grouping multiple Entries together; a meal with three photographed dishes is three Entries that happen to share a Place.
_Avoid_: Visit, Pin, Post

**Title**:
The name of the dish shown in an Entry's photo (e.g. "Margherita Pizza"), entered as free text. Not a caption for the occasion, and not a rename of the Place.
_Avoid_: Caption, Name (ambiguous with Place name)

**Place**:
A restaurant or other food-and-drink establishment, sourced from Mapbox and deduped by Mapbox's place ID so multiple Entries at the same establishment share one Place record. Holds the establishment's name, address, and coordinates — the coordinates on a Place are what an Entry's map pin uses, not the photo's raw EXIF GPS. Always restricted to Mapbox's `food_and_drink` category, whether found via the nearby-suggestion list or manual location search.
_Avoid_: Restaurant, Business

**Captured at**:
The point in time an Entry's photo represents — read from the photo's EXIF metadata when present, falling back to the time the Entry was saved. Distinct from "created at," since photos are often uploaded well after the meal.
_Avoid_: Created at (only as a fallback, not the primary meaning)
