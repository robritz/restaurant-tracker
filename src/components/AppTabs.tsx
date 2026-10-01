"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import AddAPhotoIcon from "@mui/icons-material/AddAPhoto";
import MapIcon from "@mui/icons-material/Map";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import GroupIcon from "@mui/icons-material/Group";
import SignOutButton from "./SignOutButton";

const TABS = [
  { href: "/", label: "Add", icon: <AddAPhotoIcon /> },
  { href: "/map", label: "Map", icon: <MapIcon /> },
] as const;

/**
 * Capture and the map are real routes rather than client-side tab state, so
 * a tab is linkable and the browser back gesture behaves. Capture stays the
 * landing tab -- logging a dish is the thing done most often.
 *
 * Sign-out and the household screen sit beside the tabs rather than being
 * ones. Both are places you go occasionally -- to invite a phone or to remove
 * one -- while the tabs are the two things done every time.
 */
export default function AppTabs() {
  const pathname = usePathname();
  const value = TABS.some((tab) => tab.href === pathname) ? pathname : false;

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        borderBottom: 1,
        borderColor: "divider",
        flexShrink: 0,
      }}
    >
      <Tabs value={value} variant="fullWidth" sx={{ flex: 1, minWidth: 0 }}>
        {TABS.map((tab) => (
          <Tab
            key={tab.href}
            value={tab.href}
            href={tab.href}
            component={Link}
            label={tab.label}
            icon={tab.icon}
            iconPosition="start"
            sx={{ minHeight: 56 }}
          />
        ))}
      </Tabs>
      <Tooltip title="Household">
        <IconButton
          component={Link}
          href="/household"
          aria-label="Household"
          sx={{ flexShrink: 0 }}
        >
          <GroupIcon />
        </IconButton>
      </Tooltip>
      <SignOutButton />
    </Box>
  );
}
