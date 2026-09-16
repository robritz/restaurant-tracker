"use client";

import { useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import type { PlaceLogSummary } from "@/app/api/place-logs/route";
import type { PlaceLog } from "@/app/api/place-logs/[id]/route";
import DishGallery, { DishGallerySkeleton } from "./DishGallery";

/**
 * What have we eaten here? The Place's name and address come from the pin
 * data already in hand, so they're on screen the instant a pin is tapped --
 * only the photos are waited for.
 *
 * Re-fetched on every selection, which is also what keeps the signed
 * thumbnail URLs fresh without any expiry-detection machinery.
 */
export default function PlaceLogPanel({
  summary,
  onClear,
}: {
  summary: PlaceLogSummary;
  onClear: () => void;
}) {
  const [placeLog, setPlaceLog] = useState<PlaceLog | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    // Cleared, not left behind: the previous Place's dishes must never sit
    // under this Place's name.
    setPlaceLog(null);
    setFailed(false);
    (async () => {
      try {
        const res = await fetch(`/api/place-logs/${summary.id}`);
        if (!res.ok) throw new Error("Failed to load place log");
        const data = (await res.json()) as { placeLog: PlaceLog };
        if (active) setPlaceLog(data.placeLog);
      } catch {
        if (active) setFailed(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [summary.id]);

  return (
    <Box>
      <Stack spacing={0.5} sx={{ p: 2, pb: 1 }}>
        <Button
          size="small"
          startIcon={<ArrowBackIcon />}
          onClick={onClear}
          sx={{ alignSelf: "flex-start", ml: -1 }}
        >
          All places
        </Button>
        <Typography variant="h6">{summary.name}</Typography>
        <Typography variant="body2" color="text.secondary">
          {summary.address}
        </Typography>
      </Stack>

      {failed ? (
        <Alert severity="error" sx={{ m: 2 }}>
          Couldn’t load the dishes from this place.
        </Alert>
      ) : placeLog ? (
        <DishGallery entries={placeLog.entries} />
      ) : (
        <DishGallerySkeleton count={summary.entry_count} />
      )}
    </Box>
  );
}
