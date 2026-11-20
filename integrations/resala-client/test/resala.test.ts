import assert from "node:assert/strict";
import test from "node:test";
import { createResalaClient, ResalaApiError, ResalaTransportError } from "../src/resala.ts";

test("sends PIN to the supplied production host with bearer auth", async () => {
  let called = 0;
  const client = createResalaClient({ apiKey: "rsl_test", fetch: async (url, init) => {
    called++;
    assert.equal(String(url), "https://otp.sadeem-factory.com/api/v1/pins");
    assert.equal(init?.method, "POST");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer rsl_test");
    assert.equal(new Headers(init?.headers).get("Content-Type"), "application/json");
    assert.deepEqual(JSON.parse(String(init?.body)), { phone: "0940055051" });
    return Response.json({ id: "abc", phone: "0940055051", status: "accepted", sender_name: "Resala" }, { status: 201 });
  }});
  assert.equal((await client.createPin("0940055051")).status, "accepted");
  assert.equal(called, 1);
});

test("exposes validation errors by type and field", async () => {
  const client = createResalaClient({ apiKey: "rsl_test", fetch: async () => Response.json({
    status: 422, type: "InputValidation", message: "localized text",
    request_id: "request-1", errors: { phone: ["Invalid phone"] },
  }, { status: 422 }) });
  await assert.rejects(client.createPin("bad"), (error: unknown) => {
    assert.ok(error instanceof ResalaApiError);
    assert.equal(error.type, "InputValidation");
    assert.deepEqual(error.errors, { phone: ["Invalid phone"] });
    assert.equal(error.requestId, "request-1");
    return true;
  });
});

test("does not retry a send after a transport failure", async () => {
  let called = 0;
  const client = createResalaClient({ apiKey: "rsl_test", fetch: async () => {
    called++;
    throw new Error("connection reset");
  }});
  await assert.rejects(client.sendTemplate("template-1", [{ phone: "0940055051", $1: "Hi" }]), ResalaTransportError);
  assert.equal(called, 1);
});

test("sends free-text SMS as one production request", async () => {
  let called = 0;
  const client = createResalaClient({ apiKey: "rsl_test", fetch: async (url, init) => {
    called++;
    assert.equal(String(url), "https://otp.sadeem-factory.com/api/v1/messages");
    assert.deepEqual(JSON.parse(String(init?.body)), { phone: "0925924263", content: "hi zazu" });
    return Response.json({ id: "message-1", status: "accepted" }, { status: 201 });
  }});
  assert.equal((await client.sendMessage("0925924263", "hi zazu")).status, "accepted");
  assert.equal(called, 1);
});

test("encodes template and message-log query parameters", async () => {
  const urls: string[] = [];
  const client = createResalaClient({ apiKey: "rsl_test", fetch: async (url) => {
    urls.push(String(url));
    return Response.json(urls.length === 1 ? { invalid_numbers: [], failed_numbers: [] } : { data: [], meta: { total: 0, per_page: 20, current_page: 1, last_page: 1 } }, { status: urls.length === 1 ? 201 : 200 });
  }});
  await client.sendTemplate("template 1", [{ phone: "218940055051", $1: "Hi" }], { scheduledAt: "2026-11-20 09:00" });
  await client.getSentView({ filters: "source:pin", page: 2 });
  assert.equal(new URL(urls[0]).searchParams.get("scheduled_at"), "2026-11-20 09:00");
  assert.equal(new URL(urls[0]).searchParams.get("sms_template_id"), "template 1");
  assert.equal(new URL(urls[1]).searchParams.get("filters"), "source:pin");
  assert.equal(new URL(urls[1]).searchParams.get("page"), "2");
});
