// Non-mutating readiness probes: each null ID is rejected before any DML in the approved SQL.
import { loginClients } from "./lib/test-clients.mjs";
const accounts = await loginClients();
let unavailable = false,
  failed = false;
try {
  for (const account of accounts) {
    const probes = [
      [
        "save_training_menu",
        { p_id: null, p_name: "", p_items: [], p_expected: null },
        "22023",
      ],
      [
        "edit_training_history",
        {
          p_id: null,
          p_revision: 0,
          p_name: "",
          p_ended_at: null,
          p_sections: [],
        },
        "P0002",
      ],
      ["archive_training_exercise", { p_id: null }, "P0002"],
    ];
    for (const [name, args, expected] of probes) {
      const { error } = await account.client.rpc(name, args);
      const code = error?.code ?? "NO_ERROR";
      if (code === expected)
        console.log(
          `READY ${account.label}/${name}: invalid ID rejected before writes`,
        );
      else if (code === "PGRST202") {
        unavailable = true;
        console.log(
          `UNVERIFIED ${account.label}/${name}: RPC not available (PGRST202)`,
        );
      } else {
        failed = true;
        console.log(
          `UNVERIFIED ${account.label}/${name}: unexpected result (${code})`,
        );
      }
    }
  }
} finally {
  for (const account of accounts)
    await account.client.auth.signOut({ scope: "local" });
}
console.log(
  "No fixture or business data was created, updated or deleted. Readiness is not a substitute for CRUD and rollback verification.",
);
process.exitCode = failed ? 1 : unavailable ? 2 : 0;
