"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Map, {
  GeolocateControl,
  Marker,
  NavigationControl,
  type MapRef,
  type ViewState,
} from "react-map-gl/mapbox";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Snackbar from "@mui/material/Snackbar";
import PlaceIcon from "@mui/icons-material/Place";
import "mapbox-gl/dist/mapbox-gl.css";
import type { PlaceLogSummary } from "@/app/api/place-logs/route";

// Scoped to styles and fonts and URL-restricted at Mapbox -- the secret
// MAPBOX_TOKEN keeps its search scopes and never reaches the browser. See
// docs/adr/0002-separate-public-mapbox-token.md.
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_PUBLIC_TOKEN;

const MAP_STYLE = "mapbox://styles/mapbox/streets-v12";

// A single pin has no footprint to frame, so it gets a neighbourhood zoom
// rather than the meaningless one that fitting a zero-sized box produces.
const SINGLE_PLACE_ZOOM = 14;

const FIT_PADDING = 56;

// Where the map was left, so switching to the capture tab and back doesn't
// cost the user their position. Session-scoped: a new session should open
// framed to the whole footprint again.
const VIEW_STATE_KEY = "map-view-state";

type StoredView = Pick<ViewState, "longitude" | "latitude" | "zoom">;

function readStoredView(): StoredView | null {
  try {
    const raw = sessionStorage.getItem(VIEW_STATE_KEY);
    return raw ? (JSON.parse(raw) as StoredView) : null;
  } catch {
    return null;
  }
}

function storeView(view: StoredView) {
  try {
    sessionStorage.setItem(VIEW_STATE_KEY, JSON.stringify(view));
  } catch {
    // A browser refusing session storage costs the user their position on a
    // tab switch and nothing else.
  }
}

function bounds(placeLogs: PlaceLogSummary[]): [number, number, number, number] {
  const longitudes = placeLogs.map((placeLog) => placeLog.longitude);
  const latitudes = placeLogs.map((placeLog) => placeLog.latitude);
  return [
    Math.min(...longitudes),
    Math.min(...latitudes),
    Math.max(...longitudes),
    Math.max(...latitudes),
  ];
}

function initialViewState(placeLogs: PlaceLogSummary[]) {
  const stored = readStoredView();
  if (stored) return stored;

  if (placeLogs.length === 1) {
    return {
      longitude: placeLogs[0].longitude,
      latitude: placeLogs[0].latitude,
      zoom: SINGLE_PLACE_ZOOM,
    };
  }

  return {
    bounds: bounds(placeLogs),
    fitBoundsOptions: { padding: FIT_PADDING, maxZoom: SINGLE_PLACE_ZOOM },
  };
}

function MapUnavailable({ message }: { message: string }) {
  return (
    <Box
      sx={{
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        p: 2,
        bgcolor: "action.hover",
      }}
    >
      <Alert severity="warning">{message}</Alert>
    </Box>
  );
}

/**
 * One pin per Place, framed on open to everywhere the family has eaten.
 * Selection lives above this component (in the URL), so the map is told
 * which pin is selected rather than remembering it.
 */
export default function PlaceMap({
  placeLogs,
  selectedId,
  onSelect,
}: {
  placeLogs: PlaceLogSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const mapRef = useRef<MapRef>(null);
  const [tilesFailed, setTilesFailed] = useState(false);
  const [locateFailed, setLocateFailed] = useState(false);
  const [initialView] = useState(() => initialViewState(placeLogs));

  // The place being read about is the place being looked at -- true whether
  // the pin was tapped on the map or the Place was picked from the list.
  useEffect(() => {
    const selected = placeLogs.find((placeLog) => placeLog.id === selectedId);
    if (!selected) return;
    mapRef.current?.flyTo({
      center: [selected.longitude, selected.latitude],
      zoom: Math.max(mapRef.current.getZoom(), SINGLE_PLACE_ZOOM),
      duration: 800,
    });
  }, [placeLogs, selectedId]);

  const rememberView = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const center = map.getCenter();
    storeView({
      longitude: center.lng,
      latitude: center.lat,
      zoom: map.getZoom(),
    });
  }, []);

  if (!MAPBOX_TOKEN) {
    // Loud in development, because a missing token is indistinguishable
    // from a broken map by eye.
    if (process.env.NODE_ENV === "development") {
      console.error(
        "NEXT_PUBLIC_MAPBOX_PUBLIC_TOKEN is not set. The map cannot render without it -- see .env.local.example.",
      );
    }
    return (
      <MapUnavailable message="The map isn’t configured. Your places are still listed below." />
    );
  }

  if (tilesFailed) {
    return (
      <MapUnavailable message="The map couldn’t load. Your places are still listed below." />
    );
  }

  // Selected last, so it draws above its neighbours instead of behind one.
  const ordered = [
    ...placeLogs.filter((placeLog) => placeLog.id !== selectedId),
    ...placeLogs.filter((placeLog) => placeLog.id === selectedId),
  ];

  return (
    <Box sx={{ height: "100%", width: "100%", position: "relative" }}>
      <Map
        ref={mapRef}
        mapboxAccessToken={MAPBOX_TOKEN}
        mapStyle={MAP_STYLE}
        initialViewState={initialView}
        onMoveEnd={rememberView}
        onError={() => setTilesFailed(true)}
        style={{ height: "100%", width: "100%" }}
      >
        <NavigationControl position="top-right" showCompass={false} />
        <GeolocateControl
          position="top-right"
          positionOptions={{ enableHighAccuracy: true }}
          onError={() => setLocateFailed(true)}
        />
        {ordered.map((placeLog) => {
          const selected = placeLog.id === selectedId;
          return (
            <Marker
              key={placeLog.id}
              longitude={placeLog.longitude}
              latitude={placeLog.latitude}
              anchor="bottom"
              onClick={(event) => {
                // Without this the map treats the tap as a map click.
                event.originalEvent.stopPropagation();
                onSelect(placeLog.id);
              }}
            >
              <PlaceIcon
                aria-label={placeLog.name}
                sx={{
                  cursor: "pointer",
                  fontSize: selected ? 44 : 32,
                  color: selected ? "primary.main" : "text.secondary",
                  filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.4))",
                }}
              />
            </Marker>
          );
        })}
      </Map>

      <Snackbar
        open={locateFailed}
        autoHideDuration={5000}
        onClose={() => setLocateFailed(false)}
        anchorOrigin={{ vertical: "top", horizontal: "center" }}
      >
        <Alert severity="warning" onClose={() => setLocateFailed(false)}>
          Couldn’t find your location.
        </Alert>
      </Snackbar>
    </Box>
  );
}
