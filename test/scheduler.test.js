import test from "node:test";
import assert from "node:assert/strict";
import { CheckinScheduler } from "../server/scheduler.js";

test("scheduler runs a loaded check-in config and records the result", async () => {
  const recorded = [];
  const config = { sign_at: "0 6 * * *", random_seconds: 0 };
  const scheduler = new CheckinScheduler({
    runner: { run: async (value) => ({ results: [{ ok: value === config }] }) },
    loadConfig: async () => config,
    listConfigs: async () => ["morning"],
    onResult: async (result) => recorded.push(result),
    logger: { error: () => {} },
  });
  await scheduler.loadAll();
  assert.equal(scheduler.jobs.has("morning"), true);
  await scheduler.execute("morning");
  scheduler.stop();
  assert.equal(recorded[0].task, "morning");
  assert.equal(recorded[0].source, "schedule");
  assert.equal(recorded[0].results[0].ok, true);
});
