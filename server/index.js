import "dotenv/config";
import express from "express";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { DEFAULT_WORKDIR, deleteConfig, listConfigs, readConfig, writeConfig } from "./config.js";
import { CheckinRunner } from "./checkin.js";
import { CheckinScheduler } from "./scheduler.js";
import { RunHistory } from "./history.js";
import { assertPublicAuth, createAuthMiddleware, warnIfPubliclyExposed } from "./auth.js";
import { helmetOptions } from "./security.js";
import { SettingsStore } from "./settings.js";
import { TelegramLoginManager } from "./telegram-auth.js";
import { createAiClient, parseImageDataUrl, recognizeOptionByImage } from "./ai.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 8000);
const host = process.env.HOST || "0.0.0.0";
const authToken = process.env.TG_AUTH_TOKEN || process.env.AUTH_TOKEN || "";
const tlsCertFile = process.env.TLS_CERT_FILE || "";
const tlsKeyFile = process.env.TLS_KEY_FILE || "";
if (Boolean(tlsCertFile) !== Boolean(tlsKeyFile)) {
  throw new Error("TLS_CERT_FILE 和 TLS_KEY_FILE 必须同时配置");
}
const tlsEnabled = Boolean(tlsCertFile && tlsKeyFile);
assertPublicAuth(host, authToken);
warnIfPubliclyExposed(host, authToken, tlsEnabled);
const workdir = process.env.TG_WORKDIR || DEFAULT_WORKDIR;
const settings = await SettingsStore.load(workdir);
const runtimeEnv = () => settings.env();
const runner = new CheckinRunner({ workdir, env: runtimeEnv, logger: (line) => console.log(line) });
const history = new RunHistory(workdir);
const telegramLogin = new TelegramLoginManager({ workdir, envProvider: runtimeEnv });
let lastRun = (await history.list(1))[0] || null;
const recordResult = async (result) => {
  lastRun = result;
  await history.add(result);
};
const scheduler = new CheckinScheduler({
  runner,
  loadConfig: (name) => readConfig(name, workdir),
  listConfigs: () => listConfigs(workdir),
  onResult: recordResult,
  timezoneProvider: () => runtimeEnv().TZ,
});

app.use(helmet(helmetOptions(tlsEnabled)));
app.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: "draft-8", legacyHeaders: false }));
app.use(createAuthMiddleware(authToken));
app.use(express.json({ limit: "8mb" }));
app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/api/health", (_req, res) => res.json({ ok: true, running: runner.running, lastRun }));
app.get("/api/overview", asyncHandler(async (_req, res) => {
  const [configs, telegram] = await Promise.all([listConfigs(workdir), telegramLogin.status()]);
  const runtimeSettings = settings.publicView();
  res.json({
    service: {
      ok: true,
      running: runner.running,
      taskCount: configs.length,
      scheduledCount: scheduler.jobs.size,
      timezone: runtimeSettings.timezone || "系统默认",
      workdir,
    },
    telegram,
    openai: runtimeSettings.openai,
    lastRun,
  });
}));
app.get("/api/runs", asyncHandler(async (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  res.json({ runs: await history.list(limit) });
}));
app.get("/api/settings", (_req, res) => res.json(settings.publicView()));
app.put("/api/settings", asyncHandler(async (req, res) => {
  const updated = await settings.update(req.body);
  await scheduler.reloadAll();
  res.json(updated);
}));
app.post("/api/ai/test-image", asyncHandler(async (req, res) => {
  const input = req.body?.openai || {};
  const env = { ...runtimeEnv() };
  if (input.clearApiKey) env.OPENAI_API_KEY = "";
  else if (typeof input.apiKey === "string" && input.apiKey.trim()) env.OPENAI_API_KEY = input.apiKey.trim();
  if (input.baseUrl !== undefined) env.OPENAI_BASE_URL = String(input.baseUrl).trim();
  if (input.model !== undefined) env.OPENAI_MODEL = String(input.model).trim() || "gpt-4o";
  if (!env.OPENAI_API_KEY) throw new Error("请先填写或保存 OPENAI_API_KEY");

  const query = String(req.body?.query || "选择正确的选项").trim().slice(0, 1000);
  const options = Array.isArray(req.body?.options)
    ? req.body.options.map((item) => String(item).trim()).filter(Boolean)
    : [];
  if (options.length < 2 || options.length > 20) throw new Error("测试选项数量必须在 2 到 20 之间");
  if (options.some((item) => item.length > 200)) throw new Error("每个测试选项不能超过 200 个字");
  const { buffer, mediaType } = parseImageDataUrl(req.body?.image);
  const model = env.OPENAI_MODEL || "gpt-4o";
  const result = await recognizeOptionByImage(createAiClient(env), buffer, query, options, model, mediaType);
  res.json({ ok: true, model, ...result });
}));
app.get("/api/telegram/status", asyncHandler(async (_req, res) => res.json(await telegramLogin.status())));
app.post("/api/telegram/login/start", asyncHandler(async (req, res) => res.json(await telegramLogin.start(req.body.phoneNumber))));
app.post("/api/telegram/login/code", asyncHandler(async (req, res) => res.json(await telegramLogin.submitCode(req.body.code))));
app.post("/api/telegram/login/password", asyncHandler(async (req, res) => res.json(await telegramLogin.submitPassword(req.body.password))));
app.post("/api/telegram/login/cancel", asyncHandler(async (_req, res) => res.json(await telegramLogin.cancel())));
app.post("/api/telegram/logout", asyncHandler(async (_req, res) => {
  if (runner.running) return res.status(409).json({ error: "签到任务运行时不能退出 Telegram" });
  res.json(await telegramLogin.logout());
}));
app.get("/api/configs", asyncHandler(async (_req, res) => res.json({ configs: await listConfigs(workdir) })));
app.get("/api/configs/:name", asyncHandler(async (req, res) => res.json(await readConfig(req.params.name, workdir))));
app.put("/api/configs/:name", asyncHandler(async (req, res) => {
  const config = await writeConfig(req.params.name, req.body, workdir);
  await scheduler.reload(req.params.name);
  res.json(config);
}));
app.delete("/api/configs/:name", asyncHandler(async (req, res) => {
  scheduler.remove(req.params.name);
  await deleteConfig(req.params.name, workdir);
  res.status(204).end();
}));
app.post("/api/configs/:name/run-once", asyncHandler(async (req, res) => {
  const config = await readConfig(req.params.name, workdir);
  if (runner.running) return res.status(409).json({ error: "已有签到任务正在运行" });
  res.status(202).json({ accepted: true, task: req.params.name });
  runner.run(config).then((result) => recordResult({ task: req.params.name, source: "manual", ...result })).catch((error) => {
    const failed = { task: req.params.name, source: "manual", error: error.message, finishedAt: new Date().toISOString() };
    recordResult(failed).catch(console.error);
    console.error(error);
  });
}));

app.use((error, _req, res, _next) => {
  const status = error.code === "ENOENT" ? 404 : 400;
  res.status(status).json({ error: error.message });
});
app.get("/{*splat}", (_req, res) => res.sendFile(path.join(__dirname, "..", "public", "index.html")));
await scheduler.loadAll();
const server = tlsEnabled
  ? https.createServer({ cert: fs.readFileSync(tlsCertFile), key: fs.readFileSync(tlsKeyFile) }, app)
  : http.createServer(app);
server.listen(port, host, () => {
  const protocol = tlsEnabled ? "https" : "http";
  console.log(`tg-signer Node service listening on ${protocol}://${host}:${port}`);
});
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => {
  scheduler.stop();
  server.close(() => process.exit(0));
});

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}
