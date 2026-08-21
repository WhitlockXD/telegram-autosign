import test from "node:test";
import assert from "node:assert/strict";
import { chooseOptionByImage, parseImageDataUrl, recognizeOptionByImage, solveText } from "../server/ai.js";

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xdb]);

test("AI image recognition returns the selected option index", async () => {
  let request;
  const client = {
    chat: { completions: { create: async (value) => {
      request = value;
      return { choices: [{ message: { content: '{"option":1}' } }] };
    } } },
  };
  const result = await chooseOptionByImage(client, jpeg, "哪一个？", ["A", "B"], "vision-model");
  assert.equal(result, 1);
  assert.equal(request.model, "vision-model");
  assert.match(request.messages[1].content[1].image_url.url, /^data:image\/jpeg;base64,/);
});

test("AI helpers reject missing configuration and invalid selections", async () => {
  await assert.rejects(() => solveText(null, "1+1"), /OPENAI_API_KEY/);
  const client = {
    chat: { completions: { create: async () => ({ choices: [{ message: { content: '{"option":9}' } }] }) } },
  };
  await assert.rejects(
    () => chooseOptionByImage(client, jpeg, "题目", ["A", "B"], "vision-model"),
    /选项序号无效/,
  );
});

test("AI recognition accepts fenced JSON and returns selection details", async () => {
  const client = {
    chat: { completions: { create: async () => ({ choices: [{ message: { content: '```json\n{"option":0,"reason":"图中显示 A"}\n```' } }] }) } },
  };
  const result = await recognizeOptionByImage(client, jpeg, "题目", ["A", "B"], "vision-model");
  assert.deepEqual(result, { index: 0, option: "A", reason: "图中显示 A" });
});

test("test image data URLs are validated and keep their real media type", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const result = parseImageDataUrl(`data:image/png;base64,${png.toString("base64")}`);
  assert.equal(result.mediaType, "image/png");
  assert.deepEqual(result.buffer, png);
  assert.throws(() => parseImageDataUrl("data:text/plain;base64,dGVzdA=="), /请上传/);
});

test("AI vision retries without response_format for compatible providers", async () => {
  const requests = [];
  const client = {
    chat: { completions: { create: async (request) => {
      requests.push(request);
      if (requests.length === 1) throw Object.assign(new Error("unsupported parameter: response_format"), { status: 400 });
      return { choices: [{ message: { content: '{"option":0}' } }] };
    } } },
  };
  assert.equal(await chooseOptionByImage(client, jpeg, "题目", ["A", "B"], "vision-model"), 0);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0].response_format, { type: "json_object" });
  assert.equal(requests[1].response_format, undefined);
});
