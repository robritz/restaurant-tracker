"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import PersonRemoveIcon from "@mui/icons-material/PersonRemove";
import LogoutIcon from "@mui/icons-material/Logout";
import DeleteIcon from "@mui/icons-material/Delete";
import { inviteState } from "@/lib/invites/state";

export type Member = {
  user_id: string;
  email: string;
  joined_at: string;
  role: string;
};
export type Invite = {
  id: string;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
};

function formatDay(value: string): string {
  return new Date(value).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

/**
 * Who is in the Household, and what the viewer may do about it.
 *
 * The admin invites and removes anyone but themselves; everyone else can only
 * leave. The policies enforce exactly that, so this decides what to *offer* --
 * a button nobody can use is worse than no button.
 */
export default function HouseholdMembers({
  members,
  invites,
  currentUserId,
  isAdmin,
}: {
  members: Member[];
  invites: Invite[];
  currentUserId: string | null;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The link lives here and nowhere else: the server returns the token once,
  // so navigating away loses it for good.
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  /** Every button here is the same shape: call a route, then re-read the page. */
  async function submit(
    request: () => Promise<Response>,
    onOk?: (body: Record<string, unknown>) => void,
  ) {
    setBusy(true);
    setError(null);
    try {
      const response = await request();
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError((body as { error?: string }).error ?? "That didn't work.");
        return;
      }
      onOk?.(body as Record<string, unknown>);
      router.refresh();
    } catch {
      setError("Unable to reach the server. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  function invite() {
    setCopied(false);
    return submit(
      () => fetch("/api/invites", { method: "POST" }),
      (body) => setLink(`${window.location.origin}${body.path as string}`),
    );
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      // Clipboard access can be refused; the link is on screen to select.
      setError("Couldn't copy automatically — select the link instead.");
    }
  }

  return (
    <Stack spacing={3}>
      {error && <Alert severity="error">{error}</Alert>}

      <Paper sx={{ p: 2 }}>
        <Typography variant="subtitle1" fontWeight={600}>
          Phones in this household
        </Typography>
        <List dense disablePadding>
          {members.map((member) => {
            const isMe = member.user_id === currentUserId;
            const admin = member.role === "admin";
            // The admin removes others; anyone else removes only themselves.
            // An admin is never offered a way to remove themselves.
            const removable = isMe ? !admin : isAdmin;
            return (
              <ListItem
                key={member.user_id}
                disableGutters
                secondaryAction={
                  removable ? (
                    <Tooltip
                      title={isMe ? "Leave this household" : "Remove access"}
                    >
                      <span>
                        <IconButton
                          edge="end"
                          aria-label={
                            isMe
                              ? "Leave this household"
                              : `Remove ${member.email}`
                          }
                          disabled={busy}
                          onClick={() =>
                            submit(
                              () =>
                                fetch(`/api/members/${member.user_id}`, {
                                  method: "DELETE",
                                }),
                              // Leaving takes away the page you are on.
                              isMe
                                ? () => window.location.assign("/")
                                : undefined,
                            )
                          }
                        >
                          {isMe ? <LogoutIcon /> : <PersonRemoveIcon />}
                        </IconButton>
                      </span>
                    </Tooltip>
                  ) : undefined
                }
              >
                <ListItemText
                  primary={member.email}
                  secondary={`Joined ${formatDay(member.joined_at)}`}
                />
                <Stack direction="row" spacing={0.5} sx={{ mr: 1 }}>
                  {admin && <Chip label="Admin" size="small" color="primary" />}
                  {isMe && <Chip label="You" size="small" />}
                </Stack>
              </ListItem>
            );
          })}
        </List>
        <Typography variant="caption" color="text.secondary">
          {isAdmin
            ? "Removing a phone ends its access straight away. You run this household, so you can't remove yourself."
            : "Only the admin can invite or remove another phone. You can leave whenever you like."}
        </Typography>
      </Paper>

      {/* Inviting is the admin's, so a member is not shown a control the
          policies would refuse. */}
      {isAdmin && (
        <Paper sx={{ p: 2 }}>
          <Stack spacing={2}>
            <Box>
              <Typography variant="subtitle1" fontWeight={600}>
                Invite another phone
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Send the link however you like. It works once, and expires.
              </Typography>
            </Box>

            <Button
              variant="contained"
              onClick={invite}
              disabled={busy}
              startIcon={busy ? <CircularProgress size={18} /> : undefined}
            >
              Create an invite link
            </Button>

            {link && (
              <Alert severity="success" icon={false}>
                <Stack spacing={1}>
                  <Typography variant="body2">
                    Copy this now — it is shown only once.
                  </Typography>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <TextField
                      value={link}
                      size="small"
                      fullWidth
                      slotProps={{
                        htmlInput: {
                          readOnly: true,
                          "aria-label": "Invite link",
                        },
                      }}
                      onFocus={(event) => event.target.select()}
                    />
                    <Tooltip title={copied ? "Copied" : "Copy link"}>
                      <IconButton onClick={copy} aria-label="Copy invite link">
                        <ContentCopyIcon />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                </Stack>
              </Alert>
            )}

            {invites.length > 0 && (
              <List dense disablePadding>
                {invites.map((item) => {
                  const state = inviteState(item);
                  return (
                    <ListItem
                      key={item.id}
                      disableGutters
                      secondaryAction={
                        <Tooltip title="Revoke">
                          <span>
                            <IconButton
                              edge="end"
                              aria-label={`Revoke invite created ${formatDay(item.created_at)}`}
                              disabled={busy}
                              onClick={() =>
                                submit(() =>
                                  fetch(`/api/invites/${item.id}`, {
                                    method: "DELETE",
                                  }),
                                )
                              }
                            >
                              <DeleteIcon />
                            </IconButton>
                          </span>
                        </Tooltip>
                      }
                    >
                      <ListItemText
                        primary={`Invite from ${formatDay(item.created_at)}`}
                        secondary={
                          state === "accepted"
                            ? "Used"
                            : state === "expired"
                              ? "Expired"
                              : `Expires ${formatDay(item.expires_at)}`
                        }
                      />
                    </ListItem>
                  );
                })}
              </List>
            )}
          </Stack>
        </Paper>
      )}
    </Stack>
  );
}
