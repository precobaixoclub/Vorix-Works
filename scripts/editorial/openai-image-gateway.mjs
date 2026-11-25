// Ponte mínima para a API de imagens da OpenAI, executada DENTRO do container da API (onde a chave está no
// cofre `ai-provider:openai`). Recebe um pedido JSON pela entrada padrão e devolve UMA linha JSON com a imagem
// (base64), o consumo (`usage`) e a duração. Não grava nada em banco nem em armazenamento, não registra a
// chave e não publica. Usada só pela amostra controlada de geração real (creative-real-sample.mjs).
//
//   docker exec -i zuno-zuno-api-1 node --input-type=module < openai-image-gateway.mjs  (o pedido vem antes, no stdin)
//
// Pedido: { op: "edit" | "generate", model, prompt, size, quality, images?: [base64 PNG] }
//       | { op: "review", model, prompt, images: [base64 PNG, base64 PNG] }  (revisão visual, chat com imagens)
import { buildApiContainer } from "./dist/interfaces/api/di/container.js";
import { loadApiConfig } from "./dist/interfaces/api/config/api-config.js";

const c = buildApiContainer(loadApiConfig());
const started = Date.now();
try {
  const stored = await c.secretManager.get("ai-provider:openai").catch(() => undefined);
  const key = stored?.value?.apiKey ?? process.env.OPENAI_API_KEY;
  if (!key) throw new Error("Chave da OpenAI indisponível no cofre do servidor");
  const auth = { authorization: `Bearer ${key}` };
  let response;
  if (request.op === "review") {
    response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST", headers: { ...auth, "content-type": "application/json" }, signal: AbortSignal.timeout(120000),
      body: JSON.stringify({ model: request.model, temperature: 0, response_format: { type: "json_object" }, messages: [{ role: "user", content: [
        { type: "text", text: request.prompt },
        ...request.images.map((image) => ({ type: "image_url", image_url: { url: `data:image/png;base64,${image}`, detail: "high" } })),
      ] }] }),
    });
  } else if (request.op === "edit") {
    const form = new FormData();
    for (const [name, value] of Object.entries({ model: request.model, prompt: request.prompt, size: request.size, quality: request.quality, n: "1" })) form.append(name, value);
    if (request.images.length === 1) form.append("image", new Blob([Buffer.from(request.images[0], "base64")], { type: "image/png" }), "reference.png");
    else request.images.forEach((image, index) => form.append("image[]", new Blob([Buffer.from(image, "base64")], { type: "image/png" }), `reference-${index + 1}.png`));
    response = await fetch("https://api.openai.com/v1/images/edits", { method: "POST", headers: auth, body: form, signal: AbortSignal.timeout(300000) });
  } else if (request.op === "generate") {
    response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST", headers: { ...auth, "content-type": "application/json" }, signal: AbortSignal.timeout(300000),
      body: JSON.stringify({ model: request.model, prompt: request.prompt, size: request.size, quality: request.quality, n: 1 }),
    });
  } else throw new Error("Operação inválida");
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.log(JSON.stringify({ ok: false, status: response.status, code: body?.error?.code ?? body?.error?.type ?? null, message: String(body?.error?.message ?? "").slice(0, 300), ms: Date.now() - started }));
  } else if (request.op === "review") {
    console.log(JSON.stringify({ ok: true, content: body.choices?.[0]?.message?.content ?? "", usage: body.usage ?? null, ms: Date.now() - started }));
  } else {
    console.log(JSON.stringify({ ok: true, image: body.data?.[0]?.b64_json ?? null, usage: body.usage ?? null, ms: Date.now() - started }));
  }
} catch (error) {
  console.log(JSON.stringify({ ok: false, status: 0, message: error instanceof Error ? error.message : String(error), ms: Date.now() - started }));
} finally {
  await c.pool?.end?.().catch(() => undefined);
  await c.identity?.pool?.end().catch(() => undefined);
}
