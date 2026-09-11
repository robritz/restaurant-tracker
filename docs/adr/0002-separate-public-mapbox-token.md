# A second, public Mapbox token for the browser

`MAPBOX_TOKEN` is deliberately server-side only — `/api/places` proxies place search so the token never reaches the browser. Mapbox GL JS runs in the browser and cannot work that way, so the map introduces a second token, `NEXT_PUBLIC_MAPBOX_PUBLIC_TOKEN`, scoped to `styles:read`/`fonts:read` and URL-restricted at Mapbox. The two tokens are not interchangeable: the secret one keeps its search scopes and stays off the client.

## Consequences

The public token's safety lives in the Mapbox dashboard, not in this repo — if its URL restrictions are wrong or missing, nothing here will say so. A token that is valid locally but not restricted to the production domain fails at runtime as a blank grey map, which is why the map surfaces both a missing-token error in development and a tile-load error at runtime rather than failing silently.

Minting short-lived tokens from a server route was considered and rejected as disproportionate at this size.
