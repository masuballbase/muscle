import { loginClients } from "./lib/test-clients.mjs";
import { Phase3Fixtures } from "./lib/phase3-fixtures.mjs";
import { Phase4GoalFixtures } from "./lib/phase4-goal-fixtures.mjs";
const accounts = await loginClients();
try {
  const goals = await new Phase4GoalFixtures().cleanup(accounts);
  const training = await new Phase3Fixtures(
    "/tmp/muscle-phase4-browser-fixtures.json",
  ).cleanup(accounts);
  console.log(
    JSON.stringify({
      remainingGoalFixtures: goals,
      remainingTrainingFixtures: training,
    }),
  );
  if (goals || training) process.exitCode = 1;
} finally {
  for (const a of accounts) await a.client.auth.signOut({ scope: "local" });
}
