import Box from "@mui/material/Box";
import AppTabs from "@/components/AppTabs";
import PersistentMap from "@/components/PersistentMap";

/**
 * The signed-in app's chrome. Everything under this layout is behind the
 * login (enforced in middleware, not here), which is what lets the map be
 * mounted once and kept alive across tab navigation.
 *
 * Dynamic viewport units, not vh: mobile browser chrome showing and hiding
 * would otherwise clip the bottom of a pane that is meant to fill the
 * screen. `minHeight: 0` on the main region lets a child own its own
 * scrolling instead of growing the page.
 */
export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Box sx={{ height: "100dvh", display: "flex", flexDirection: "column" }}>
      <AppTabs />
      <Box component="main" sx={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        <PersistentMap>{children}</PersistentMap>
      </Box>
    </Box>
  );
}
