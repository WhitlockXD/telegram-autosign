const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const ACTIONS = [[1, "发送文本"], [2, "发送骰子"], [3, "点击按钮"], [4, "AI 图片识别"], [5, "AI 计算题"]];
const state = {
  view: "overview",
  settings: null,
  telegram: null,
  taskNames: [],
  currentTask: null,
  config: null,
};
let toastTimer;
let aiTestImageDataUrl = "";

const emptyChat = () => ({
  chat_id: "",
  message_thread_id: null,
  name: "",
  delete_after: null,
  actions: [{ action: 1, text: "签到" }],
  action_interval: 1,
});
const emptyConfig = () => ({ chats: [emptyChat()], sign_at: "0 6 * * *", random_seconds: 0, sign_interval: 1 });

async function api(url, options = {}) {
  const headers = { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) };
  const response = await fetch(url, { ...options, headers });
  const text = response.status === 204 ? "" : await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (_error) { body = { error: text || "响应格式错误" }; }
  if (!response.ok) throw new Error(body?.error || `请求失败（${response.status}）`);
  return body;
}

function showToast(message, type = "success") {
  const toast = $("#toast");
  toast.textContent = message;
  toast.className = `toast show${type === "error" ? " error" : ""}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.className = "toast"; }, 3200);
}

async function withButton(button, task) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "处理中…";
  try { return await task(); }
  catch (error) { showToast(error.message, "error"); throw error; }
  finally { button.disabled = false; button.textContent = original; }
}

function showView(name) {
  const view = $(`#view-${name}`);
  if (!view) return;
  state.view = name;
  $$(".view").forEach((item) => item.classList.toggle("active", item === view));
  $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === name));
  $("#page-title").textContent = view.dataset.title;
  $("#page-eyebrow").textContent = view.dataset.eyebrow;
  $("#sidebar").classList.remove("open");
  history.replaceState(null, "", `#${name}`);
  refreshView(name).catch((error) => showToast(error.message, "error"));
}

async function refreshView(name = state.view) {
  if (name === "overview") await loadOverview();
  if (name === "account") await Promise.all([loadTelegramStatus(), ensureSettings()]);
  if (name === "tasks") await loadTaskNames(state.currentTask, false);
  if (name === "history") await loadHistory();
  if (name === "settings") await loadSettings(true);
}

function setServiceStatus(label, mode = "ok") {
  $("#service-status").textContent = label;
  $("#service-status").className = `status-pill${mode === "busy" ? " busy" : mode === "error" ? " error" : ""}`;
  $("#sidebar-status").textContent = mode === "error" ? "服务异常" : label;
}

async function loadOverview() {
  const data = await api("/api/overview");
  setServiceStatus(data.service.running ? "任务运行中" : "服务正常", data.service.running ? "busy" : "ok");
  $("#stat-telegram").textContent = data.telegram.configured ? "已授权" : "未授权";
  $("#stat-telegram-detail").textContent = data.telegram.profile?.username ? `@${data.telegram.profile.username}` : "账号会话状态";
  $("#stat-tasks").textContent = String(data.service.taskCount);
  $("#stat-task-detail").textContent = `${data.service.scheduledCount} 个定时任务`;
  $("#stat-runner").textContent = data.service.running ? "运行中" : "空闲";
  $("#stat-runner-detail").textContent = data.service.running ? "正在执行签到动作" : `时区：${data.service.timezone}`;
  $("#stat-ai").textContent = data.openai.apiKeyConfigured ? "已配置" : "未配置";
  $("#stat-ai-detail").textContent = data.openai.apiKeyConfigured ? data.openai.model : "图片识别与计算题";
  renderLastRun(data.lastRun);
  renderReadiness(data);
}

function renderLastRun(run) {
  const root = $("#overview-last-run");
  if (!run) {
    root.className = "empty-state compact";
    root.textContent = "尚无运行记录";
    return;
  }
  const failed = runFailed(run);
  root.className = "last-run-card";
  root.innerHTML = `<span class="run-indicator${failed ? " fail" : ""}">${failed ? "!" : "✓"}</span><div><strong>${escapeHtml(run.task || "未命名任务")}</strong><p>${escapeHtml(runSummary(run))}</p></div><time>${escapeHtml(formatDate(run.finishedAt || run.startedAt))}</time>`;
}

