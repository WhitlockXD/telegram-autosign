import fs from "node:fs/promises";
import path from "node:path";
import { Api, TelegramClient } from "teleproto";
import { StringSession } from "teleproto/sessions/index.js";
import { createAiClient, chooseOptionByImage, solveText } from "./ai.js";

const ACTION = { TEXT: 1, DICE: 2, CLICK: 3, IMAGE: 4, CALC: 5 };
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class CheckinRunner {
  constructor({ workdir, env = process.env, logger = () => {} } = {}) {
    const initialEnv = typeof env === "function" ? env() : env;
    this.workdir = workdir || initialEnv.TG_WORKDIR || ".signer";
    this.env = env;
    this.logger = logger;
    this.ai = null;
    this.client = null;
    this.running = false;
  }

  async connect() {
    const env = this.currentEnv();
    const apiId = Number(env.TG_API_ID);
    if (!apiId || !env.TG_API_HASH) throw new Error("必须配置 TG_API_ID 和 TG_API_HASH");
    const session = new StringSession(env.TG_SESSION_STRING || await this.loadSession());
    this.client = new TelegramClient(session, apiId, env.TG_API_HASH, { connectionRetries: 3 });
    await this.client.connect();
    if (!(await this.client.checkAuthorization())) throw new Error("Telegram 未授权，请设置 TG_SESSION_STRING");
  }

  async loadSession() {
    try { return await fs.readFile(path.join(this.workdir, "session.txt"), "utf8"); }
    catch (error) { if (error.code === "ENOENT") return ""; throw error; }
  }

  async run(config) {
    if (this.running) throw new Error("已有签到任务正在运行");
    this.running = true;
    const startedAt = new Date().toISOString();
    try {
      this.ai = createAiClient(this.currentEnv());
      if (!this.client) await this.connect();
      const results = [];
      for (const chat of config.chats) {
        try {
          await this.runChat(chat);
          results.push({ chat_id: chat.chat_id, ok: true });
        } catch (error) {
          this.logger(`签到失败 ${chat.chat_id}: ${error.message}`);
          results.push({ chat_id: chat.chat_id, ok: false, error: error.message });
        }
        await delay(config.sign_interval * 1000);
      }
      return { startedAt, finishedAt: new Date().toISOString(), results };
    } finally {
      this.running = false;
      if (this.client) { await this.client.disconnect(); this.client = null; }
    }
  }

  currentEnv() {
    return typeof this.env === "function" ? this.env() : this.env;
  }

  async runChat(chat) {
    let lastMessage = null;
    let acceptEditedMessage = false;
    for (const action of chat.actions) {
      if (action.action === ACTION.TEXT) {
        lastMessage = await this.client.sendMessage(chat.chat_id, { message: action.text, replyTo: chat.message_thread_id || undefined });
        acceptEditedMessage = false;
      } else if (action.action === ACTION.DICE) {
        lastMessage = await this.client.sendFile(chat.chat_id, {
          file: new Api.InputMediaDice({ emoticon: action.dice }),
          replyTo: chat.message_thread_id || undefined,
        });
        acceptEditedMessage = false;
      } else {
        const response = await this.waitForResponse(
          chat.chat_id,
          lastMessage,
          chat.message_thread_id,
          action.action,
          acceptEditedMessage,
        );
        if (!response) throw new Error("等待签到回复超时");
        if (action.action === ACTION.CLICK) await this.clickButton(response.message, action.text);
        if (action.action === ACTION.IMAGE) await this.chooseImage(response.message, response.photoMessage);
        if (action.action === ACTION.CALC) await this.solveCalculation(response.message);
        lastMessage = response.message;
        acceptEditedMessage = true;
      }
      if ((action.action === ACTION.TEXT || action.action === ACTION.DICE) && chat.delete_after != null && lastMessage?.id) {
        if (chat.delete_after > 0) await delay(chat.delete_after * 1000);
        await this.client.deleteMessages(chat.chat_id, [lastMessage.id]);
      }
      await delay(chat.action_interval * 1000);
    }
  }

  async waitForResponse(chatId, afterMessage, threadId, actionType, acceptEditedMessage = false) {
    const deadline = Date.now() + 15000;
    const afterId = Number(afterMessage?.id || 0);
    const previousFingerprint = messageFingerprint(afterMessage);
    while (Date.now() < deadline) {
      const minId = acceptEditedMessage ? Math.max(0, afterId - 1) : afterId;
      const messages = await this.client.getMessages(chatId, { limit: 10, minId });
      const afterCursor = messages.filter((item) => {
        if (Number(item.id) > afterId) return true;
        return acceptEditedMessage
          && Number(item.id) === afterId
          && messageFingerprint(item) !== previousFingerprint;
      });
      const inThread = afterCursor.filter((item) => !threadId || item.replyTo?.replyToTopId === threadId || item.replyTo?.replyToMsgId === threadId);
      const withButtons = inThread.find((item) => flattenButtons(item).length > 0);
      const withText = inThread.find((item) => item.message);
      if (actionType === ACTION.IMAGE && withButtons) {
        const photoMessage = withButtons.photo ? withButtons : inThread.find((item) => item.photo);
        if (photoMessage) return { message: withButtons, photoMessage };
      } else if (actionType === ACTION.CLICK && withButtons) {
        return { message: withButtons };
      } else if (actionType === ACTION.CALC && withText) {
        return { message: withText };
      }
      await delay(500);
    }
    return null;
  }

  async clickButton(message, text) {
    const buttons = flattenButtons(message);
    const button = buttons.find((item) => item.text?.includes(text));
    if (!button) throw new Error(`未找到按钮: ${text}`);
    await message.click({ i: button.index });
  }

  async chooseImage(message, photoMessage = message) {
    const buttons = flattenButtons(message);
    if (!buttons.length || !photoMessage?.photo) throw new Error("签到回复缺少图片或选项按钮");
    const buffer = await this.client.downloadMedia(photoMessage, {});
    if (!buffer) throw new Error("下载签到图片失败");
    const query = message.message || photoMessage.message || "选择正确的选项";
    const model = this.currentEnv().OPENAI_MODEL || "gpt-4o";
    this.logger(`正在使用 ${model} 识别签到图片...`);
    const index = await chooseOptionByImage(this.ai, Buffer.from(buffer), query, buttons.map((item) => item.text), model);
    this.logger(`AI 图片识别选择: ${buttons[index].text} (模型 ${model})`);
    await message.click({ i: buttons[index].index });
  }

  async solveCalculation(message) {
    const buttons = flattenButtons(message);
    const options = buttons.map((item) => item.text);
    const query = options.length
      ? `${message.message || ""}\n可选答案：${JSON.stringify(options)}\n只回复其中一个选项的原文。`
      : message.message || "";
    const answer = await solveText(this.ai, query, this.currentEnv().OPENAI_MODEL || "gpt-4o");
    const button = buttons.find((item) => item.text?.replace(/\s/g, "") === answer.replace(/\s/g, ""));
    if (button) return message.click({ i: button.index });
    await this.client.sendMessage(message.chatId, { message: answer, replyTo: message.id });
  }
}

function flattenButtons(message) {
  return (message.buttons || []).flatMap((row) => row).map((button, index) => ({ button, index, text: button.text }));
}

function messageFingerprint(message) {
  if (!message) return "";
  const photoId = message.photo?.id == null ? "" : String(message.photo.id);
  return JSON.stringify([message.message || "", photoId, flattenButtons(message).map((item) => item.text)]);
}
