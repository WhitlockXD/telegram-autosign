import test from "node:test";
import assert from "node:assert/strict";
import { assertPublicAuth, createAuthMiddleware, warnIfPubliclyExposed } from "../server/auth.js";

test("public binding requires an authentication token", () => {
  assert.doesNotThrow(() => assertPublicAuth("127.0.0.1", ""));
  assert.throws(() => assertPublicAuth("0.0.0.0", ""), /TG_AUTH_TOKEN/);
  assert.doesNotThrow(() => assertPublicAuth("0.0.0.0", "secret"));
});

test("public HTTP binding warns about cleartext authentication", () => {
  const warnings = [];
  warnIfPubliclyExposed("0.0.0.0", "secret", false, (message) => warnings.push(message));
  warnIfPubliclyExposed("0.0.0.0", "secret", true, (message) => warnings.push(message));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /明文 HTTP/);
});

test("empty auth token allows access for loopback-only use", () => {
  const middleware = createAuthMiddleware("");
  let nextCalled = false;
  middleware({ headers: {} }, {}, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
});

test("basic auth accepts the configured token", () => {
  const middleware = createAuthMiddleware("secret");
  let nextCalled = false;
  middleware(
    { headers: { authorization: `Basic ${Buffer.from("admin:secret").toString("base64")}` } },
    {},
    () => { nextCalled = true; },
  );
  assert.equal(nextCalled, true);
});
