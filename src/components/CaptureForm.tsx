"use client";

import { useState, useRef, ChangeEvent, FormEvent } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Container from "@mui/material/Container";
import Divider from "@mui/material/Divider";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import exifr from "exifr";
import type { Place } from "@/app/api/places/route";

type SuggestionStatus = "idle" | "loading" | "done" | "no-gps" | "error";
type SearchStatus = "idle" | "loading" | "done" | "error";
type SaveStatus = "idle" | "saving" | "saved" | "error";

type Coords = { latitude: number; longitude: number };

async function readGps(file: File): Promise<Coords | null> {
  try {
    const result = await exifr.gps(file);
    if (
      result &&
      typeof result.latitude === "number" &&
      typeof result.longitude === "number"
    ) {
      return { latitude: result.latitude, longitude: result.longitude };
    }
  } catch {
    // Ignore parse errors; treated as "no geolocation data".
  }
  return null;
}

// The point in time the photo represents, falling back to now when the photo
// carries no EXIF date (see CONTEXT.md, "Captured at").
async function readCapturedAt(file: File): Promise<string> {
  try {
    const exif = await exifr.parse(file, {
      pick: ["DateTimeOriginal", "CreateDate"],
    });
    const taken = exif?.DateTimeOriginal ?? exif?.CreateDate;
    if (taken instanceof Date && !Number.isNaN(taken.getTime())) {
      return taken.toISOString();
    }
  } catch {
    // Ignore parse errors; fall back to now.
  }
  return new Date().toISOString();
}

async function fetchPlaces(query: string): Promise<Place[]> {
  const res = await fetch(`/api/places?${query}`);
  if (!res.ok) throw new Error("Place lookup failed");
  const data = (await res.json()) as { places: Place[] };
  return data.places;
}

