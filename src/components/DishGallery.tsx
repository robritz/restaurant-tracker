"use client";

import { useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import Skeleton from "@mui/material/Skeleton";
import Typography from "@mui/material/Typography";
import type { PlaceLogEntry } from "@/app/api/place-logs/[id]/route";

// CSS multi-column masonry: portrait and landscape photos both show whole
// instead of being cropped to a uniform tile, with no measuring library and
// so no measurement pass to jank.
const COLUMNS = { xs: 2, sm: 3, md: 2, lg: 3 };

const GAP = 1;

function Tile({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{ breakInside: "avoid", mb: GAP }}>{children}</Box>
  );
}

function Columns({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{ columnCount: COLUMNS, columnGap: GAP, p: GAP }}>{children}</Box>
  );
}

/**
 * Placeholders matching the number of dishes at this Place, so the panel
 * shows how much is coming rather than an empty box.
 */
export function DishGallerySkeleton({ count }: { count: number }) {
  return (
    <Columns>
      {Array.from({ length: count }, (_, index) => (
        <Tile key={index}>
          {/* Alternating heights: a real gallery is never a uniform grid,
              and a uniform skeleton would resettle visibly when it isn't. */}
          <Skeleton
            variant="rectangular"
            height={index % 2 === 0 ? 160 : 220}
            sx={{ borderRadius: 1 }}
          />
          <Skeleton variant="text" width="70%" />
        </Tile>
      ))}
    </Columns>
  );
}

/** The full-resolution photo, signed only now that it's being looked at. */
function FullScreenDish({
  entry,
  onClose,
}: {
  entry: PlaceLogEntry;
  onClose: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/entries/${entry.id}/photo`);
        if (!res.ok) throw new Error("Failed to sign photo");
        const data = (await res.json()) as { url: string };
        if (active) setUrl(data.url);
      } catch {
        if (active) setFailed(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [entry.id]);

  return (
    // Dialog brings Escape and click-outside-to-close with it, plus focus
    // trapping, so none of that is hand-rolled here.
    <Dialog open onClose={onClose} maxWidth="lg" fullWidth>
      <Box sx={{ bgcolor: "common.black", textAlign: "center" }}>
        {failed ? (
          <Alert severity="error" sx={{ m: 2 }}>
            Couldn’t load this photo.
          </Alert>
        ) : url ? (
          <Box
            component="img"
            src={url}
            alt={entry.title}
            sx={{
              display: "block",
              maxWidth: "100%",
              maxHeight: "80dvh",
              m: "0 auto",
            }}
          />
        ) : (
          <Box sx={{ py: 8 }}>
            <CircularProgress />
          </Box>
        )}
      </Box>
      <Typography variant="subtitle1" sx={{ p: 2 }}>
        {entry.title}
      </Typography>
    </Dialog>
  );
}

/**
 * Every dish photographed at a Place, newest first, each captioned with its
 * Title. Captions sit below their photo rather than over it: an overlay is
 * unreadable against bright food photography, and a long dish name needs
 * somewhere to wrap.
 */
export default function DishGallery({ entries }: { entries: PlaceLogEntry[] }) {
  const [opened, setOpened] = useState<PlaceLogEntry | null>(null);

  return (
    <>
      <Columns>
        {entries.map((entry) => (
          <Tile key={entry.id}>
            <Box
              component="button"
              type="button"
              onClick={() => setOpened(entry)}
              sx={{
                display: "block",
                width: "100%",
                p: 0,
                border: 0,
                bgcolor: "transparent",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <Box
                component="img"
                src={entry.thumbnail_url}
                alt={entry.title}
                loading="lazy"
                sx={{
                  display: "block",
                  width: "100%",
                  borderRadius: 1,
                  bgcolor: "action.hover",
                  // The stored dimensions reserve the tile's height before
                  // the image arrives, so the grid doesn't shift under a
                  // finger that's already reaching for a photo.
                  aspectRatio: `${entry.width} / ${entry.height}`,
                }}
              />
              <Typography variant="caption" component="p" sx={{ mt: 0.5 }}>
                {entry.title}
              </Typography>
            </Box>
          </Tile>
        ))}
      </Columns>

      {opened && (
        <FullScreenDish entry={opened} onClose={() => setOpened(null)} />
      )}
    </>
  );
}
