import type { Metadata, Viewport } from "next";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v15-appRouter";
import { ThemeProvider } from "@mui/material/styles";
import Box from "@mui/material/Box";
import CssBaseline from "@mui/material/CssBaseline";
import AppTabs from "@/components/AppTabs";
import theme from "@/theme";

export const metadata: Metadata = {
  title: "Restaurant Tracker",
  description: "Keep track of places your family likes to eat",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <AppRouterCacheProvider>
          <ThemeProvider theme={theme}>
            <CssBaseline />
            {/*
              Dynamic viewport units, not vh: mobile browser chrome showing
              and hiding would otherwise clip the bottom of a pane that is
              meant to fill the screen. `minHeight: 0` on the main region
              lets a child own its own scrolling instead of growing the page.
            */}
            <Box
              sx={{
                height: "100dvh",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <AppTabs />
              <Box component="main" sx={{ flex: 1, minHeight: 0, overflow: "auto" }}>
                {children}
              </Box>
            </Box>
          </ThemeProvider>
        </AppRouterCacheProvider>
      </body>
    </html>
  );
}
