import "dotenv/config";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { SettingsStore } from "./settings.js";
import { TelegramLoginManager } from "./telegram-auth.js";

const workdir = process.env.TG_WORKDIR || ".signer";
const settings = await SettingsStore.load(workdir);
const login = new TelegramLoginManager({ workdir, envProvider: () => settings.env() });
const prompt = readline.createInterface({ input, output });

try {
  let status = await login.start(await prompt.question("Telegram 手机号（含区号）: "));
  while (!["authorized", "error", "idle"].includes(status.status)) {
    if (status.status === "waiting_code") {
      status = await login.submitCode(await prompt.question(`验证码（来自${status.delivery || "Telegram"}）: `));
    } else if (status.status === "waiting_password") {
      status = await login.submitPassword(await prompt.question(`两步验证密码${status.hint ? `（提示：${status.hint}）` : ""}: `));
    }
  }
  if (status.status !== "authorized") throw new Error(status.message || "Telegram 登录失败");
  console.log(`登录成功，session 已保存到 ${workdir}/session.txt`);
} finally {
  prompt.close();
}
