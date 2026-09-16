"use client";

import { Suspense, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Box from "@mui/material/Box";
import MapView from "./MapView";

const MAP_PATH = "/map";

/**
 * Keeps the map alive across tab navigation. Capture and the map are real
 * routes, so the map page's own subtree is torn down when the user switches
 * tabs -- which would flash, re-download every tile, and reset the camera on
 * every return from the capture tab. Mounting the map here, beside the
 * routed children rather than inside them, is what stops that.
 *
 * It is mounted lazily: until the map tab has been opened once, there is
 * nothing to keep alive, and a map initialised inside a hidden container
 * would have no size to frame its pins in.
 */
export default function PersistentMap({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const onMap = pathname === MAP_PATH;
  const [everOpened, setEverOpened] = useState(false);

  useEffect(() => {
    if (onMap) setEverOpened(true);
  }, [onMap]);

  return (
    <>
      {everOpened && (
        <Box
          sx={{ height: "100%", display: onMap ? "block" : "none" }}
          aria-hidden={!onMap}
        >
          {/* The selected Place is read from the query string. */}
          <Suspense>
            <MapView visible={onMap} />
          </Suspense>
        </Box>
      )}
      <Box sx={{ height: "100%", display: onMap ? "none" : "block" }}>
        {children}
      </Box>
    </>
  );
}
