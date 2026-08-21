import fs from "node:fs/promises";
import path from "node:path";
import { TelegramClient } from "teleproto";
import { StringSession } from "teleproto/sessions/index.js";

const TRANSIENT_STATES = new Set(["connecting", "verifying"]);

export class TelegramLoginManager {
  constructor({ workdir, envProvider = () => process.env, clientFactory, transitionTimeout = 30_000 } = {}) {
    this.workdir = workdir || ".signer";
    this.envProvider = envProvider;
    this.clientFactory = clientFactory || defaultClientFactory;
    this.transitionTimeout = transitionTimeout;
    this.sessionFile = path.join(this.workdir, "session.txt");
    this.profileFile = path.join(this.workdir, "telegram-profile.json");
    this.state = { status: "idle", message: "尚未开始登录", hint: "", delivery: "" };
    this.pending = null;
    this.flowPromise = null;
    this.client = null;
    this.cancelled = false;
    this.listeners = new Set();
  }

  async status() {
    const [sessionFile, profile] = await Promise.all([fileExists(this.sessionFile), readJson(this.profileFile)]);
    const env = this.envProvider();
    return {
      ...this.state,
      configured: Boolean(env.TG_SESSION_STRING || sessionFile),
      sessionSource: env.TG_SESSION_STRING ? "environment" : sessionFile ? "file" : "none",
      profile,
    };
  }

  async start(phoneNumber) {
    if (this.flowPromise) throw new Error("已有 Telegram 登录流程正在进行");
    const phone = String(phoneNumber || "").replace(/[\s()-]/g, "");
    if (!/^\+\d{6,15}$/.test(phone)) throw new Error("手机号必须包含国家区号，例如 +8613800138000");
    const env = this.envProvider();
    const apiId = Number(env.TG_API_ID);
    if (!Number.isSafeInteger(apiId) || apiId <= 0 || !env.TG_API_HASH) {
      throw new Error("请先在运行设置中配置 TG_API_ID 和 TG_API_HASH");
    }

    this.cancelled = false;
    this.setState({ status: "connecting", message: "正在连接 Telegram…", hint: "", delivery: "" });
    this.client = this.clientFactory("", apiId, env.TG_API_HASH);
    this.flowPromise = this.run(phone).finally(() => { this.flowPromise = null; });
    await this.waitForStableState();
    return this.status();
  }

  async submitCode(code) {
    return this.submit("code", code, "验证码不能为空");
  }

  async submitPassword(password) {
    return this.submit("password", password, "两步验证密码不能为空");
  }

  async submit(type, value, emptyMessage) {
    const normalized = String(value || "").trim();
    if (!normalized) throw new Error(emptyMessage);
    if (!this.pending || this.pending.type !== type) throw new Error("当前登录步骤不接受此输入");
    const pending = this.pending;
    this.pending = null;
    this.setState({ ...this.state, status: "verifying", message: type === "code" ? "正在验证验证码…" : "正在验证两步密码…" });
    pending.resolve(normalized);
    await this.waitForStableState();
    return this.status();
  }

  async cancel() {
    if (!this.flowPromise) {
      this.setState({ status: "idle", message: "登录已取消", hint: "", delivery: "" });
      return this.status();
    }
    this.cancelled = true;
    if (this.pending) {
      this.pending.reject(new Error("AUTH_USER_CANCEL"));
      this.pending = null;
    }
    await this.flowPromise;
    return this.status();
  }

  async logout() {
    if (this.flowPromise) await this.cancel();
    const env = this.envProvider();
    const session = env.TG_SESSION_STRING || await readText(this.sessionFile);
    const apiId = Number(env.TG_API_ID);
    if (session && apiId && env.TG_API_HASH) {
      const client = this.clientFactory(session, apiId, env.TG_API_HASH);
      try {
        await client.connect();
        if (await client.checkAuthorization()) await client.logOut();
      } finally {
        await client.disconnect().catch(() => {});
      }
    }
    await Promise.all([
      fs.rm(this.sessionFile, { force: true }),
      fs.rm(this.profileFile, { force: true }),
    ]);
    this.setState({ status: "idle", message: env.TG_SESSION_STRING ? "已远程退出；请同时删除环境变量 TG_SESSION_STRING" : "Telegram 会话已退出", hint: "", delivery: "" });
    return this.status();
  }

