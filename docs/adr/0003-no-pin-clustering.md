# Pins are individual markers, not clustered

Each Place renders as its own `<Marker>` component, with no clustering and no special handling for restaurants that share near-identical coordinates (a food hall, say). This is an explicit bet on scale: a family accumulates restaurants slowly, and clustering is overhead at thirty pins even though it becomes necessary at a few hundred.

## Consequences

Reversing this is not a prop change. Clustering in `react-map-gl` means replacing JSX markers with a GeoJSON source and symbol layers, which takes the selected-pin styling and the tap-to-select wiring with it. Overlapping pins at low zoom are accepted in the meantime; the PlaceLog list in the panel is the reliable way to reach a place that is hard to hit on the map.
