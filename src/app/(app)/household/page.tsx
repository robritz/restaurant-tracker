import type { Metadata } from "next";
import Alert from "@mui/material/Alert";
import Container from "@mui/material/Container";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import HouseholdMembers, { type Member } from "@/components/HouseholdMembers";
import { NO_HOUSEHOLD_MESSAGE, requireHousehold } from "@/lib/auth/household";

export const metadata: Metadata = {
  title: "Household · Restaurant Tracker",
};

// Who is in the Household changes when someone is invited or removed, and the
// screen that does both must not be reading a cached answer.
export const dynamic = "force-dynamic";

export default async function HouseholdPage() {
  const context = await requireHousehold();
  if (!context) {
    return (
      <Container maxWidth="sm" sx={{ py: 4 }}>
        <Alert severity="warning">{NO_HOUSEHOLD_MESSAGE}</Alert>
      </Container>
    );
  }

  // requireHousehold() hands back the RLS-enforced client along with the
  // Household; building a second one here would be the mistake that helper
  // exists to prevent.
  const { supabase } = context;

  // Emails come from a definer function because auth.users is beyond any
  // policy here; it scopes itself to the caller's Household.
  const [{ data: members }, { data: invites }, { data: user }] = await Promise.all([
    supabase.rpc("household_members_for_current_user"),
    supabase
      .from("household_invites")
      .select("id, created_at, expires_at, accepted_at")
      .order("created_at", { ascending: false }),
    supabase.auth.getUser(),
  ]);

  const me = user?.user?.id ?? null;

  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <Stack spacing={3}>
        <Stack spacing={0.5}>
          <Typography variant="h5" component="h1" fontWeight={600}>
            Household
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Everyone here shares one map. A dish logged from any phone belongs
            to the household, not to whoever photographed it.
          </Typography>
        </Stack>

        <HouseholdMembers
          members={(members ?? []) as Member[]}
          invites={invites ?? []}
          currentUserId={me}
        />
      </Stack>
    </Container>
  );
}
