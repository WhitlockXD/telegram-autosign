import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SettingsStore } from "../server/settings.js";

test("runtime settings persist secrets without exposing them", async () => {
  const workdir = await fs.mkdtemp(path.join(os.tmpdir(), "tg-settings-"));
  const store = await SettingsStore.load(workdir, { OPENAI_MODEL: "base-model" });
  const view = await store.update({
    telegram: { apiId: 123456, apiHash: "api-hash" },
    openai: { apiKey: "openai-secret", baseUrl: "https://api.example.com/v1", model: "vision-model" },
    timezone: "Asia/Shanghai",
  });

  assert.equal(view.telegram.apiHashConfigured, true);
  assert.equal(view.openai.apiKeyConfigured, true);
  assert.equal(view.openai.apiKey, undefined);
  assert.equal(store.env().OPENAI_API_KEY, "openai-secret");

  const reloaded = await SettingsStore.load(workdir, {});
  assert.equal(reloaded.env().TG_API_ID, "123456");
  assert.equal(reloaded.publicView().openai.model, "vision-model");
});

test("runtime settings reject an invalid Telegram API ID", async () => {
  const workdir = await fs.mkdtemp(path.join(os.tmpdir(), "tg-settings-invalid-"));
  const store = await SettingsStore.load(workdir, {});
  await assert.rejects(() => store.update({ telegram: { apiId: "invalid" } }), /正整数/);
});
