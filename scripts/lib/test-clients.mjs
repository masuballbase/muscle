import { createClient } from "@supabase/supabase-js";
export function makeClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (
    !url ||
    !key ||
    new URL(url).hostname !== "mcuiikilwrxuylwuljmk.supabase.co"
  )
    throw new Error("Expected project configuration required");
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
export async function loginClients() {
  const accounts = [];
  try {
    for (const label of ["A", "B"]) {
      const email = process.env[`MUSCLE_TEST_${label}_EMAIL`],
        password = process.env[`MUSCLE_TEST_${label}_PASSWORD`];
      if (!email || !password)
        throw new Error(`Account ${label}: configuration unavailable`);
      const client = makeClient();
      const { data, error } = await client.auth.signInWithPassword({
        email,
        password,
      });
      if (error || !data.user)
        throw new Error(`Account ${label}: authentication failed`);
      accounts.push({ label, client, userId: data.user.id });
    }
    if (accounts[0].userId === accounts[1].userId)
      throw new Error("Distinct accounts required");
    return accounts;
  } catch (error) {
    for (const account of accounts)
      await account.client.auth.signOut({ scope: "local" });
    throw error;
  }
}
