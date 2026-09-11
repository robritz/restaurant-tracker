"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import AddAPhotoIcon from "@mui/icons-material/AddAPhoto";
import MapIcon from "@mui/icons-material/Map";

const TABS = [
  { href: "/", label: "Add", icon: <AddAPhotoIcon /> },
  { href: "/map", label: "Map", icon: <MapIcon /> },
] as const;

/**
 * Capture and the map are real routes rather than client-side tab state, so
 * a tab is linkable and the browser back gesture behaves. Capture stays the
 * landing tab -- logging a dish is the thing done most often.
 */
export default function AppTabs() {
  const pathname = usePathname();
  const value = TABS.some((tab) => tab.href === pathname) ? pathname : false;

  return (
    <Tabs
      value={value}
      variant="fullWidth"
      sx={{ borderBottom: 1, borderColor: "divider", flexShrink: 0 }}
    >
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
  );
}
