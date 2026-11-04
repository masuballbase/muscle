import { loginClients } from "./lib/test-clients.mjs";
import { InBodyFixtures } from "./lib/inbody-fixtures.mjs";
import { Phase3Fixtures } from "./lib/phase3-fixtures.mjs";
const accounts = await loginClients();
try {
  const inbody = await new InBodyFixtures().cleanup(accounts),
    training = await new Phase3Fixtures(
      "/tmp/muscle-phase5-training-fixtures.json",
    ).cleanup(accounts);
  console.log(
    JSON.stringify({
      remainingInBodyFixtures: inbody,
      remainingTrainingFixtures: training,
    }),
  );
  if (inbody || training) process.exitCode = 1;
} finally {
  for (const a of accounts) await a.client.auth.signOut({ scope: "local" });
}