export default function CaptureForm() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [capturedAt, setCapturedAt] = useState<string | null>(null);

  const [suggestions, setSuggestions] = useState<Place[]>([]);
  const [suggestionStatus, setSuggestionStatus] =
    useState<SuggestionStatus>("idle");

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Place[]>([]);
  const [searchStatus, setSearchStatus] = useState<SearchStatus>("idle");

  const [selectedPlace, setSelectedPlace] = useState<Place | null>(null);
  const [title, setTitle] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  const resetForNewPhoto = () => {
    setSuggestions([]);
    setSuggestionStatus("idle");
    setSearchQuery("");
    setSearchResults([]);
    setSearchStatus("idle");
    setSelectedPlace(null);
    setTitle("");
    setSaveStatus("idle");
    setSaveError(null);
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0];
    if (!selected) return;

    setFile(selected);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(selected);
    });
    resetForNewPhoto();

    setCapturedAt(await readCapturedAt(selected));

    const coords = await readGps(selected);
    if (!coords) {
      setSuggestionStatus("no-gps");
      return;
    }

    setSuggestionStatus("loading");
    try {
      setSuggestions(
        await fetchPlaces(`lat=${coords.latitude}&lon=${coords.longitude}`),
      );
      setSuggestionStatus("done");
    } catch {
      setSuggestionStatus("error");
    }
  };

  const handleSearch = async (event: FormEvent) => {
    event.preventDefault();
    const query = searchQuery.trim();
    if (!query) return;

    setSearchStatus("loading");
    try {
      setSearchResults(await fetchPlaces(`q=${encodeURIComponent(query)}`));
      setSearchStatus("done");
    } catch {
      setSearchStatus("error");
    }
  };

  const handleSave = async () => {
    if (!file || !selectedPlace || !title.trim()) return;

    setSaveStatus("saving");
    setSaveError(null);

    const form = new FormData();
    form.set("title", title.trim());
    form.set("captured_at", capturedAt ?? new Date().toISOString());
    form.set("mapbox_id", selectedPlace.mapbox_id);
    form.set("name", selectedPlace.name);
    form.set("address", selectedPlace.address);
    form.set("latitude", String(selectedPlace.latitude));
    form.set("longitude", String(selectedPlace.longitude));
    form.set("photo", file);

    try {
      const res = await fetch("/api/entries", { method: "POST", body: form });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? "The server rejected this entry.");
      }
      setSaveStatus("saved");
    } catch (error) {
      // A thrown fetch (as opposed to a non-OK response) means the request
      // never landed -- don't surface the browser's raw "Failed to fetch".
      setSaveError(
        error instanceof TypeError
          ? "Couldn’t reach the server."
          : (error as Error).message,
      );
      setSaveStatus("error");
    }
  };

  const startOver = () => {
    setFile(null);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setCapturedAt(null);
    resetForNewPhoto();
  };

  const placeList = (places: Place[]) => (
    <List disablePadding>
      {places.map((place, index) => (
        <Box key={place.mapbox_id}>
          {index > 0 && <Divider component="li" />}
          <ListItemButton
            disableGutters
            selected={selectedPlace?.mapbox_id === place.mapbox_id}
            onClick={() => setSelectedPlace(place)}
            sx={{ px: 1, borderRadius: 1 }}
          >
            <ListItemText
              primary={place.name}
              secondary={place.address || undefined}
            />
          </ListItemButton>
        </Box>
      ))}
    </List>
  );

  return (
    <Container
      maxWidth="sm"
      sx={{ pt: 8, pb: "calc(env(safe-area-inset-bottom) + 96px)" }}
    >
      <Stack spacing={4} alignItems="center">
        <Typography variant="h4" component="h1" fontWeight={600}>
          Restaurant Tracker
        </Typography>
        <Typography variant="body1" color="text.secondary" textAlign="center">
          Add a photo of a dish, pick where you ate it, and give it a name.
        </Typography>

        <Paper
          variant="outlined"
          sx={{
            width: "100%",
            p: 4,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 2,
            borderStyle: "dashed",
          }}
        >
          {previewUrl ? (
            <Box
              component="img"
              src={previewUrl}
              alt="Selected dish"
              sx={{
                maxWidth: "100%",
                maxHeight: 320,
                borderRadius: 1,
                objectFit: "contain",
              }}
            />
          ) : (
            <Typography variant="body2" color="text.secondary">
              No photo selected
            </Typography>
          )}

          <Button
            variant="contained"
            startIcon={<CloudUploadIcon />}
            onClick={() => inputRef.current?.click()}
          >
            {file ? "Change Photo" : "Add Photo"}
          </Button>

          {file && (
            <Typography variant="caption" color="text.secondary">
              {file.name}
            </Typography>
          )}

          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={handleFileChange}
          />
        </Paper>

        {file && saveStatus === "saved" && (
          <Paper variant="outlined" sx={{ width: "100%", p: { xs: 2, sm: 3 } }}>
            <Stack spacing={2}>
              <Alert severity="success">
                Saved “{title.trim()}” at {selectedPlace?.name}.
              </Alert>
              <Button variant="contained" onClick={startOver}>
                Add Another
              </Button>
            </Stack>
          </Paper>
        )}

        {file && saveStatus !== "saved" && (
          <Paper variant="outlined" sx={{ width: "100%", p: { xs: 2, sm: 3 } }}>
            <Stack spacing={2}>
              <Typography variant="h6">Where did you eat this?</Typography>

              {suggestionStatus === "loading" && (
                <Stack direction="row" spacing={1.5} alignItems="center">
                  <CircularProgress size={20} />
                  <Typography variant="body1" color="text.secondary">
                    Finding nearby restaurants…
                  </Typography>
                </Stack>
              )}

              {suggestionStatus === "no-gps" && (
                <Typography variant="body2" color="text.secondary">
                  This photo has no location data — search for the restaurant
                  below.
                </Typography>
              )}

              {suggestionStatus === "error" && (
                <Alert severity="warning">
                  Couldn’t load nearby restaurants — search for it below.
                </Alert>
              )}

              {suggestionStatus === "done" &&
                (suggestions.length > 0 ? (
                  placeList(suggestions)
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    No restaurants found near this photo — search for it below.
                  </Typography>
                ))}

              <Divider />

              <Box component="form" onSubmit={handleSearch}>
                <Stack direction="row" spacing={1}>
                  <TextField
                    fullWidth
                    size="small"
                    label="Search for a restaurant"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                  />
                  <Button
                    type="submit"
                    variant="outlined"
                    disabled={!searchQuery.trim() || searchStatus === "loading"}
                  >
                    Search
                  </Button>
                </Stack>
              </Box>

              {searchStatus === "loading" && (
                <Stack direction="row" spacing={1.5} alignItems="center">
                  <CircularProgress size={20} />
                  <Typography variant="body1" color="text.secondary">
                    Searching…
                  </Typography>
                </Stack>
              )}

              {searchStatus === "error" && (
                <Alert severity="error">
                  Couldn’t search for restaurants. Please try again.
                </Alert>
              )}

              {searchStatus === "done" &&
                (searchResults.length > 0 ? (
                  placeList(searchResults)
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    No restaurants matched that search.
                  </Typography>
                ))}

              {selectedPlace && (
                <>
                  <Divider />
                  <Typography variant="h6">What did you eat?</Typography>
                  <Typography variant="body2" color="text.secondary">
                    At {selectedPlace.name}
                  </Typography>
                  <TextField
                    fullWidth
                    size="small"
                    label="Dish"
                    placeholder="e.g. Margherita Pizza"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                  />

                  {saveStatus === "error" && (
                    <Alert severity="error">
                      {saveError ?? "Saving failed."} Your entry was not saved,
                      so please try again.
                    </Alert>
                  )}

                  <Button
                    variant="contained"
                    onClick={handleSave}
                    disabled={!title.trim() || saveStatus === "saving"}
                    startIcon={
                      saveStatus === "saving" ? (
                        <CircularProgress size={16} color="inherit" />
                      ) : undefined
                    }
                  >
                    {saveStatus === "saving" ? "Saving…" : "Save Entry"}
                  </Button>
                </>
              )}
            </Stack>
          </Paper>
        )}
      </Stack>
    </Container>
  );
}
