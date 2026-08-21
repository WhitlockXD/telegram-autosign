import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { RunHistory } from "../server/history.js";

test("run history persists newest records first", async () => {
  const workdir = await fs.mkdtemp(path.join(os.tmpdir(), "tg-history-"));
  const history = new RunHistory(workdir, 2);
  await history.add({ task: "first" });
  await history.add({ task: "second" });
  await history.add({ task: "third" });
  assert.deepEqual((await history.list()).map((item) => item.task), ["third", "second"]);
});
