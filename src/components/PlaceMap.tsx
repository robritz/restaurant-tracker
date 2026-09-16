"use client";

import { useEffect, useRef, useState } from "react";
import Map, {
  GeolocateControl,
  Marker,
  type MapRef,
} from "react-map-gl/mapbox";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Snackbar from "@mui/material/Snackbar";
import PlaceIcon from "@mui/icons-material/Place";
import "mapbox-gl/dist/mapbox-gl.css";
import type { PlaceLogSummary } from "@/app/api/place-logs/route";
import { INITIAL_FIT, drawOrder, fitBounds } from "@/lib/map/pins";

// Scoped to styles and fonts and URL-restricted at Mapbox -- the secret
// MAPBOX_TOKEN keeps its search scopes and never reaches the browser. See
// docs/adr/0002-separate-public-mapbox-token.md.
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_PUBLIC_TOKEN;

const MAP_STYLE = "mapbox://styles/mapbox/streets-v12";

/**
 * One pin per Place, framed on open to everywhere the family has eaten.
 * Selection lives above this component (in the URL), so the map is told
 * which pin is selected rather than remembering it.
 *
 * Mounted once and kept alive across tab navigation -- tearing the GL
 * instance down would flash, re-download tiles, and reset the camera every
 * time the user came back from the capture tab.
 */
export default function PlaceMap({
  placeLogs,
  selectedId,
  onSelect,
  visible,
}: {
  placeLogs: PlaceLogSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** False while another tab is on screen, since the map is never unmounted. */
  visible: boolean;
}) {
  const mapRef = useRef<MapRef>(null);
  const [tilesFailed, setTilesFailed] = useState(false);
  const [locateFailed, setLocateFailed] = useState(false);
  // Framed from whatever was known at mount; the map keeps its own camera
  // from then on.
  const [initialBounds] = useState(() => fitBounds(placeLogs));

  // The map is laid out at zero size while its tab is hidden, so it has to
  // be told the viewport changed on the way back in.
  useEffect(() => {
    if (visible) mapRef.current?.resize();
  }, [visible]);

  // The place being read about is the place being looked at -- true whether
  // the pin was tapped on the map or the Place was picked from the list.
  // The camera eases to the Place's coordinates and leaves the zoom alone,
  // so a user comparing two places keeps the view they chose.
  useEffect(() => {
    const selected = placeLogs.find((placeLog) => placeLog.id === selectedId);
    if (!selected) return;
    mapRef.current?.easeTo({
      center: [selected.longitude, selected.latitude],
      duration: 800,
    });
  }, [placeLogs, selectedId]);

  if (!MAPBOX_TOKEN) {
    // Loud in development, because a missing token is indistinguishable
    // from a broken map by eye.
    if (process.env.NODE_ENV === "development") {
      console.error(
        "NEXT_PUBLIC_MAPBOX_PUBLIC_TOKEN is not set. The map cannot render without it -- see .env.local.example.",
      );
    }
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
        <Alert severity="warning">
          The map isn’t configured. Your places are still listed below.
        </Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ height: "100%", width: "100%", position: "relative" }}>
      <Map
        ref={mapRef}
        mapboxAccessToken={MAPBOX_TOKEN}
        mapStyle={MAP_STYLE}
        initialViewState={{
          bounds: initialBounds,
          fitBoundsOptions: INITIAL_FIT,
        }}
        onError={() => setTilesFailed(true)}
        // Mapbox reports recoverable failures through the same channel as
        // fatal ones, so a tile that arrives late clears the message rather
        // than leaving it up for the rest of the session.
        onSourceData={(event) => {
          if (event.isSourceLoaded) setTilesFailed(false);
        }}
        style={{ height: "100%", width: "100%" }}
      >
        <GeolocateControl
          position="top-right"
          positionOptions={{ enableHighAccuracy: true }}
          trackUserLocation={false}
          onError={() => setLocateFailed(true)}
        />
        {drawOrder(placeLogs, selectedId).map((placeLog) => {
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

      {/* Overlaid, not substituted: the map keeps its camera and its tiles,
          and the panel beside it goes on working regardless. */}
      {tilesFailed && (
        <Alert
          severity="warning"
          sx={{
            position: "absolute",
            top: 8,
            left: 8,
            right: 56,
            pointerEvents: "none",
          }}
        >
          The map couldn’t load. Your places are still listed.
        </Alert>
      )}

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
