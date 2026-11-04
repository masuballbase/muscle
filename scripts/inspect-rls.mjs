import { loginClients } from "./lib/test-clients.mjs";
const accounts = await loginClients();
try {
  const { error } = await accounts[0].client
    .schema("pg_catalog")
    .from("pg_policies")
    .select(
      "schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check",
    )
    .eq("schemaname", "public");
  if (error) {
    console.log(
      `UNVERIFIED policy definitions and table RLS flags: catalog is not exposed (${error.code}).`,
    );
    console.log(
      "Only publishable key and test-user credentials are configured. No database/catalog credentials available.",
    );
    console.log(
      "Read-only SQL for an authorized catalog connection: scripts/inspect-rls.sql",
    );
    process.exitCode = 2;
  } else {
    // A successful API query alone does not expose relrowsecurity/role bypass flags.
    console.log(
      "Policy catalog accessible; use the read-only SQL to inspect complete settings.",
    );
    process.exitCode = 2;
  }
} finally {
  for (const account of accounts)
    await account.client.auth.signOut({ scope: "local" });
}
