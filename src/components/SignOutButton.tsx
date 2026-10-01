"use client";

import { useState } from "react";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import LogoutIcon from "@mui/icons-material/Logout";
import { hardNavigate } from "@/lib/navigation";

/**
 * Signing out is a hard navigation, not a router push -- see
 * `hardNavigate()` for why every session boundary is.
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
    hardNavigate("/login");
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
