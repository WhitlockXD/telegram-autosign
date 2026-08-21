import fs from "node:fs/promises";
import path from "node:path";

const STORED_KEYS = new Set([
  "TG_API_ID",
  "TG_API_HASH",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_MODEL",
  "TZ",
]);

export class SettingsStore {
  static async load(workdir, baseEnv = process.env) {
    const store = new SettingsStore(workdir, baseEnv);
    await store.reload();
    return store;
  }

  constructor(workdir, baseEnv = process.env) {
    this.file = path.join(workdir, "settings.json");
    this.baseEnv = baseEnv;
    this.values = {};
  }

  async reload() {
    try {
      const parsed = JSON.parse(await fs.readFile(this.file, "utf8"));
      this.values = Object.fromEntries(
        Object.entries(parsed).filter(([key, value]) => STORED_KEYS.has(key) && typeof value === "string"),
      );
    } catch (error) {
      if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
      this.values = {};
    }
    return this;
  }

  env() {
    return { ...this.baseEnv, ...this.values };
  }

  publicView() {
    const env = this.env();
    return {
      telegram: {
        apiId: env.TG_API_ID || "",
        apiHashConfigured: Boolean(env.TG_API_HASH),
        sessionFromEnvironment: Boolean(env.TG_SESSION_STRING),
      },
      openai: {
        apiKeyConfigured: Boolean(env.OPENAI_API_KEY),
        baseUrl: env.OPENAI_BASE_URL || "",
        model: env.OPENAI_MODEL || "gpt-4o",
      },
      timezone: env.TZ || "",
    };
  }

  async update(input = {}) {
    const telegram = input.telegram || {};
    const openai = input.openai || {};

    if (telegram.apiId !== undefined && telegram.apiId !== "") {
      const apiId = Number(telegram.apiId);
      if (!Number.isSafeInteger(apiId) || apiId <= 0) throw new Error("Telegram API ID 必须是正整数");
      this.values.TG_API_ID = String(apiId);
    }
    this.updateSecret("TG_API_HASH", telegram.apiHash, telegram.clearApiHash);
    this.updateSecret("OPENAI_API_KEY", openai.apiKey, openai.clearApiKey);
    this.updateString("OPENAI_BASE_URL", openai.baseUrl);
    this.updateString("OPENAI_MODEL", openai.model, "gpt-4o");
    this.updateString("TZ", input.timezone);

    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(this.values, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await fs.rename(temporary, this.file);
    return this.publicView();
  }

  updateSecret(key, value, clear) {
    if (clear) delete this.values[key];
    else if (typeof value === "string" && value.trim()) this.values[key] = value.trim();
  }

  updateString(key, value, fallback = "") {
    if (value === undefined) return;
    const normalized = String(value).trim();
    if (normalized || fallback) this.values[key] = normalized || fallback;
    else delete this.values[key];
  }
}
