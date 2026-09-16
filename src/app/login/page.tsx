import type { Metadata } from "next";
import LoginForm from "@/components/LoginForm";
import { safeDestination } from "@/lib/auth/redirect";

export const metadata: Metadata = {
  title: "Sign in · Restaurant Tracker",
};

/**
 * Outside the (app) group on purpose: no tab bar, and no persistent map to
 * keep alive for someone who is not signed in.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return <LoginForm destination={safeDestination(next)} />;
}
