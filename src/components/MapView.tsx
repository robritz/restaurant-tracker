"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import RestaurantIcon from "@mui/icons-material/Restaurant";
import type { PlaceLogSummary } from "@/app/api/place-logs/route";
import { SELECTED_PARAM, selectPlaceHref } from "@/lib/map/selection";
import PlaceLogList from "./PlaceLogList";
import PlaceLogPanel from "./PlaceLogPanel";
import PlaceMap from "./PlaceMap";

type Status = "loading" | "ready" | "error";

// The map keeps a fixed share of the screen so it never scrolls away while
// the panel below it scrolls (see #14). Side by side from md up, where a
// stacked map and panel would each be a wide, short strip.
const MAP_HEIGHT = { xs: "45dvh", md: "100%" };

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

export default function MapView({ visible }: { visible: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [placeLogs, setPlaceLogs] = useState<PlaceLogSummary[]>([]);
  const [status, setStatus] = useState<Status>("loading");

  // Refetched every time the tab is opened, which is what keeps the map
  // current after an Entry is saved on the capture tab -- saving
  // deliberately doesn't touch it.
  useEffect(() => {
    if (!visible) return;
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
  }, [visible]);

  // Whether the history entry showing a selection is one this session
  // pushed -- a selection that arrived in a shared link is not.
  const pushedSelection = useRef(false);

  const select = useCallback(
    (id: string) => {
      const { href, mode } = selectPlaceHref(id, {
        hasSelection: searchParams.has(SELECTED_PARAM),
        hasPushedSelection: pushedSelection.current,
      });
      if (mode === "push") pushedSelection.current = true;
      router[mode](href, { scroll: false });
    },
    [router, searchParams],
  );

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

  // A link to a Place that has since lost its Entries shows the list rather
  // than a panel describing nothing.
  const requestedId = searchParams.get(SELECTED_PARAM);
  const selected =
    placeLogs.find((placeLog) => placeLog.id === requestedId) ?? null;

  return (
    <Box
      sx={{
        height: "100%",
        display: "flex",
        flexDirection: { xs: "column", md: "row" },
        overflow: "hidden",
      }}
    >
      <Box
        sx={{
          height: MAP_HEIGHT,
          width: { xs: "100%", md: "55%" },
          flexShrink: 0,
        }}
      >
        <PlaceMap
          placeLogs={placeLogs}
          selectedId={selected?.id ?? null}
          onSelect={select}
          visible={visible}
        />
      </Box>

      {/* minHeight/minWidth 0 lets this scroll internally instead of growing
          the page, which is what keeps the map beside it always visible. */}
      <Box
        sx={{ flex: 1, minHeight: 0, minWidth: 0, overflowY: "auto" }}
      >
        {selected ? (
          <PlaceLogPanel summary={selected} />
        ) : (
          <PlaceLogList placeLogs={placeLogs} onSelect={select} />
        )}
      </Box>
    </Box>
  );
}
