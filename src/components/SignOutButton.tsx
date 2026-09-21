"use client";

import { useState } from "react";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import LogoutIcon from "@mui/icons-material/Logout";

/**
 * Signing out is a *hard* navigation, not a router push.
 *
 * The map is deliberately kept alive across tab navigation, holding a live
 * Mapbox instance and the PlaceLogs it has already fetched. A client-side
 * navigation would leave all of that mounted, so the previous session's pins
 * would still be on screen behind the login. A full document load destroys it
 * by construction -- and keeps doing so for whatever state gets cached next,
 * without anyone having to remember to reset it.
 */
export default function SignOutButton() {
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Even if clearing the session server-side failed, leaving the page is
      // the more important half of signing out.
    }
    window.location.assign("/login");
  }

  return (
    <Tooltip title="Sign out">
      <span>
        <IconButton
          onClick={signOut}
          disabled={busy}
          aria-label="Sign out"
          sx={{ mx: 0.5, flexShrink: 0 }}
        >
          <LogoutIcon />
        </IconButton>
      </span>
    </Tooltip>
  );
}