function renderReadiness(data) {
  const checks = [
    [data.telegram.configured, "Telegram 会话", data.telegram.configured ? "已保存授权会话" : "前往账号页完成登录", "account"],
    [data.service.taskCount > 0, "签到任务", data.service.taskCount ? `已配置 ${data.service.taskCount} 个任务` : "创建第一个签到任务", "tasks"],
    [data.openai.apiKeyConfigured, "AI 能力（可选）", data.openai.apiKeyConfigured ? `使用 ${data.openai.model}` : "普通签到不受影响", "settings"],
  ];
  $("#readiness-list").replaceChildren(...checks.map(([ready, title, detail, target]) => {
    const item = document.createElement("button");
    item.className = `check-item${ready ? " ready" : ""}`;
    item.innerHTML = `<span class="check-icon">${ready ? "✓" : "→"}</span><span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(detail)}</small></span>`;
    item.onclick = () => showView(target);
    return item;
  }));
}

async function ensureSettings() {
  if (!state.settings) await loadSettings(false);
  renderTelegram(state.telegram);
  return state.settings;
}

async function loadSettings(fillForm = true) {
  state.settings = await api("/api/settings");
  if (fillForm) {
    $("#settings-api-id").value = state.settings.telegram.apiId || "";
    $("#settings-api-hash").value = "";
    $("#settings-api-hash").placeholder = state.settings.telegram.apiHashConfigured ? "已配置，留空表示保持当前值" : "输入 API Hash";
    $("#clear-api-hash").checked = false;
    $("#settings-openai-key").value = "";
    $("#settings-openai-key").placeholder = state.settings.openai.apiKeyConfigured ? "已配置，留空表示保持当前值" : "输入 API Key";
    $("#clear-openai-key").checked = false;
    $("#settings-openai-base").value = state.settings.openai.baseUrl || "";
    $("#settings-openai-model").value = state.settings.openai.model || "gpt-4o";
    $("#settings-timezone").value = state.settings.timezone || "";
  }
  renderTelegram(state.telegram);
  return state.settings;
}

async function saveSettings() {
  const payload = {
    telegram: {
      apiId: $("#settings-api-id").value.trim(),
      apiHash: $("#settings-api-hash").value,
      clearApiHash: $("#clear-api-hash").checked,
    },
    openai: {
      apiKey: $("#settings-openai-key").value,
      clearApiKey: $("#clear-openai-key").checked,
      baseUrl: $("#settings-openai-base").value.trim(),
      model: $("#settings-openai-model").value.trim(),
    },
    timezone: $("#settings-timezone").value.trim(),
  };
  state.settings = await api("/api/settings", { method: "PUT", body: JSON.stringify(payload) });
  await loadSettings(true);
  showToast("运行设置已保存并生效");
}

async function testAiImage() {
  const resultBox = $("#ai-test-result");
  resultBox.className = "ai-test-result hidden";
  try {
    if (!aiTestImageDataUrl) generateAiTestImage();
    const options = $("#ai-test-options").value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
    if (options.length < 2) throw new Error("请至少填写 2 个按钮选项，每行一个");
    const response = await api("/api/ai/test-image", {
      method: "POST",
      body: JSON.stringify({
        openai: {
          apiKey: $("#settings-openai-key").value,
          clearApiKey: $("#clear-openai-key").checked,
          baseUrl: $("#settings-openai-base").value.trim(),
          model: $("#settings-openai-model").value.trim(),
        },
        image: aiTestImageDataUrl,
        query: $("#ai-test-query").value.trim(),
        options,
      }),
    });
    resultBox.textContent = `识别成功：选择第 ${response.index + 1} 项「${response.option}」${response.reason ? `；原因：${response.reason}` : ""}（模型：${response.model}）`;
    resultBox.className = "ai-test-result";
    showToast("AI 图片识别测试通过");
  } catch (error) {
    resultBox.textContent = `测试失败：${error.message}`;
    resultBox.className = "ai-test-result error";
    throw error;
  }
}

