import crypto from "node:crypto";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

export function assertPublicAuth(host, token) {
  if (!LOOPBACK_HOSTS.has(host) && !token) {
    throw new Error("公开监听必须配置 TG_AUTH_TOKEN（也兼容 AUTH_TOKEN）");
  }
}

export function warnIfPubliclyExposed(host, token, tlsEnabled = false, logger = console.warn) {
  if (LOOPBACK_HOSTS.has(host)) return;
  if (token && !tlsEnabled) logger("安全警告：TG_AUTH_TOKEN 将通过明文 HTTP 传输，建议仅在可信网络使用或配置 HTTPS");
}

export function createAuthMiddleware(token) {
  if (!token) return (_req, _res, next) => next();
  return (req, res, next) => {
    if (authorized(req.headers.authorization, token)) return next();
    res.set("WWW-Authenticate", 'Basic realm="TG Signer", charset="UTF-8"');
    res.status(401).json({ error: "需要身份验证" });
  };
}

function authorized(header, expected) {
  if (!header) return false;
  let supplied = "";
  if (header.startsWith("Bearer ")) supplied = header.slice(7);
  if (header.startsWith("Basic ")) {
    try { supplied = Buffer.from(header.slice(6), "base64").toString("utf8").split(":").slice(1).join(":"); }
    catch (_error) { return false; }
  }
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
