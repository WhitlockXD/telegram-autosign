import OpenAI from "openai";

const MAX_TEST_IMAGE_BYTES = 5 * 1024 * 1024;

export function createAiClient(env = process.env) {
  if (!env.OPENAI_API_KEY) return null;
  return new OpenAI({
    apiKey: env.OPENAI_API_KEY,
    baseURL: env.OPENAI_BASE_URL || undefined,
    timeout: 60_000,
    maxRetries: 1,
  });
}

export async function recognizeOptionByImage(
  client,
  image,
  query,
  options,
  model = process.env.OPENAI_MODEL || "gpt-4o",
  mediaType = detectImageMediaType(image),
) {
  if (!client) throw new Error("使用 AI 图片识别前必须配置 OPENAI_API_KEY");
  if (!Array.isArray(options) || options.length < 2) throw new Error("图片识别至少需要 2 个选项");
  const buffer = Buffer.isBuffer(image) ? image : Buffer.from(image || "");
  if (!buffer.length) throw new Error("待识别图片为空");
  if (!mediaType) throw new Error("仅支持 JPEG、PNG、WebP 或 GIF 图片");
  const request = {
    model,
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "你是图片选择题助手。必须观察图片并从给定选项中选出唯一答案。只返回 JSON：{\"option\": 0, \"reason\": \"不超过30字\"}。option 从 0 开始。" },
      { role: "user", content: [
        { type: "text", text: `问题：${query || "选择正确选项"}\n选项（序号从 0 开始）：${JSON.stringify(options.map((text, index) => [index, text]))}` },
        { type: "image_url", image_url: { url: `data:${mediaType};base64,${buffer.toString("base64")}` } },
      ] },
    ],
  };
  let response;
  try {
    response = await client.chat.completions.create(request);
  } catch (error) {
    if (!unsupportedResponseFormat(error)) throw new Error(friendlyAiError(error), { cause: error });
    try {
      const { response_format: _ignored, ...compatibleRequest } = request;
      response = await client.chat.completions.create(compatibleRequest);
    } catch (retryError) {
      throw new Error(friendlyAiError(retryError), { cause: retryError });
    }
  }
  const parsed = parseJsonObject(response.choices[0]?.message?.content);
  const index = Number(parsed.option);
  if (!Number.isInteger(index) || index < 0 || index >= options.length) throw new Error("AI 返回的选项序号无效");
  return { index, option: String(options[index]), reason: String(parsed.reason || "").trim() };
}

export async function chooseOptionByImage(...args) {
  return (await recognizeOptionByImage(...args)).index;
}

export async function solveText(client, query, model = process.env.OPENAI_MODEL || "gpt-4o") {
  if (!client) throw new Error("使用 AI 计算前必须配置 OPENAI_API_KEY");
  let response;
  try {
    response = await client.chat.completions.create({
      model,
      temperature: 0.1,
      messages: [
        { role: "system", content: "你是签到答题助手。只返回答案，不要解释。" },
        { role: "user", content: query },
      ],
    });
  } catch (error) {
    throw new Error(friendlyAiError(error), { cause: error });
  }
  return response.choices[0]?.message?.content?.trim() || "";
}

export function parseImageDataUrl(value, maxBytes = MAX_TEST_IMAGE_BYTES) {
  const match = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/i.exec(String(value || ""));
  if (!match) throw new Error("请上传 JPEG、PNG、WebP 或 GIF 图片");
  const buffer = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (!buffer.length) throw new Error("待识别图片为空");
  if (buffer.length > maxBytes) throw new Error("测试图片不能超过 5 MB");
  const detected = detectImageMediaType(buffer);
  if (!detected) throw new Error("上传内容不是受支持的图片");
  return { buffer, mediaType: detected };
}

export function detectImageMediaType(image) {
  const buffer = Buffer.isBuffer(image) ? image : Buffer.from(image || "");
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (buffer.length >= 6 && ["GIF87a", "GIF89a"].includes(buffer.toString("ascii", 0, 6))) return "image/gif";
  return "";
}

function parseJsonObject(content) {
  const text = String(content || "").trim();
  const unfenced = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  try { return JSON.parse(unfenced); }
  catch (_error) {
    const match = unfenced.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); }
      catch (_nestedError) { /* handled below */ }
    }
    throw new Error("AI 未返回可解析的 JSON 识别结果");
  }
}

function friendlyAiError(error) {
  const status = Number(error?.status || error?.response?.status || 0);
  if (status === 401 || status === 403) return "AI 认证失败，请检查 API Key";
  if (status === 404) return "AI 接口或模型不存在，请检查 Base URL 和模型名";
  if (status === 429) return "AI 请求受限，请检查额度或稍后重试";
  return `AI 请求失败：${error?.message || "未知错误"}`;
}

function unsupportedResponseFormat(error) {
  return Number(error?.status || error?.response?.status || 0) === 400
    && /response[_ -]?format|json[_ -]?object|unsupported (?:field|parameter)/i.test(String(error?.message || ""));
}
