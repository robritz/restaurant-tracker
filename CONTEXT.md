# Restaurant Tracker

Tracks photos of dishes a family has eaten, tied to the restaurant and location where they ate them, to eventually power an interactive map of pins.

## Language

**Household**:
The family whose Entries these are — the owner of everything tracked here, and the thing you log in as. A Household is not a person: one Household covers everyone who eats together, however many of them there are, and they share a single map. There is currently no concept of an individual person inside a Household, so no Entry records *which* family member ate the dish.
_Avoid_: Account (blurs the credential with the owner), User (implies one person)

**Entry**:
A single saved record: one photo of a dish, its title, the Place it was eaten at, and when it was captured. The atomic unit of tracking — there is no larger "visit" or "occasion" grouping multiple Entries together; a meal with three photographed dishes is three Entries that happen to share a Place. An Entry is never a pin of its own — pins belong to Places. Every Entry belongs to exactly one Household, and is visible only to it.
_Avoid_: Visit, Post

**Title**:
The name of the dish shown in an Entry's photo (e.g. "Margherita Pizza"), entered as free text. Not a caption for the occasion, and not a rename of the Place.
_Avoid_: Caption, Name (ambiguous with Place name)

**Place**:
A restaurant or other food-and-drink establishment, sourced from Mapbox and deduped by Mapbox's place ID so multiple Entries at the same establishment share one Place record. Holds the establishment's name, address, and coordinates — the coordinates on a Place are what an Entry's map pin uses, not the photo's raw EXIF GPS. Always restricted to Mapbox's `food_and_drink` category, whether found via the nearby-suggestion list or manual location search. One Place reads as exactly one pin on the map, however many dishes were photographed there. Unlike an Entry, a Place is not owned by anyone: it is reference data describing a real establishment, so two Households that eat at the same restaurant refer to the same Place while seeing only their own Entries there.
_Avoid_: Restaurant, Business

**Pin**:
The marker drawn on the map for a single Place. Purely the name of a UI element — a pin carries no information a Place doesn't already have, and there is no such thing as a pin for an Entry.

**PlaceLog**:
A Place together with every Entry your Household recorded at it — the answer to "what have *we* eaten here?" Always relative to one Household: the same Place read by two Households is two different PlaceLogs, and a Place with no Entries of your own is not a PlaceLog at all and never reaches your map. Distinct from a Place, which knows nothing about photos, and from an Entry, which knows only its own dish. What the map shows when a pin is tapped: the Place's name and address, and the dishes photographed there.
_Avoid_: Visit, History, Feed

**Captured at**:
The point in time an Entry's photo represents — read from the photo's EXIF metadata when present, falling back to the time the Entry was saved. Distinct from "created at," since photos are often uploaded well after the meal.
_Avoid_: Created at (only as a fallback, not the primary meaning)
