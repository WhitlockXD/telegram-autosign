import fs from "node:fs/promises";
import path from "node:path";
import cron from "node-cron";

export const DEFAULT_WORKDIR = process.env.TG_WORKDIR || ".signer";

const configRoot = (workdir) => path.join(workdir, "signs");
const configPath = (workdir, name) => path.join(configRoot(workdir), name, "config.json");

export function validateTaskName(name) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(name)) {
    throw new Error("任务名称只能包含字母、数字、下划线和短横线");
  }
  return name;
}

export function normalizeConfig(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.chats) || raw.chats.length === 0) {
    throw new Error("配置至少需要一个 chats 项");
  }
  const chats = raw.chats.map((chat, index) => {
    if (!chat || (typeof chat.chat_id !== "number" && typeof chat.chat_id !== "string") || String(chat.chat_id).trim() === "") {
      throw new Error(`第 ${index + 1} 个聊天缺少 chat_id`);
    }
    const rawChatId = typeof chat.chat_id === "string" ? chat.chat_id.trim() : chat.chat_id;
    const chatId = typeof rawChatId === "string" && /^-?\d+$/.test(rawChatId)
      ? Number(rawChatId)
      : rawChatId;
    if (typeof chatId === "number" && !Number.isSafeInteger(chatId)) {
      throw new Error(`第 ${index + 1} 个聊天的 chat_id 超出安全整数范围`);
    }
    if (!Array.isArray(chat.actions) || chat.actions.length === 0) {
      throw new Error(`第 ${index + 1} 个聊天至少需要一个动作`);
    }
    const actions = chat.actions.map((action) => {
      if (!action || !Number.isInteger(action.action) || action.action < 1 || action.action > 5) {
        throw new Error("动作编号必须是 1 到 5");
      }
      if ((action.action === 1 || action.action === 3) && typeof action.text !== "string") {
        throw new Error("文本动作必须填写 text");
      }
      if (action.action === 2 && typeof action.dice !== "string") {
        throw new Error("骰子动作必须填写 dice");
      }
      return { ...action };
    });
    if (![1, 2].includes(actions[0].action)) {
      throw new Error(`第 ${index + 1} 个聊天的第一个动作必须发送文本或骰子`);
    }
    const threadId = optionalNonNegativeInteger(chat.message_thread_id, "message_thread_id", index);
    const deleteAfter = optionalNonNegativeInteger(chat.delete_after, "delete_after", index);
    const actionInterval = nonNegativeNumber(chat.action_interval, 1, "action_interval", index);
    return {
      chat_id: chatId,
      message_thread_id: threadId,
      name: chat.name || null,
      delete_after: deleteAfter,
      actions,
      action_interval: actionInterval,
    };
  });
  const signAt = normalizeSchedule(raw.sign_at);
  if (!cron.validate(signAt)) throw new Error(`无效的 cron 表达式: ${signAt}`);
  return {
    chats,
    sign_at: signAt,
    random_seconds: nonNegativeNumber(raw.random_seconds, 0, "random_seconds"),
    sign_interval: nonNegativeNumber(raw.sign_interval, 1, "sign_interval"),
  };
}

function optionalNonNegativeInteger(value, field, chatIndex) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`第 ${chatIndex + 1} 个聊天的 ${field} 必须是非负整数`);
  }
  return parsed;
}

function nonNegativeNumber(value, fallback, field, chatIndex = null) {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    const prefix = chatIndex == null ? "" : `第 ${chatIndex + 1} 个聊天的 `;
    throw new Error(`${prefix}${field} 必须是非负数`);
  }
  return parsed;
}

function normalizeSchedule(value) {
  if (typeof value !== "string" || !value.trim()) return "0 6 * * *";
  const schedule = value.trim();
  const time = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(schedule);
  if (!time) return schedule;
  const hour = Number(time[1]);
  const minute = Number(time[2]);
  if (hour > 23 || minute > 59) throw new Error(`无效的签到时间: ${schedule}`);
  return `${minute} ${hour} * * *`;
}

export async function listConfigs(workdir = DEFAULT_WORKDIR) {
  try {
    const entries = await fs.readdir(configRoot(workdir), { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

export async function readConfig(name, workdir = DEFAULT_WORKDIR) {
  validateTaskName(name);
  const raw = JSON.parse(await fs.readFile(configPath(workdir, name), "utf8"));
  return normalizeConfig(raw);
}

export async function writeConfig(name, raw, workdir = DEFAULT_WORKDIR) {
  validateTaskName(name);
  const config = normalizeConfig(raw);
  const file = configPath(workdir, name);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  await fs.rename(temporary, file);
  return config;
}

export async function deleteConfig(name, workdir = DEFAULT_WORKDIR) {
  validateTaskName(name);
  await fs.rm(path.join(configRoot(workdir), name), { recursive: true, force: false });
}
