# Telegram 签到服务

这是一个只保留 Telegram 签到能力的 Node.js 服务，支持文本、骰子、键盘点击、AI 图片选项识别和 AI 计算题。Telegram 登录、运行设置、签到任务、立即运行和历史记录均可在 Web 控制台中完成。

## 直接运行

要求 Node.js 20 或更高版本。服务启动时会自动检查 `package.json` 中的生产依赖；如果 `node_modules` 缺少依赖，会先执行 `npm install --omit=dev`，安装失败则不会启动服务。

```bash
cp .env.example .env
# 编辑 .env；公网监听至少填写 TG_AUTH_TOKEN
node bootstrap.js
```

`npm start` 执行的是同一条 Node 命令。Node 进程会直接提供 Web 页面和 API，不需要 Nginx、Caddy、Docker 或 Python 运行环境。默认监听 `0.0.0.0:8000`，启动后可以直接打开：

```text
http://公网IP:8000
```

服务器安全组或系统防火墙需要放行 TCP 8000 端口。公开监听强制要求在 `.env` 中设置一个足够长的密码，否则服务会拒绝启动：

```dotenv
TG_AUTH_TOKEN=replace_with_a_long_random_token
```

变量名应为 `TG_AUTH_TOKEN`；同时兼容 `AUTH_TOKEN`。浏览器访问时用户名可任意填写，密码填写配置的 Token。如需 HTTPS，可选配 `TLS_CERT_FILE` 和 `TLS_KEY_FILE`，由 Node 直接加载证书。

修改 `.env` 后必须重启 Node 进程。未认证访问会返回 HTTP `401`，浏览器会自动弹出用户名和密码输入框。

### systemd 后台运行

将项目放在 `/opt/tg-signer`，按实际账号修改 `deploy/tg-signer.service.example` 的 `User`、`Group` 和路径，然后安装服务：

```bash
sudo cp deploy/tg-signer.service.example /etc/systemd/system/tg-signer.service
sudo systemctl daemon-reload
sudo systemctl enable --now tg-signer
sudo systemctl status tg-signer
```

每次 systemd 启动仍会经过 bootstrap 环境检测；缺少 npm 生产依赖时会自动安装。

### 环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `TG_API_ID` | Telegram 必填 | Telegram API ID；也可以在 WebUI“运行设置”中配置 |
| `TG_API_HASH` | Telegram 必填 | Telegram API Hash；也可以在 WebUI“运行设置”中配置 |
| `TG_SESSION_STRING` | 否 | 已授权账号的 GramJS session string；不配置时可直接在 WebUI 登录 |
| `TG_WORKDIR` | 否 | 配置目录，默认 `.signer` |
| `HOST` | 否 | 监听地址，默认 `0.0.0.0`，允许通过服务器 IP 访问 |
| `PORT` | 否 | 监听端口，默认 `8000` |
| `TG_AUTH_TOKEN` | 公网监听必填 | Web/API 密码；访问时用户名任意，密码填该值；兼容 `AUTH_TOKEN` |
| `TLS_CERT_FILE` | 否 | 可选 Node HTTPS 证书文件（PEM），必须和私钥同时配置 |
| `TLS_KEY_FILE` | 否 | 可选 Node HTTPS 私钥文件（PEM），必须和证书同时配置 |
| `OPENAI_API_KEY` | AI 动作必填 | 图片识别和计算题使用 |
| `OPENAI_BASE_URL` | 否 | OpenAI 兼容服务地址 |
| `OPENAI_MODEL` | 否 | 默认 `gpt-4o` |
| `TZ` | 否 | 定时任务时区，例如 `Asia/Shanghai` |

Telegram session 必须属于有权访问目标聊天的账号。session string 属于敏感信息，不要提交到 Git。WebUI 保存的运行设置位于 `<TG_WORKDIR>/settings.json`，登录生成的 session 位于 `<TG_WORKDIR>/session.txt`，两者均不应提交到版本库。

当 `HOST` 不是本机回环地址时，未配置 `TG_AUTH_TOKEN`（或兼容变量 `AUTH_TOKEN`）会直接启动失败，避免 Web/API 无密码暴露。

## Web 控制台和 API

启动后打开 `http://公网IP:8000`。控制台包含以下工作区：

- **总览**：服务、账号、任务调度、AI 和最近运行状态
- **Telegram 账号**：手机号、验证码、两步验证密码的分步登录，以及退出账号
- **签到任务**：可视化配置聊天和动作流，保存、删除或立即运行
- **运行记录**：查看手动与定时任务的聊天级结果和错误
- **运行设置**：配置 Telegram API、OpenAI 兼容接口和调度时区；页面会自动生成一张 PNG 测试图，使用当前填写的 Base URL、API Key 和模型验证视觉识别

签到配置保存到 `TG_WORKDIR/signs/<任务名>/config.json`。如果仍需在终端登录，可运行 `npm run login`，CLI 与 WebUI 共用同一登录服务和 session 文件。

### API

- `GET /api/health`：服务和最近运行结果
- `GET /api/overview`：控制台总览数据
- `GET /api/runs`：最近 20 次手动或定时运行记录
- `GET /api/settings`、`PUT /api/settings`：读取和保存运行设置（密钥只返回是否已配置）
- `POST /api/ai/test-image`：使用上传的样例图和按钮选项真实测试 AI 图片识别
- `GET /api/telegram/status`：Telegram 登录与 session 状态
- `POST /api/telegram/login/start`：提交手机号并开始登录
- `POST /api/telegram/login/code`：提交验证码
- `POST /api/telegram/login/password`：提交两步验证密码
- `POST /api/telegram/login/cancel`：取消当前登录流程
- `POST /api/telegram/logout`：退出并删除本地 session
- `GET /api/configs`：列出签到任务
- `GET /api/configs/:name`：读取任务配置
- `PUT /api/configs/:name`：校验并保存任务配置
- `DELETE /api/configs/:name`：删除任务配置
- `POST /api/configs/:name/run-once`：立即运行一次签到，返回 `202`

## 配置示例

```json
{
  "sign_at": "0 6 * * *",
  "random_seconds": 30,
  "sign_interval": 1,
  "chats": [
    {
      "chat_id": "@example",
      "message_thread_id": null,
      "delete_after": null,
      "action_interval": 1,
      "actions": [
        { "action": 1, "text": "签到" },
        { "action": 3, "text": "完成签到" }
      ]
    }
  ]
}
```

动作编号：`1` 发送文本，`2` 发送骰子，`3` 按文本点击按钮，`4` 使用 OpenAI 图片识别选择按钮，`5` 使用 OpenAI 解答计算题。AI 动作需要网络访问 OpenAI 兼容接口；未配置 AI 时，普通签到仍可运行。

## 开发检查

```bash
npm install
npm run lint
npm test
```

旧版 Python、monitor、automation 和 Docker 文件不再是运行入口；保留在 Git 历史中仅用于迁移已有配置和 session。
