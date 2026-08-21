import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { TelegramLoginManager } from "../server/telegram-auth.js";

test("Telegram login can complete code and two-step password in separate web requests", async () => {
  const workdir = await fs.mkdtemp(path.join(os.tmpdir(), "tg-login-"));
  const clients = [];
  const manager = new TelegramLoginManager({
    workdir,
    envProvider: () => ({ TG_API_ID: "123", TG_API_HASH: "hash" }),
    transitionTimeout: 500,
    clientFactory: (session) => {
      const client = new FakeTelegramClient(session);
      clients.push(client);
      return client;
    },
  });

  let status = await manager.start("+8613800138000");
  assert.equal(status.status, "waiting_code");
  assert.equal(status.delivery, "Telegram 应用");

  status = await manager.submitCode("12345");
  assert.equal(status.status, "waiting_password");
  assert.equal(status.hint, "pet name");

  status = await manager.submitPassword("two-step-secret");
  assert.equal(status.status, "authorized");
  assert.equal(status.configured, true);
  assert.equal(status.profile.username, "tester");
  assert.equal(await fs.readFile(path.join(workdir, "session.txt"), "utf8"), "saved-session");
  assert.equal(clients[0].disconnected, true);

  status = await manager.logout();
  assert.equal(status.configured, false);
});

test("Telegram web login requires configured API credentials", async () => {
  const manager = new TelegramLoginManager({ envProvider: () => ({}), transitionTimeout: 10 });
  await assert.rejects(() => manager.start("+8613800138000"), /TG_API_ID/);
});

class FakeTelegramClient {
  constructor(session) {
    this.savedSession = session;
    this.session = { save: () => "saved-session" };
    this.disconnected = false;
  }

  async start(options) {
    assert.equal(await options.phoneCode(true), "12345");
    assert.equal(await options.password("pet name"), "two-step-secret");
  }

  async getMe() {
    return { id: 42n, username: "tester", firstName: "Test", lastName: "User" };
  }

  async connect() {}
  async checkAuthorization() { return true; }
  async logOut() { this.loggedOut = true; }
  async disconnect() { this.disconnected = true; }
}
