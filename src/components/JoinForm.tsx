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

const MIN_PASSWORD_LENGTH = 8;

/**
 * Sets up the second phone's own sign-in against an invite.
 *
 * An email and a password, not a shared one: the point of the whole feature
 * is that nobody hands over the password they already use.
 */
export default function JoinForm({ token }: { token: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/invites/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, email, password }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setError(body?.error ?? "Unable to join right now.");
        setBusy(false);
        return;
      }

      // A full load, as after signing in: the session cookie is only just set
      // and the app's layout has to mount with it.
      window.location.assign("/");
    } catch {
      setError("Unable to reach the server. Check your connection.");
      setBusy(false);
    }
  }

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH;

  return (
    <Container maxWidth="sm" sx={{ py: 8 }}>
      <Stack spacing={4} alignItems="center">
        <Stack spacing={1} alignItems="center">
          <Typography variant="h4" component="h1" fontWeight={600}>
            Join the household
          </Typography>
          <Typography variant="body1" color="text.secondary" textAlign="center">
            Pick your own sign-in. You&rsquo;ll see the same map as the person
            who invited you.
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
                autoComplete="new-password"
                required
                fullWidth
                disabled={busy}
                error={tooShort}
                helperText={`At least ${MIN_PASSWORD_LENGTH} characters.`}
              />
              <Button
                type="submit"
                variant="contained"
                size="large"
                disabled={busy || !email.trim() || password.length < MIN_PASSWORD_LENGTH}
                startIcon={busy ? <CircularProgress size={18} /> : undefined}
              >
                {busy ? "Joining…" : "Join"}
              </Button>
            </Stack>
          </Box>
        </Paper>
      </Stack>
    </Container>
  );
}
