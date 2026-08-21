import test from "node:test";
import assert from "node:assert/strict";
import { CheckinRunner } from "../server/checkin.js";

test("check-in flow sends text then clicks the matching button", async () => {
  const calls = [];
  const message = {
    id: 11,
    buttons: [[{ text: "完成签到" }, { text: "取消" }]],
    click: async (options) => calls.push(["click", options]),
  };
  const runner = new CheckinRunner({ env: {} });
  runner.client = {
    sendMessage: async (chatId, options) => {
      calls.push(["send", chatId, options]);
      return { id: 10 };
    },
  };
  runner.waitForResponse = async (_chatId, afterMessage) => {
    calls.push(["wait", afterMessage.id]);
    return { message };
  };

  await runner.runChat({
    chat_id: "@daily",
    message_thread_id: null,
    delete_after: null,
    action_interval: 0,
    actions: [{ action: 1, text: "签到" }, { action: 3, text: "完成" }],
  });

  assert.deepEqual(calls[0], ["send", "@daily", { message: "签到", replyTo: undefined }]);
  assert.deepEqual(calls[1], ["wait", 10]);
  assert.deepEqual(calls[2], ["click", { i: 0 }]);
});

test("subsequent response actions advance the message cursor", async () => {
  const cursors = [];
  const runner = new CheckinRunner({ env: {} });
  runner.client = { sendMessage: async () => ({ id: 10 }) };
  runner.clickButton = async () => {};
  runner.solveCalculation = async () => {};
  runner.waitForResponse = async (_chatId, afterMessage) => {
    cursors.push(afterMessage.id);
    return { message: { id: afterMessage.id + 1 } };
  };
  await runner.runChat({
    chat_id: 123,
    delete_after: null,
    action_interval: 0,
    actions: [{ action: 1, text: "签到" }, { action: 3, text: "继续" }, { action: 5 }],
  });
  assert.deepEqual(cursors, [10, 11]);
});

test("response polling accepts an edited message with the same id", async () => {
  const runner = new CheckinRunner({ env: {} });
  const previous = { id: 20, message: "请选择", buttons: [[{ text: "下一步" }]] };
  const edited = { id: 20, message: "请选择图片答案", photo: { id: 9 }, buttons: [[{ text: "A" }]] };
  runner.client = { getMessages: async () => [edited] };
  const result = await runner.waitForResponse("@daily", previous, null, 4, true);
  assert.equal(result.message, edited);
  assert.equal(result.photoMessage, edited);
});

test("image check-in uses the WebUI model and clicks the recognized button", async () => {
  let request;
  let clicked;
  const runner = new CheckinRunner({ env: () => ({ OPENAI_MODEL: "saved-vision-model" }) });
  runner.ai = {
    chat: { completions: { create: async (value) => {
      request = value;
      return { choices: [{ message: { content: '{"option":1}' } }] };
    } } },
  };
  runner.client = { downloadMedia: async () => Buffer.from([0xff, 0xd8, 0xff, 0xdb]) };
  const message = {
    message: "图中是哪个字母？",
    buttons: [[{ text: "A" }], [{ text: "B" }]],
    click: async (options) => { clicked = options; },
  };
  await runner.chooseImage(message, { photo: { id: 9 } });
  assert.equal(request.model, "saved-vision-model");
  assert.deepEqual(clicked, { i: 1 });
});
