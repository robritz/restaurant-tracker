"use client";

import { FormEvent, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Container from "@mui/material/Container";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

type Status = "idle" | "signing-in" | "error";

export default function LoginForm({ destination }: { destination: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setStatus("signing-in");
    setError(null);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setError(body?.error ?? "Unable to sign in right now.");
        setStatus("error");
        return;
      }

      // A full document load, not a client-side push: the session cookie is
      // only just set, and the app's layout has to mount with it. It also
      // guarantees nothing from the signed-out page survives.
      window.location.assign(destination);
    } catch {
      setError("Unable to reach the server. Check your connection.");
      setStatus("error");
    }
  }

  const busy = status === "signing-in";

  return (
    <Container maxWidth="sm" sx={{ py: 8 }}>
      <Stack spacing={4} alignItems="center">
        <Stack spacing={1} alignItems="center">
          <Typography variant="h4" component="h1" fontWeight={600}>
            Restaurant Tracker
          </Typography>
          <Typography variant="body1" color="text.secondary" textAlign="center">
            Sign in to see where your family has eaten.
          </Typography>
        </Stack>

        <Paper sx={{ p: 3, width: "100%" }}>
          <Box component="form" onSubmit={handleSubmit} noValidate>
            <Stack spacing={2}>
              {error && <Alert severity="error">{error}</Alert>}
              <TextField
                label="Email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="username"
                autoFocus
                required
                fullWidth
                disabled={busy}
              />
              <TextField
                label="Password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
                fullWidth
                disabled={busy}
              />
              <Button
                type="submit"
                variant="contained"
                size="large"
                disabled={busy || !email.trim() || !password}
                startIcon={busy ? <CircularProgress size={18} /> : undefined}
              >
                {busy ? "Signing in…" : "Sign in"}
              </Button>
            </Stack>
          </Box>
        </Paper>
      </Stack>
    </Container>
  );
}
