"use client";

import { useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import RestaurantIcon from "@mui/icons-material/Restaurant";
import type { PlaceLogSummary } from "@/app/api/place-logs/route";
import PlaceLogList from "./PlaceLogList";

type Status = "loading" | "ready" | "error";

// The map keeps a fixed share of the screen so it never scrolls away while
// the panel below it scrolls (see #14).
const MAP_HEIGHT = "45%";

function EmptyState() {
  return (
    <Stack
      spacing={2}
      alignItems="center"
      justifyContent="center"
      sx={{ height: "100%", p: 4, textAlign: "center" }}
    >
      <RestaurantIcon sx={{ fontSize: 48, color: "text.disabled" }} />
      <Typography variant="h6">No meals logged yet</Typography>
      <Typography variant="body2" color="text.secondary">
        Add a photo of a dish on the Add tab and it will show up here on the
        map.
      </Typography>
    </Stack>
  );
}

export default function MapView() {
  const [placeLogs, setPlaceLogs] = useState<PlaceLogSummary[]>([]);
  const [status, setStatus] = useState<Status>("loading");

  // Refetched on mount, which is what keeps the map current after an Entry
  // is saved on the capture tab -- saving deliberately doesn't touch it.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/place-logs");
        if (!res.ok) throw new Error("Failed to load place logs");
        const data = (await res.json()) as { placeLogs: PlaceLogSummary[] };
        if (!active) return;
        setPlaceLogs(data.placeLogs);
        setStatus("ready");
      } catch {
        if (active) setStatus("error");
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  if (status === "loading") {
    return (
      <Stack alignItems="center" justifyContent="center" sx={{ height: "100%" }}>
        <CircularProgress />
      </Stack>
    );
  }

  if (status === "error") {
    return (
      <Box sx={{ p: 2 }}>
        <Alert severity="error">
          Couldn’t load the places you’ve eaten. Please try again.
        </Alert>
      </Box>
    );
  }

  // An empty world map reads as broken rather than empty, so suppress the
  // map entirely until there's something to pin.
  if (placeLogs.length === 0) return <EmptyState />;

  return (
    <Box
      sx={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <Box
        sx={{
          height: MAP_HEIGHT,
          flexShrink: 0,
          bgcolor: "action.hover",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Typography variant="body2" color="text.secondary">
          The map lives here.
        </Typography>
      </Box>

      {/* minHeight: 0 lets this scroll internally instead of growing the
          page, which is what keeps the map above it always visible. */}
      <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        <PlaceLogList placeLogs={placeLogs} />
      </Box>
    </Box>
  );
}
