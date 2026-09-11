import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

export default function MapPage() {
  return (
    <Box
      sx={{
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Typography variant="body2" color="text.secondary">
        The map lives here.
      </Typography>
    </Box>
  );
}
