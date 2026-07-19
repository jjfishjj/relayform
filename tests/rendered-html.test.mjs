import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
}

test("renders the Relayform connector builder", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>Relayform — Universal AI Connector<\/title>/i);
  assert.match(html, /Turn a source into/);
  assert.match(html, /Connector builder/);
  assert.match(html, /Analyze source/);
  assert.match(html, /Universal JSON/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});
