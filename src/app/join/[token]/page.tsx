import type { Metadata } from "next";
import Alert from "@mui/material/Alert";
import Container from "@mui/material/Container";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import JoinForm from "@/components/JoinForm";
import { hashInviteToken } from "@/lib/invites/token";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Join · Restaurant Tracker",
};

// The invite's validity is a live fact; a cached "this link works" would
// outlive the link.
export const dynamic = "force-dynamic";

/**
 * Where an invite link lands. Outside the (app) group, like the login screen:
 * whoever opens this is not signed in yet.
 *
 * The token is checked here so a dead link says so before anyone fills in a
 * form. It is checked again when the form is submitted -- this is a
 * courtesy, not the gate.
 */
export default async function JoinPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: household } = await supabase.rpc("household_for_invite", {
    p_token_hash: hashInviteToken(token),
  });

  if (!household) {
    return (
      <Container maxWidth="sm" sx={{ py: 8 }}>
        <Stack spacing={2}>
          <Typography variant="h4" component="h1" fontWeight={600}>
            Restaurant Tracker
          </Typography>
          {/* Expired, already used, revoked and never-real read alike: which
              one it was would tell a stranger whether they had guessed. */}
          <Alert severity="error">
            This invite is no longer valid. Ask whoever sent it for a new one.
          </Alert>
        </Stack>
      </Container>
    );
  }

  // The Household's name is deliberately not passed down. Holding a valid
  // token is enough to join, but not a reason to be told whose map it is
  // before you have.
  return <JoinForm token={token} />;
}