  async run(phoneNumber) {
    let lastError = "";
    try {
      await this.client.start({
        phoneNumber,
        phoneCode: (isCodeViaApp) => this.requestInput("code", {
          status: "waiting_code",
          message: lastError || "验证码已发送，请输入验证码",
          delivery: isCodeViaApp ? "Telegram 应用" : "短信或其他方式",
          hint: "",
        }),
        password: (hint) => this.requestInput("password", {
          status: "waiting_password",
          message: lastError || "账号启用了两步验证，请输入密码",
          delivery: "",
          hint: hint || "",
        }),
        onError: (error) => {
          lastError = friendlyTelegramError(error);
          return this.cancelled;
        },
      });
      const profile = await this.client.getMe();
      await fs.mkdir(this.workdir, { recursive: true });
      await fs.writeFile(this.sessionFile, this.client.session.save(), { encoding: "utf8", mode: 0o600 });
      await fs.writeFile(this.profileFile, `${JSON.stringify(publicProfile(profile), null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      this.setState({ status: "authorized", message: "Telegram 登录成功", hint: "", delivery: "" });
    } catch (error) {
      this.setState(this.cancelled
        ? { status: "idle", message: "登录已取消", hint: "", delivery: "" }
        : { status: "error", message: friendlyTelegramError(error), hint: "", delivery: "" });
    } finally {
      if (this.pending) {
        this.pending.reject(new Error("登录流程已结束"));
        this.pending = null;
      }
      if (this.client) await this.client.disconnect().catch(() => {});
      this.client = null;
    }
  }

  requestInput(type, state) {
    this.setState(state);
    return new Promise((resolve, reject) => { this.pending = { type, resolve, reject }; });
  }

  setState(state) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }

  async waitForStableState() {
    if (!TRANSIENT_STATES.has(this.state.status)) return;
    await new Promise((resolve) => {
      const finish = () => {
        if (TRANSIENT_STATES.has(this.state.status)) return;
        clearTimeout(timer);
        this.listeners.delete(finish);
        resolve();
      };
      const timer = setTimeout(() => {
        this.listeners.delete(finish);
        resolve();
      }, this.transitionTimeout);
      this.listeners.add(finish);
    });
  }
}

function defaultClientFactory(session, apiId, apiHash) {
  return new TelegramClient(new StringSession(session), apiId, apiHash, { connectionRetries: 3 });
}

function publicProfile(profile) {
  if (!profile) return null;
  return {
    id: profile.id == null ? null : String(profile.id),
    username: profile.username || "",
    firstName: profile.firstName || "",
    lastName: profile.lastName || "",
  };
}

function friendlyTelegramError(error) {
  const code = error?.errorMessage || error?.message || String(error);
  const known = {
    PHONE_CODE_INVALID: "验证码错误，请重新输入",
    PHONE_CODE_EXPIRED: "验证码已过期，请重新开始登录",
    PASSWORD_HASH_INVALID: "两步验证密码错误，请重新输入",
    PHONE_NUMBER_INVALID: "手机号无效",
    PHONE_NUMBER_BANNED: "该手机号已被 Telegram 限制",
    AUTH_USER_CANCEL: "登录已取消",
  };
  return known[code] || code;
}

async function fileExists(file) {
  try { await fs.access(file); return true; }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); }
  catch (error) { if (error.code === "ENOENT" || error instanceof SyntaxError) return null; throw error; }
}

async function readText(file) {
  try { return await fs.readFile(file, "utf8"); }
  catch (error) { if (error.code === "ENOENT") return ""; throw error; }
}
