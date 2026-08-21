import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

function checkRuntime() {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 20) throw new Error(`Node.js 版本过低（当前 ${process.version}），需要 Node.js 20 或更高版本`);
}

function readManifest() {
  return JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
}

function dependencyInstalled(name) {
  try {
    require.resolve(name, { paths: [root] });
    return true;
  } catch (_error) {
    return false;
  }
}

function ensureDependencies() {
  if (process.env.TG_SIGNER_SKIP_INSTALL === "1") return;
  const manifest = readManifest();
  const missing = Object.keys(manifest.dependencies || {}).filter((name) => !dependencyInstalled(name));
  const dependencyTreeOk = missing.length === 0 && runNpm(["ls", "--omit=dev", "--depth=0", "--silent"], "ignore").status === 0;
  if (dependencyTreeOk) return;

  console.log(missing.length ? `检测到缺少依赖: ${missing.join(", ")}` : "检测到依赖版本或依赖树不完整");
  console.log("正在安装生产依赖，请稍候...");
  const result = runNpm(["install", "--omit=dev", "--no-audit", "--no-fund"], "inherit");
  if (result.error) throw new Error(`无法执行 npm install: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`npm install 失败，退出码: ${result.status}`);
}

function runNpm(args, stdio) {
  const windows = process.platform === "win32";
  const command = windows ? process.env.ComSpec || "cmd.exe" : "npm";
  const commandArgs = windows ? ["/d", "/s", "/c", `npm ${args.join(" ")}`] : args;
  return spawnSync(command, commandArgs, { cwd: root, stdio });
}

try {
  checkRuntime();
  ensureDependencies();
  await import(process.argv[2] === "login" ? "./login.js" : "./index.js");
} catch (error) {
  console.error(`启动失败: ${error.message}`);
  process.exitCode = 1;
}
