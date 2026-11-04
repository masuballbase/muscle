import { loginClients } from "./lib/test-clients.mjs";
import { Phase3Fixtures } from "./lib/phase3-fixtures.mjs";
import { Phase4GoalFixtures } from "./lib/phase4-goal-fixtures.mjs";
import { InBodyFixtures } from "./lib/inbody-fixtures.mjs";
const accounts = await loginClients();
try {
  const training = await new Phase3Fixtures(
      "/tmp/muscle-phase6-fixtures.json",
    ).cleanup(accounts),
    goals = await new Phase4GoalFixtures(
      "/tmp/muscle-phase6-goal-fixtures.json",
    ).cleanup(accounts),
    inbody = await new InBodyFixtures(
      "/tmp/muscle-phase6-inbody-fixtures.json",
    ).cleanup(accounts);
  console.log(
    JSON.stringify({
      remainingTrainingFixtures: training,
      remainingGoalFixtures: goals,
      remainingInBodyFixtures: inbody,
    }),
  );
  const sync = await new Phase3Fixtures(
    "/tmp/muscle-phase6-sync-fixtures.json",
  ).cleanup(accounts);
  console.log(JSON.stringify({ remainingSyncFixtures: sync }));
  if (training + goals + inbody + sync) process.exitCode = 1;
} finally {
  for (const a of accounts) await a.client.auth.signOut({ scope: "local" });
}
