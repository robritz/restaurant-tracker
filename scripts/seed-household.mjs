// Creates the one Household and the one credential that can sign in to it.
//
// There is no self-signup (see issue #34), so the first identity has to come
// from somewhere: this script is that somewhere, and `npm run supabase:reset`
// runs it so a reset database still leaves a working login.
//
// Idempotent -- safe to re-run against a database that already has the
// Household. Run with `node --env-file=.env.local`, which is where the
// credential lives; it is never committed.
import { createClient } from "@supabase/supabase-js";

function readEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    console.error("Copy .env.local.example to .env.local and fill it in.");
    process.exit(1);
  }
  return value;
}

// Same defensive strip as src/lib/supabase/env.ts: `supabase status` prints
// API_URL next to REST_URL, and pasting the wrong one fails obscurely.
function normalizeUrl(url) {
  return url
    .replace(/\/(rest|auth|graphql|storage|functions)\/v1\/?$/, "")
    .replace(/\/$/, "");
}

const url = normalizeUrl(readEnv("SUPABASE_URL"));
const serviceRoleKey = readEnv("SUPABASE_SERVICE_ROLE_KEY");
const email = readEnv("HOUSEHOLD_EMAIL");
const password = readEnv("HOUSEHOLD_PASSWORD");
const householdName = process.env.HOUSEHOLD_NAME?.trim() || "Our Household";

const supabase = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function fail(message, error) {
  console.error(message, error?.message ?? error ?? "");
  process.exit(1);
}

async function findIdentityByEmail() {
  // listUsers pages; the seeded database has one identity, but paging keeps
  // this honest if that ever stops being true.
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) fail("Unable to list existing identities.", error);
    const match = data.users.find(
      (user) => user.email?.toLowerCase() === email.toLowerCase(),
    );
    if (match) return match;
    if (data.users.length < 200) return null;
  }
}

async function ensureIdentity() {
  const existing = await findIdentityByEmail();
  if (existing) {
    console.log(`Identity already exists for ${email}.`);
    return existing;
  }

  // email_confirm so the identity can sign in without an email round-trip.
  // Local Supabase has confirmations off anyway, but hosted Supabase confirms
  // by default and a seeded identity has no inbox to check.
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) fail("Unable to create the identity.", error);
  console.log(`Created identity for ${email}.`);
  return data.user;
}

async function ensureHousehold(userId) {
  const { data: membership, error: membershipError } = await supabase
    .from("household_members")
    .select("household_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (membershipError) fail("Unable to read existing memberships.", membershipError);

  if (membership) {
    console.log("Household membership already exists; nothing to do.");
    return membership.household_id;
  }

  const { data: household, error: householdError } = await supabase
    .from("households")
    .insert({ name: householdName })
    .select("id")
    .single();
  if (householdError || !household) fail("Unable to create the Household.", householdError);

  const { error: joinError } = await supabase
    .from("household_members")
    .insert({ household_id: household.id, user_id: userId });
  if (joinError) fail("Unable to add the identity to the Household.", joinError);

  console.log(`Created Household "${householdName}" and added ${email} to it.`);
  return household.id;
}

const identity = await ensureIdentity();
await ensureHousehold(identity.id);
console.log("Seed complete. Sign in at /login.");
