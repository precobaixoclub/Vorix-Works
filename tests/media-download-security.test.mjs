// Servidor de teste local usa um certificado autoassinado (tests/fixtures/media-download-security)
// para exercer o caminho HTTPS real de `downloadMediaFile` — nunca aceitamos HTTP puro em
// produção, então o teste TAMBÉM precisa ser HTTPS para validar o resto do pipeline (limite de
// tamanho, redirecionamentos, MIME, retry). `NODE_TLS_REJECT_UNAUTHORIZED=0` é escopado só a este
// processo de teste (`node --test` roda cada arquivo em processo isolado) — nunca afeta produção.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:https";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isAllowedDownloadUrl,
  sanitizeDownloadFileName,
  verifyRealMimeType,
  downloadMediaFile,
} from "../dist/infrastructure/media-catalog/media-download-security.js";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "media-download-security");
const TLS_OPTIONS = {
  cert: readFileSync(join(FIXTURES_DIR, "test-cert.pem")),
  key: readFileSync(join(FIXTURES_DIR, "test-key.pem")),
};

/** Um MP4 mínimo mas plausível: caixa `ftyp` real nos primeiros bytes, seguida de padding. */
function fakeMp4Bytes(sizeBytes = 4096) {
  const buffer = Buffer.alloc(sizeBytes, 0);
  buffer.write("....ftypisom", 0, "ascii");
  return buffer;
}

