// Execute inside zuno-api after deployment. Uses service environment without printing secrets.
// Opens public login screens only; never authenticates, creates SocialAccount, or publishes.
const base = process.env.SOCIAL_GATEWAY_URL;
const token = process.env.SOCIAL_GATEWAY_TOKEN;
if (!base || !token) throw new Error("SOCIAL_GATEWAY_CONFIGURATION_MISSING");
const scope = { tenantId: "__deployment_smoke__", workspaceId: "__public_login_only__", userId: "__deployment_smoke__" };
async function rpc(operation, payload, expected = 200) {
  const response = await fetch(`${base}/rpc/${operation}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(65000) });
  if (response.status !== expected) throw new Error(`GATEWAY_SMOKE_${operation.toUpperCase()}_HTTP_${response.status}`);
  return response.json();
}
const health = await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(10000) });
if (!health.ok) throw new Error("GATEWAY_SMOKE_HEALTH_FAILED");
for (const network of ["instagram", "facebook", "tiktok"]) {
  const input = { ...scope, network }; let flowId;
  try {
    ({ flowId } = await rpc("connect", input));
    await rpc("frame", { ...input, tenantId: "__different_tenant__", flowId }, 404);
    const frame = await rpc("frame", { ...input, flowId });
    if (frame.width !== 1280 || frame.height !== 800 || !frame.image) throw new Error("GATEWAY_SMOKE_FRAME_INVALID");
    console.log(JSON.stringify({ network, publicLoginFrame: "PASS", status: frame.status, imageBytes: Buffer.from(frame.image, "base64").length, crossTenantFlow: "DENIED", authenticated: false, published: false }));
  } finally { if (flowId) await rpc("cancel", { ...input, flowId }); }
}
console.log("SOCIAL_GATEWAY_SMOKE_PASS; REAL_ACCOUNT_TEST=BLOCKED_NEEDS_USER");