function generateAiTestImage() {
  const canvas = document.createElement("canvas");
  canvas.width = 960;
  canvas.height = 540;
  const context = canvas.getContext("2d");
  const gradient = context.createLinearGradient(0, 0, 960, 540);
  gradient.addColorStop(0, "#10231d");
  gradient.addColorStop(1, "#245d4b");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 960, 540);

  context.fillStyle = "rgba(255,255,255,.08)";
  context.beginPath();
  context.arc(110, 95, 155, 0, Math.PI * 2);
  context.fill();
  context.beginPath();
  context.arc(885, 470, 210, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = "#f5c451";
  context.font = "700 25px system-ui, sans-serif";
  context.fillText("TG SIGNER · AI VISION TEST", 54, 65);
  context.fillStyle = "#ffffff";
  context.font = "700 38px system-ui, sans-serif";
  context.fillText("请识别黄色圆形中的数字", 54, 126);

  context.fillStyle = "#f5c451";
  context.beginPath();
  context.arc(480, 312, 132, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = "#ffe6a8";
  context.lineWidth = 10;
  context.stroke();
  context.fillStyle = "#10231d";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = "900 190px Arial, sans-serif";
  context.fillText("7", 480, 322);

  context.textAlign = "left";
  context.textBaseline = "alphabetic";
  context.fillStyle = "#cfe0d9";
  context.font = "500 22px system-ui, sans-serif";
  context.fillText("Generated locally for image recognition verification", 54, 500);
  aiTestImageDataUrl = canvas.toDataURL("image/png");
  const preview = $("#ai-test-preview");
  preview.src = aiTestImageDataUrl;
  $("#ai-test-query").value = "图片中央黄色圆形中的数字是什么？";
  $("#ai-test-options").value = "3\n7\n9";
  $("#ai-test-result").className = "ai-test-result hidden";
  return aiTestImageDataUrl;
}

async function loadTelegramStatus() {
  state.telegram = await api("/api/telegram/status");
  renderTelegram(state.telegram);
  return state.telegram;
}

function renderTelegram(status) {
  if (!status) return;
  const completed = status.configured && !["waiting_code", "waiting_password", "connecting", "verifying", "error"].includes(status.status);
  const step = status.status === "waiting_code" || (status.status === "verifying" && !$("#code-stage").classList.contains("hidden"))
    ? "code" : status.status === "waiting_password" ? "password" : completed || status.status === "authorized" ? "done" : "phone";
  const order = ["phone", "code", "password", "done"];
  $$("[data-login-step]").forEach((item) => {
    const index = order.indexOf(item.dataset.loginStep);
    const activeIndex = order.indexOf(step);
    item.classList.toggle("active", index === activeIndex);
    item.classList.toggle("done", index < activeIndex);
  });
  $("#phone-stage").classList.toggle("hidden", step !== "phone");
  $("#code-stage").classList.toggle("hidden", step !== "code");
  $("#password-stage").classList.toggle("hidden", step !== "password");
  $("#password-hint").textContent = status.hint ? `密码提示：${status.hint}` : "";
  $("#login-message").textContent = status.message || (completed ? "Telegram 会话可用" : "输入 Telegram 手机号开始授权。");
  $("#cancel-login").disabled = !["connecting", "verifying", "waiting_code", "waiting_password"].includes(status.status);
  $("#logout-telegram").disabled = !status.configured;

  const badge = $("#telegram-badge");
  badge.className = `state-badge${status.status === "error" ? " error" : status.configured ? "" : " neutral"}`;
  badge.textContent = status.status === "error" ? "登录异常" : status.configured ? "会话已保存" : status.status === "connecting" ? "连接中" : "未连接";

  const profile = status.profile;
  const displayName = profile ? [profile.firstName, profile.lastName].filter(Boolean).join(" ") || "Telegram 用户" : "尚未登录";
  $("#profile-name").textContent = displayName;
  $("#profile-username").textContent = profile?.username ? `@${profile.username}` : status.configured ? "已保存 Telegram Session" : "完成授权后显示账号信息";
  $("#profile-avatar").textContent = profile ? initials(displayName) : "TG";
  $("#session-source").textContent = ({ environment: "环境变量", file: "工作目录", none: "无" })[status.sessionSource] || "无";
  $("#credential-status").textContent = state.settings?.telegram.apiHashConfigured && state.settings?.telegram.apiId ? "已配置" : "未配置";
}

async function startTelegramLogin() {
  state.telegram = await api("/api/telegram/login/start", { method: "POST", body: JSON.stringify({ phoneNumber: $("#login-phone").value }) });
  renderTelegram(state.telegram);
  if (state.telegram.status === "waiting_code") $("#login-code").focus();
}

async function submitTelegramCode() {
  state.telegram = await api("/api/telegram/login/code", { method: "POST", body: JSON.stringify({ code: $("#login-code").value }) });
  $("#login-code").value = "";
  renderTelegram(state.telegram);
  if (state.telegram.status === "waiting_password") $("#login-password").focus();
  if (state.telegram.status === "authorized") showToast("Telegram 登录成功");
}

async function submitTelegramPassword() {
  state.telegram = await api("/api/telegram/login/password", { method: "POST", body: JSON.stringify({ password: $("#login-password").value }) });
  $("#login-password").value = "";
  renderTelegram(state.telegram);
  if (state.telegram.status === "authorized") showToast("Telegram 登录成功");
}

async function loadTaskNames(selected = state.currentTask, loadSelection = true) {
  const data = await api("/api/configs");
  state.taskNames = data.configs;
  $("#task-count").textContent = String(state.taskNames.length);
  renderTaskList();
  if (!loadSelection) return;
  const target = selected && state.taskNames.includes(selected) ? selected : state.taskNames[0];
  if (target) await loadTask(target);
  else newTask();
}

function renderTaskList() {
  const root = $("#task-list");
  if (!state.taskNames.length) {
    root.innerHTML = '<div class="task-list-empty">还没有任务<br>点击“新建任务”开始</div>';
    return;
  }
  root.replaceChildren(...state.taskNames.map((name) => {
    const button = document.createElement("button");
    button.className = `task-item${name === state.currentTask ? " active" : ""}`;
    button.textContent = name;
    button.onclick = () => loadTask(name).catch((error) => showToast(error.message, "error"));
    return button;
  }));
}

async function loadTask(name) {
  state.config = await api(`/api/configs/${encodeURIComponent(name)}`);
  state.currentTask = name;
  renderTaskList();
  renderTaskEditor();
}

function newTask() {
  state.currentTask = null;
  state.config = emptyConfig();
  renderTaskList();
  renderTaskEditor();
  $("#task-name").focus();
}

function renderTaskEditor() {
  if (!state.config) state.config = emptyConfig();
  $("#editor-title").textContent = state.currentTask || "新建任务";
  $("#task-name").value = state.currentTask || "";
  $("#task-name").disabled = Boolean(state.currentTask);
  $("#delete-task").disabled = !state.currentTask;
  $("#sign-at").value = state.config.sign_at;
  $("#random-seconds").value = state.config.random_seconds;
  $("#sign-interval").value = state.config.sign_interval;
  $("#chats").replaceChildren(...state.config.chats.map(chatElement));
}

function chatElement(chat, chatIndex) {
  const card = document.createElement("article");
  card.className = "chat-card";
  card.innerHTML = `<div class="chat-head"><div class="chat-number"><span>${chatIndex + 1}</span><strong>${escapeHtml(chat.name || `聊天 ${chatIndex + 1}`)}</strong></div><button class="danger-text" type="button" data-remove-chat>删除聊天</button></div><div class="form-grid"><label>Chat ID<input data-key="chat_id" value="${escapeAttribute(chat.chat_id)}" placeholder="@username 或数字 ID"></label><label>显示名称<input data-key="name" value="${escapeAttribute(chat.name || "")}" placeholder="可选"></label><label>话题 ID<input data-key="message_thread_id" type="number" min="0" value="${chat.message_thread_id ?? ""}" placeholder="可选"></label><label>删除消息（秒）<input data-key="delete_after" type="number" min="0" value="${chat.delete_after ?? ""}" placeholder="留空不删除"></label><label>动作间隔（秒）<input data-key="action_interval" type="number" min="0" value="${chat.action_interval ?? 1}"></label></div><div class="action-head"><div><strong>动作流程</strong><p class="field-help">按从上到下的顺序执行</p></div><button class="secondary" type="button" data-add-action>添加动作</button></div><div class="action-list"></div>`;
  $$('[data-key]', card).forEach((input) => input.addEventListener("input", () => {
    const value = input.value === "" ? null : input.type === "number" ? Number(input.value) : input.value;
    chat[input.dataset.key] = value;
    if (input.dataset.key === "name") $(".chat-number strong", card).textContent = value || `聊天 ${chatIndex + 1}`;
  }));
  $(".action-list", card).replaceChildren(...chat.actions.map((action, index) => actionElement(chat, action, index)));
  $("[data-add-action]", card).onclick = () => { chat.actions.push({ action: 1, text: "签到" }); renderTaskEditor(); };
  $("[data-remove-chat]", card).onclick = () => {
    if (state.config.chats.length === 1) return showToast("任务至少需要一个聊天", "error");
    state.config.chats.splice(chatIndex, 1);
    renderTaskEditor();
  };
  return card;
}

function actionElement(chat, action, actionIndex) {
  const row = document.createElement("div");
  row.className = "action-row";
  const index = document.createElement("span");
  index.className = "action-index";
  index.textContent = String(actionIndex + 1);
  const select = document.createElement("select");
  select.setAttribute("aria-label", `动作 ${actionIndex + 1}`);
  select.replaceChildren(...ACTIONS.map(([value, label]) => new Option(label, value)));
  select.value = String(action.action);
  select.onchange = () => {
    const type = Number(select.value);
    chat.actions[actionIndex] = type === 1 ? { action: type, text: "签到" }
      : type === 2 ? { action: type, dice: "🎲" }
        : type === 3 ? { action: type, text: "" } : { action: type };
    renderTaskEditor();
  };
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "danger-text";
  remove.textContent = "删除";
  remove.onclick = () => {
    if (chat.actions.length === 1) return showToast("聊天至少需要一个动作", "error");
    chat.actions.splice(actionIndex, 1);
    renderTaskEditor();
  };
  row.append(index, select, actionValueControl(action), remove);
  return row;
}

function actionValueControl(action) {
  if (action.action === 2) {
    const select = document.createElement("select");
    select.setAttribute("aria-label", "骰子类型");
    select.replaceChildren(...["🎲", "🎯", "🏀", "⚽", "🎳", "🎰"].map((dice) => new Option(dice, dice)));
    select.value = action.dice;
    select.onchange = () => { action.dice = select.value; };
    return select;
  }
  if (action.action === 1 || action.action === 3) {
    const input = document.createElement("input");
    input.placeholder = action.action === 1 ? "发送内容" : "按钮文字";
    input.value = action.text || "";
    input.oninput = () => { action.text = input.value; };
    return input;
  }
  const label = document.createElement("span");
  label.className = "action-ai";
  label.textContent = action.action === 4 ? "识别图片并选择正确按钮" : "识别题目并点击或回复答案";
  return label;
}

function readTaskForm() {
  state.config.sign_at = $("#sign-at").value.trim();
  state.config.random_seconds = Number($("#random-seconds").value) || 0;
  state.config.sign_interval = Number($("#sign-interval").value) || 0;
  return state.config;
}

async function saveCurrentTask() {
  const name = (state.currentTask || $("#task-name").value).trim();
  if (!name) throw new Error("请填写任务名称");
  await api(`/api/configs/${encodeURIComponent(name)}`, { method: "PUT", body: JSON.stringify(readTaskForm()) });
  state.currentTask = name;
  await loadTaskNames(name, true);
  showToast(`任务 ${name} 已保存`);
  return name;
}

async function deleteCurrentTask() {
  if (!state.currentTask) return;
  if (!window.confirm(`确认删除任务“${state.currentTask}”？`)) return;
  await api(`/api/configs/${encodeURIComponent(state.currentTask)}`, { method: "DELETE" });
  state.currentTask = null;
  await loadTaskNames(null, true);
  showToast("任务已删除");
}

async function runCurrentTask() {
  const name = await saveCurrentTask();
  await api(`/api/configs/${encodeURIComponent(name)}/run-once`, { method: "POST" });
  showToast(`任务 ${name} 已提交运行`);
  setServiceStatus("任务运行中", "busy");
}

async function loadHistory() {
  const data = await api("/api/runs?limit=50");
  const root = $("#history-list");
  if (!data.runs.length) {
    root.innerHTML = '<div class="empty-state">尚无运行记录</div>';
    return;
  }
  root.replaceChildren(...data.runs.map(historyRow));
}

function historyRow(run) {
  const failed = runFailed(run);
  const row = document.createElement("article");
  row.className = "history-row";
  row.innerHTML = `<div class="history-time"><strong>${escapeHtml(formatDate(run.finishedAt || run.startedAt, "time"))}</strong><small>${escapeHtml(formatDate(run.finishedAt || run.startedAt, "date"))}</small></div><div class="history-task"><strong>${escapeHtml(run.task || "未命名任务")}</strong><small>${run.source === "schedule" ? "定时运行" : "手动运行"}</small></div><div class="history-summary">${escapeHtml(runSummary(run))}</div><span class="result-chip${failed ? " fail" : ""}">${failed ? "失败" : "完成"}</span><details class="history-details"><summary>查看原始结果</summary><pre>${escapeHtml(JSON.stringify(run, null, 2))}</pre></details>`;
  return row;
}

function runFailed(run) {
  return Boolean(run?.error || run?.results?.some((item) => !item.ok));
}

function runSummary(run) {
  if (run.error) return run.error;
  if (!Array.isArray(run.results)) return "运行已结束";
  const passed = run.results.filter((item) => item.ok).length;
  return `${passed}/${run.results.length} 个聊天执行成功`;
}

function formatDate(value, part = "all") {
  if (!value) return "未知时间";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  if (part === "time") return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  if (part === "date") return date.toLocaleDateString("zh-CN");
  return date.toLocaleString("zh-CN", { hour12: false });
}

function initials(name) {
  const value = String(name || "TG").trim();
  return value.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "TG";
}

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function escapeAttribute(value) { return escapeHtml(value); }

function bindEvents() {
  $$(".nav-item").forEach((button) => button.onclick = () => showView(button.dataset.view));
  $$('[data-go]').forEach((button) => button.onclick = () => showView(button.dataset.go));
  $("#menu-button").onclick = () => $("#sidebar").classList.toggle("open");
  $("#refresh-current").onclick = () => refreshView().then(() => showToast("已刷新")).catch((error) => showToast(error.message, "error"));
  $("#save-settings").onclick = (event) => withButton(event.currentTarget, saveSettings).catch(() => {});
  $("#test-ai-image").onclick = (event) => withButton(event.currentTarget, testAiImage).catch(() => {});
  $("#regenerate-ai-test-image").onclick = () => { generateAiTestImage(); showToast("已重新生成测试图"); };
  $("#phone-stage").onsubmit = (event) => { event.preventDefault(); withButton($("button", event.currentTarget), startTelegramLogin).catch(() => {}); };
  $("#code-stage").onsubmit = (event) => { event.preventDefault(); withButton($("button", event.currentTarget), submitTelegramCode).catch(() => {}); };
  $("#password-stage").onsubmit = (event) => { event.preventDefault(); withButton($("button", event.currentTarget), submitTelegramPassword).catch(() => {}); };
  $("#cancel-login").onclick = (event) => withButton(event.currentTarget, async () => { state.telegram = await api("/api/telegram/login/cancel", { method: "POST" }); renderTelegram(state.telegram); }).catch(() => {});
  $("#logout-telegram").onclick = (event) => {
    if (!window.confirm("确认退出当前 Telegram 会话？")) return;
    withButton(event.currentTarget, async () => { state.telegram = await api("/api/telegram/logout", { method: "POST" }); renderTelegram(state.telegram); showToast("Telegram 会话已退出"); }).catch(() => {});
  };
  $("#new-task").onclick = newTask;
  $("#add-chat").onclick = () => { state.config.chats.push(emptyChat()); renderTaskEditor(); };
  $("#save-task").onclick = (event) => withButton(event.currentTarget, saveCurrentTask).catch(() => {});
  $("#run-task").onclick = (event) => withButton(event.currentTarget, runCurrentTask).catch(() => {});
  $("#delete-task").onclick = (event) => withButton(event.currentTarget, deleteCurrentTask).catch(() => {});
  $("#refresh-history").onclick = (event) => withButton(event.currentTarget, async () => { await loadHistory(); showToast("运行记录已刷新"); }).catch(() => {});
}

async function pollHealth() {
  try {
    const health = await api("/api/health");
    setServiceStatus(health.running ? "任务运行中" : "服务正常", health.running ? "busy" : "ok");
  } catch (_error) { setServiceStatus("服务离线", "error"); }
}

async function init() {
  bindEvents();
  generateAiTestImage();
  state.config = emptyConfig();
  renderTaskEditor();
  const initialView = location.hash.slice(1);
  if (["overview", "account", "tasks", "history", "settings"].includes(initialView)) showView(initialView);
  try {
    await Promise.all([loadSettings(false), loadTelegramStatus(), loadTaskNames(null, true), loadHistory(), loadOverview()]);
  } catch (error) {
    setServiceStatus("需要处理", "error");
    showToast(error.message, "error");
  }
  setInterval(pollHealth, 5000);
}

init();