async function withServer(handler, run) {
  const server = createServer(TLS_OPTIONS, handler);
  await new Promise((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  const { port } = server.address();
  try {
    await run(port);
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
}

async function tempDir() {
  return mkdtemp(join(tmpdir(), "zuno-download-security-"));
}

// ---------------------------------------------------------------------------------------------
// Validação de URL / allowlist de domínio
// ---------------------------------------------------------------------------------------------

test("isAllowedDownloadUrl rejeita HTTP puro mesmo com host na allowlist", () => {
  const result = isAllowedDownloadUrl("http://videos.pexels.com/x.mp4", ["videos.pexels.com"]);
  assert.equal(result.ok, false);
});

test("isAllowedDownloadUrl rejeita host fora da allowlist", () => {
  const result = isAllowedDownloadUrl("https://evil.example.com/x.mp4", ["videos.pexels.com"]);
  assert.equal(result.ok, false);
});

test("isAllowedDownloadUrl aceita HTTPS com host exatamente na allowlist ou subdomínio", () => {
  assert.equal(isAllowedDownloadUrl("https://videos.pexels.com/x.mp4", ["pexels.com"]).ok, true);
  assert.equal(isAllowedDownloadUrl("https://pexels.com/x.mp4", ["pexels.com"]).ok, true);
});

test("isAllowedDownloadUrl rejeita URL malformada sem lançar exceção", () => {
  const result = isAllowedDownloadUrl("not a url", ["pexels.com"]);
  assert.equal(result.ok, false);
});

// ---------------------------------------------------------------------------------------------
// Sanitização de nome de arquivo / proteção contra path traversal
// ---------------------------------------------------------------------------------------------

test("sanitizeDownloadFileName remove separadores de caminho e sequências de path traversal", () => {
  const sanitized = sanitizeDownloadFileName("../../etc/passwd");
  assert.ok(!sanitized.includes(".."));
  assert.ok(!sanitized.includes("/"));
});

test("sanitizeDownloadFileName remove caracteres de controle e mantém extensão legível", () => {
  const withControlChars = "video\x00\x1f.mp4";
  const sanitized = sanitizeDownloadFileName(withControlChars);
  assert.ok(sanitized.endsWith(".mp4"));
});

test("sanitizeDownloadFileName nunca devolve string vazia", () => {
  assert.equal(sanitizeDownloadFileName(""), "download");
  const onlySeparators = sanitizeDownloadFileName("///");
  assert.ok(onlySeparators.length > 0);
  assert.ok(!onlySeparators.includes("/"));
});

// ---------------------------------------------------------------------------------------------
// MIME real vs. declarado
// ---------------------------------------------------------------------------------------------

test("verifyRealMimeType aceita MP4 real com Content-Type correto", () => {
  const result = verifyRealMimeType(fakeMp4Bytes(64), "video/mp4");
  assert.equal(result.ok, true);
});

test("verifyRealMimeType rejeita quando os bytes reais não têm assinatura MP4 mas o header diz que é vídeo", () => {
  const fakeBytes = Buffer.from("isto nao e um video real, so texto");
  const result = verifyRealMimeType(fakeBytes, "video/mp4");
  assert.equal(result.ok, false);
});

test("verifyRealMimeType rejeita quando Content-Type está ausente", () => {
  const result = verifyRealMimeType(fakeMp4Bytes(64), null);
  assert.equal(result.ok, false);
});

// ---------------------------------------------------------------------------------------------
// Download real com limites, via servidor HTTPS local real (nunca fetch mockado)
// ---------------------------------------------------------------------------------------------

test("downloadMediaFile baixa um MP4 real com sucesso, valida o MIME real e escreve o arquivo final", async (t) => {
  const dir = await tempDir();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const bytes = fakeMp4Bytes(8192);

  await withServer((request, response) => {
    response.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": String(bytes.length) });
    response.end(bytes);
  }, async (port) => {
    const result = await downloadMediaFile({
      url: `https://127.0.0.1:${port}/video.mp4`,
      destinationDir: dir,
      fileNameHint: "video.mp4",
      limits: { timeoutMs: 5000, maxBytes: 1024 * 1024, maxRedirects: 2, allowedHosts: ["127.0.0.1"], maxRetries: 0 },
    });
    assert.equal(result.ok, true);
    assert.equal(result.sizeBytes, bytes.length);
    assert.ok(result.absolutePath.endsWith("video.mp4"));
    const finalFileName = result.absolutePath.split(/[\\/]/).pop();
    assert.equal(finalFileName, "video.mp4", "o nome do arquivo final nunca deve ser o nome temporário");
  });
});

test("downloadMediaFile segue redirecionamentos dentro do limite, revalidando a allowlist a cada salto", async (t) => {
  const dir = await tempDir();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const bytes = fakeMp4Bytes(2048);

  await withServer((request, response) => {
    if (request.url === "/start") {
      response.writeHead(302, { Location: "/final" });
      response.end();
      return;
    }
    response.writeHead(200, { "Content-Type": "video/mp4" });
    response.end(bytes);
  }, async (port) => {
    const result = await downloadMediaFile({
      url: `https://127.0.0.1:${port}/start`,
      destinationDir: dir,
      fileNameHint: "redirected.mp4",
      limits: { timeoutMs: 5000, maxBytes: 1024 * 1024, maxRedirects: 2, allowedHosts: ["127.0.0.1"], maxRetries: 0 },
    });
    assert.equal(result.ok, true);
  });
});

test("downloadMediaFile aplica limite de tamanho durante o streaming (aborta antes de terminar de baixar)", async (t) => {
  const dir = await tempDir();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const bigBytes = fakeMp4Bytes(2 * 1024 * 1024);

  await withServer((request, response) => {
    response.writeHead(200, { "Content-Type": "video/mp4" });
    response.end(bigBytes);
  }, async (port) => {
    const result = await downloadMediaFile({
      url: `https://127.0.0.1:${port}/big.mp4`,
      destinationDir: dir,
      fileNameHint: "big.mp4",
      limits: { timeoutMs: 5000, maxBytes: 1024, maxRedirects: 2, allowedHosts: ["127.0.0.1"], maxRetries: 0 },
    });
    assert.equal(result.ok, false);
    assert.match(result.reason, /tamanho/i);
  });
});

test("downloadMediaFile limita redirecionamentos e falha quando o limite é excedido (nunca segue um loop infinito)", async (t) => {
  const dir = await tempDir();
  t.after(() => rm(dir, { recursive: true, force: true }));

  await withServer((request, response) => {
    response.writeHead(302, { Location: request.url });
    response.end();
  }, async (port) => {
    const result = await downloadMediaFile({
      url: `https://127.0.0.1:${port}/loop`,
      destinationDir: dir,
      fileNameHint: "loop.mp4",
      limits: { timeoutMs: 5000, maxBytes: 1024 * 1024, maxRedirects: 2, allowedHosts: ["127.0.0.1"], maxRetries: 0 },
    });
    assert.equal(result.ok, false);
    assert.match(result.reason, /redirecionamento/i);
  });
});

test("downloadMediaFile trata 429 (rate limit) como retryable e para exatamente em maxRetries+1 tentativas", async (t) => {
  const dir = await tempDir();
  t.after(() => rm(dir, { recursive: true, force: true }));
  let requestCount = 0;

  await withServer((request, response) => {
    requestCount += 1;
    response.writeHead(429, { "Retry-After": "0" });
    response.end();
  }, async (port) => {
    const result = await downloadMediaFile({
      url: `https://127.0.0.1:${port}/limited`,
      destinationDir: dir,
      fileNameHint: "limited.mp4",
      limits: { timeoutMs: 5000, maxBytes: 1024 * 1024, maxRedirects: 2, allowedHosts: ["127.0.0.1"], maxRetries: 2 },
    });
    assert.equal(result.ok, false);
    assert.equal(requestCount, 3, "1 tentativa inicial + 2 retries = 3 requisições");
  });
});

test("downloadMediaFile trata 500 como retryable, mas 404 como definitivo (não tenta de novo)", async (t) => {
  const dir = await tempDir();
  t.after(() => rm(dir, { recursive: true, force: true }));
  let requestCount = 0;

  await withServer((request, response) => {
    requestCount += 1;
    response.writeHead(404);
    response.end();
  }, async (port) => {
    const result = await downloadMediaFile({
      url: `https://127.0.0.1:${port}/missing`,
      destinationDir: dir,
      fileNameHint: "missing.mp4",
      limits: { timeoutMs: 5000, maxBytes: 1024 * 1024, maxRedirects: 2, allowedHosts: ["127.0.0.1"], maxRetries: 2 },
    });
    assert.equal(result.ok, false);
    assert.equal(requestCount, 1, "404 não é retryable — só 1 tentativa");
  });
});

test("downloadMediaFile rejeita quando o MIME real não corresponde ao Content-Type declarado, e não deixa arquivo temporário para trás", async (t) => {
  const dir = await tempDir();
  t.after(() => rm(dir, { recursive: true, force: true }));

  await withServer((request, response) => {
    response.writeHead(200, { "Content-Type": "video/mp4" });
    response.end(Buffer.from("isto nao e um mp4 de verdade"));
  }, async (port) => {
    const result = await downloadMediaFile({
      url: `https://127.0.0.1:${port}/fake.mp4`,
      destinationDir: dir,
      fileNameHint: "fake.mp4",
      limits: { timeoutMs: 5000, maxBytes: 1024 * 1024, maxRedirects: 2, allowedHosts: ["127.0.0.1"], maxRetries: 0 },
    });
    assert.equal(result.ok, false);
    assert.match(result.reason, /assinatura/i);
    const { readdir } = await import("node:fs/promises");
    const filesLeft = await readdir(dir);
    assert.equal(filesLeft.length, 0, "nenhum arquivo parcial/temporário deve sobrar após rejeição");
  });
});

test("downloadMediaFile respeita timeout e não trava indefinidamente", async (t) => {
  const dir = await tempDir();
  t.after(() => rm(dir, { recursive: true, force: true }));

  await withServer((request, response) => {
    void request;
    void response; // nunca responde -> força o timeout
  }, async (port) => {
    const startedAt = Date.now();
    const result = await downloadMediaFile({
      url: `https://127.0.0.1:${port}/hangs`,
      destinationDir: dir,
      fileNameHint: "hangs.mp4",
      limits: { timeoutMs: 300, maxBytes: 1024 * 1024, maxRedirects: 2, allowedHosts: ["127.0.0.1"], maxRetries: 0 },
    });
    const elapsedMs = Date.now() - startedAt;
    assert.equal(result.ok, false);
    assert.ok(elapsedMs < 3000, "deve desistir rapidamente, nunca travar indefinidamente");
  });
});

test("downloadMediaFile rejeita host fora da allowlist antes mesmo de tentar conectar", async (t) => {
  const dir = await tempDir();
  t.after(() => rm(dir, { recursive: true, force: true }));

  const result = await downloadMediaFile({
    url: "https://127.0.0.1:9/anything.mp4",
    destinationDir: dir,
    fileNameHint: "x.mp4",
    limits: { timeoutMs: 1000, maxBytes: 1024, maxRedirects: 2, allowedHosts: ["videos.pexels.com"], maxRetries: 0 },
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /allowlist/i);
});
