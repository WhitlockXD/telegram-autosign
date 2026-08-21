import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import helmet from "helmet";
import { helmetOptions } from "../server/security.js";

test("HTTP responses do not upgrade static resources to HTTPS", async (t) => {
  const app = express();
  app.use(helmet(helmetOptions(false)));
  app.get("/", (_req, res) => res.send("ok"));
  const server = app.listen(0, "127.0.0.1");
  t.after(() => server.close());
  await new Promise((resolve) => server.once("listening", resolve));

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(response.status, 200);
  assert.doesNotMatch(response.headers.get("content-security-policy"), /upgrade-insecure-requests/);
  assert.equal(response.headers.get("strict-transport-security"), null);
});
