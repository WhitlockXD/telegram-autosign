import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { listConfigs, normalizeConfig, readConfig, writeConfig } from "../server/config.js";

test("normalizeConfig keeps check-in actions and defaults", () => {
  const config = normalizeConfig({
    chats: [{ chat_id: "@daily", actions: [{ action: 1, text: "签到" }] }],
  });
  assert.equal(config.sign_at, "0 6 * * *");
  assert.equal(config.chats[0].action_interval, 1);
});

test("zero intervals remain valid", () => {
  const config = normalizeConfig({
    sign_interval: 0,
    chats: [{ chat_id: "@daily", action_interval: 0, actions: [{ action: 1, text: "签到" }] }],
  });
  assert.equal(config.sign_interval, 0);
  assert.equal(config.chats[0].action_interval, 0);
});

test("legacy clock schedule is migrated to cron", () => {
  const config = normalizeConfig({
    sign_at: "06:30:00",
    chats: [{ chat_id: "@daily", actions: [{ action: 1, text: "签到" }] }],
  });
  assert.equal(config.sign_at, "30 6 * * *");
});

test("numeric chat ids from the web form are normalized to numbers", () => {
  const config = normalizeConfig({
    chats: [{ chat_id: "-100123", actions: [{ action: 1, text: "签到" }] }],
  });
  assert.equal(config.chats[0].chat_id, -100123);
});

test("normalizeConfig rejects incomplete chat actions", () => {
  assert.throws(
    () => normalizeConfig({ chats: [{ chat_id: "@daily", actions: [] }] }),
    /至少需要一个动作/,
  );
  assert.throws(
    () => normalizeConfig({ chats: [{ chat_id: "@daily", actions: [{ action: 1 }] }] }),
    /必须填写 text/,
  );
  assert.throws(
    () => normalizeConfig({ chats: [{ chat_id: "@daily", actions: [{ action: 4 }] }] }),
    /第一个动作必须发送文本或骰子/,
  );
});

test("configs are persisted below the selected workdir", async () => {
  const workdir = await fs.mkdtemp(path.join(os.tmpdir(), "tg-signer-"));
  const value = {
    chats: [{ chat_id: -100, actions: [{ action: 1, text: "签到" }] }],
  };
  await writeConfig("morning", value, workdir);
  assert.deepEqual(await listConfigs(workdir), ["morning"]);
  assert.equal((await readConfig("morning", workdir)).chats[0].chat_id, -100);
});
