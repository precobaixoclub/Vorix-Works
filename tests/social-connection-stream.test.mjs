import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";

import { attachSocialConnectionStreamProxy, SOCIAL_CONNECTION_STREAM_PATH } from "../dist/interfaces/api/social-connection-stream.js";

const FLOW = "11111111-2222-4333-8444-555555555555";
const TOKEN = "gateway-token-0123456789-0123456789";

/** Sobe um gateway falso e a API com o relay; devolve o que o gateway recebeu. */
async function harness({ principal, workspace = { id: "ws-1", tenantId: "t-1", status: "active" }, canConnect = true }) {
  const gatewayServer = createServer();
  const received = [];
  let gatewayAuth;
  const gatewayWss = new WebSocketServer({ server: gatewayServer, path: "/stream" });
  gatewayWss.on("connection", (socket, request) => {
    gatewayAuth = request.headers.authorization;
    socket.on("message", (data) => {
      received.push(JSON.parse(data.toString()));
      if (received.length === 1) socket.send(Buffer.from([0xff, 0xd8, 0x01, 0xff, 0xd9]), { binary: true });
    });
  });
  await new Promise((resolve) => gatewayServer.listen(0, "127.0.0.1", resolve));
  const api = createServer();
  attachSocialConnectionStreamProxy(api, {
    authPort: { verifyToken: async (token) => token === "good" ? { authenticated: true, principal } : { authenticated: false, reason: "invalid_token" } },
    accessResolver: { resolve: async (value) => value },
    workspaceRepository: { getById: async (id) => id === workspace.id ? workspace : undefined },
    canConnect: async () => canConnect,
    gatewayUrl: `http://127.0.0.1:${gatewayServer.address().port}`,
    gatewayToken: TOKEN,
  });
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
  const stop = async () => { gatewayWss.close(); await new Promise((r) => gatewayServer.close(r)); await new Promise((r) => api.close(r)); };
  const connect = (auth) => new Promise((resolve) => {
    const socket = new WebSocket(`ws://127.0.0.1:${api.address().port}${SOCIAL_CONNECTION_STREAM_PATH}`);
    const frames = [];
    socket.on("open", () => socket.send(JSON.stringify({ t: "auth", accessToken: "good", workspaceId: "ws-1", network: "instagram", flowId: FLOW, ...auth })));
    socket.on("message", (data, isBinary) => {
      if (!isBinary) return;
      frames.push(data);
      socket.send(JSON.stringify({ t: "input", action: { kind: "text", text: "olá" } }));
      socket.send(JSON.stringify({ t: "input", action: { kind: "navigate", url: "http://zuno-postgres:5432" } }));
      socket.send(JSON.stringify({ t: "input", action: { kind: "key", key: "Enter" } }));
      setTimeout(() => socket.close(), 200);
    });
    socket.on("close", (code) => resolve({ code, frames }));
  });
  return { connect, received, gatewayAuth: () => gatewayAuth, stop };
}

const member = { userId: "u-1", tenantId: "t-1", role: "owner" };

test("social stream: relays frames and only validated human input, with the scope from the token", async () => {
  const h = await harness({ principal: member });
  try {
    const { frames } = await h.connect({});
    assert.equal(frames.length, 1);
    assert.equal(h.gatewayAuth(), `Bearer ${TOKEN}`);
    // 1ª mensagem: escopo vindo do token (nunca do cliente); depois só as ações válidas.
    assert.deepEqual(h.received[0], { tenantId: "t-1", workspaceId: "ws-1", network: "instagram", userId: "u-1", flowId: FLOW });
    assert.deepEqual(h.received.slice(1), [{ t: "input", action: { kind: "text", text: "olá" } }, { t: "input", action: { kind: "key", key: "Enter" } }]);
    assert.ok(!JSON.stringify(h.received).includes("accessToken"));
  } finally { await h.stop(); }
});

for (const [name, setup] of [
  ["scoped Inbox token", { principal: { ...member, purpose: "inbox_media", messageId: "m-1" } }],
  ["workspace outside the person's list", { principal: { ...member, workspaceIds: ["ws-2"] } }],
  ["workspace of another company", { principal: member, workspace: { id: "ws-1", tenantId: "t-2", status: "active" } }],
  ["inactive workspace", { principal: member, workspace: { id: "ws-1", tenantId: "t-1", status: "inactive" } }],
  ["role without social_connect", { principal: { ...member, role: "viewer" } }],
  ["network not on the browser provider", { principal: member, canConnect: false }],
]) {
  test(`social stream: refuses ${name}`, async () => {
    const h = await harness(setup);
    try {
      const { code, frames } = await h.connect({});
      assert.equal(code, 4401);
      assert.equal(frames.length, 0);
      assert.equal(h.received.length, 0);
    } finally { await h.stop(); }
  });
}

test("social stream: refuses a bad token and a malformed flow id", async () => {
  const h = await harness({ principal: member });
  try {
    assert.equal((await h.connect({ accessToken: "bad" })).code, 4401);
    assert.equal((await h.connect({ flowId: "../rpc/publish" })).code, 4401);
    assert.equal(h.received.length, 0);
  } finally { await h.stop(); }
});
