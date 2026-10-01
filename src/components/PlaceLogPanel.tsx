"use client";

import { useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { PlaceLogSummary } from "@/app/api/place-logs/route";
import type { PlaceLog } from "@/app/api/place-logs/[id]/route";
import { skeletonCount } from "@/lib/place-logs";
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
}: {
  summary: PlaceLogSummary;
}) {
  // The outcome carries the Place it belongs to, so the previous Place's
  // dishes cannot sit under this Place's name: a result for any other id is
  // simply not this Place's, and reads as still-loading. That is what makes
  // the stale state unreachable, rather than an effect racing to clear it.
  const [result, setResult] = useState<{
    id: string;
    placeLog: PlaceLog | null;
    failed: boolean;
  } | null>(null);
  const current = result?.id === summary.id ? result : null;
  const placeLog = current?.placeLog ?? null;
  const failed = current?.failed ?? false;

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        // no-store: the payload's thumbnail URLs are signed for an hour,
        // so a cached one would hand back URLs that have since expired.
        const res = await fetch(`/api/place-logs/${summary.id}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error("Failed to load place log");
        const data = (await res.json()) as { placeLog: PlaceLog };
        if (active)
          setResult({ id: summary.id, placeLog: data.placeLog, failed: false });
      } catch {
        if (active)
          setResult({ id: summary.id, placeLog: null, failed: true });
      }
    })();
    return () => {
      active = false;
    };
  }, [summary.id]);

  return (
    <Box>
      <Stack spacing={0.5} sx={{ p: 2, pb: 1 }}>
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
        <DishGallerySkeleton count={skeletonCount(summary.entry_count)} />
      )}
    </Box>
  );
}
