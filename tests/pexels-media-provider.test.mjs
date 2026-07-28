process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:https";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PexelsMediaProvider } from "../dist/infrastructure/media-providers/pexels-media-provider.js";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "media-download-security");
const TLS_OPTIONS = {
  cert: readFileSync(join(FIXTURES_DIR, "test-cert.pem")),
  key: readFileSync(join(FIXTURES_DIR, "test-key.pem")),
};

async function withPexelsServer(handler, run) {
  const server = createServer(TLS_OPTIONS, handler);
  await new Promise((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  const { port } = server.address();
  try {
    await run(`https://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
}

function withEnv(vars, fn) {
  const previous = {};
  for (const key of Object.keys(vars)) previous[key] = process.env[key];
  Object.assign(process.env, vars);
  return Promise.resolve(fn()).finally(() => {
    for (const key of Object.keys(vars)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });
}

function samplePexelsVideo(overrides = {}) {
  return {
    id: overrides.id ?? 1448735,
    width: 1080,
    height: 1920,
    duration: overrides.duration ?? 12,
    url: `https://www.pexels.com/video/${overrides.id ?? 1448735}/`,
    image: "https://images.pexels.com/videos/1448735/free-video-1448735.jpg",
    user: { id: 1, name: overrides.author ?? "Jane Filmmaker", url: "https://www.pexels.com/@jane" },
    video_files: overrides.video_files ?? [
      { id: 1, quality: "hd", file_type: "video/mp4", width: 1080, height: 1920, fps: 30, link: "https://videos.pexels.com/video-files/1448735/1448735-hd.mp4" },
    ],
  };
}

// ---------------------------------------------------------------------------------------------
// Credencial ausente — nunca falha silenciosamente, nunca baixa nada
// ---------------------------------------------------------------------------------------------

test("PexelsMediaProvider.isConfigured() é false sem MEDIA_PROVIDER_API_KEY", async () => {
  await withEnv({ MEDIA_PROVIDER: "pexels", MEDIA_PROVIDER_API_KEY: "" }, () => {
    const provider = new PexelsMediaProvider();
    assert.equal(provider.isConfigured(), false);
  });
});

test("PexelsMediaProvider.search() lança erro claro com instrução de configuração quando não configurado (nunca retorna array vazio silenciosamente)", async () => {
  await withEnv({ MEDIA_PROVIDER: "", MEDIA_PROVIDER_API_KEY: "" }, async () => {
    const provider = new PexelsMediaProvider();
    await assert.rejects(() => provider.search({ text: "casal" }), /MEDIA_PROVIDER_API_KEY/);
  });
});

test("PexelsMediaProvider.isConfigured() é true só quando MEDIA_PROVIDER=pexels E a chave está presente", async () => {
  await withEnv({ MEDIA_PROVIDER: "outro-provider", MEDIA_PROVIDER_API_KEY: "chave-real" }, () => {
    assert.equal(new PexelsMediaProvider().isConfigured(), false);
  });
  await withEnv({ MEDIA_PROVIDER: "pexels", MEDIA_PROVIDER_API_KEY: "chave-real" }, () => {
    assert.equal(new PexelsMediaProvider().isConfigured(), true);
  });
});

// ---------------------------------------------------------------------------------------------
// Busca real (contra servidor HTTPS local que imita a forma real da resposta do Pexels)
// ---------------------------------------------------------------------------------------------

test("PexelsMediaProvider.search() mapeia corretamente uma resposta real do Pexels para MediaProviderSearchHit[]", async (t) => {
  await withPexelsServer((request, response) => {
    assert.match(request.url, /^\/videos\/search\?/);
    assert.equal(request.headers.authorization, "chave-de-teste");
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ page: 1, per_page: 1, total_results: 1, videos: [samplePexelsVideo()] }));
  }, async (baseUrl) => {
    await withEnv({ MEDIA_PROVIDER: "pexels", MEDIA_PROVIDER_API_KEY: "chave-de-teste" }, async () => {
      const provider = new PexelsMediaProvider({ baseUrl });
      const hits = await provider.search({ text: "casal usando celular", orientation: "portrait" });
      assert.equal(hits.length, 1);
      assert.equal(hits[0].externalId, "1448735");
      assert.equal(hits[0].author, "Jane Filmmaker");
      assert.equal(hits[0].downloadUrl, "https://videos.pexels.com/video-files/1448735/1448735-hd.mp4");
      assert.equal(hits[0].license.allowsCommercialUse, true);
      assert.equal(hits[0].license.requiresAttribution, true, "consumo via API exige atribuição, mesmo a licença Pexels sendo livre para uso direto");
    });
  });
  void t;
});

test("PexelsMediaProvider.search() nunca inclui a API key na URL nem em nenhum campo do resultado", async () => {
  await withPexelsServer((request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ page: 1, per_page: 1, total_results: 1, videos: [samplePexelsVideo()] }));
  }, async (baseUrl) => {
    await withEnv({ MEDIA_PROVIDER: "pexels", MEDIA_PROVIDER_API_KEY: "segredo-nunca-deve-vazar" }, async () => {
      const provider = new PexelsMediaProvider({ baseUrl });
      const hits = await provider.search({ text: "casal" });
      const serialized = JSON.stringify(hits);
      assert.ok(!serialized.includes("segredo-nunca-deve-vazar"));
    });
  });
});

test("PexelsMediaProvider.search() devolve array vazio para resposta válida sem resultados (não é um erro)", async () => {
  await withPexelsServer((request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ page: 1, per_page: 15, total_results: 0, videos: [] }));
  }, async (baseUrl) => {
    await withEnv({ MEDIA_PROVIDER: "pexels", MEDIA_PROVIDER_API_KEY: "chave" }, async () => {
      const provider = new PexelsMediaProvider({ baseUrl });
      const hits = await provider.search({ text: "algo muito raro e especifico" });
      assert.deepEqual(hits, []);
    });
  });
});

test("PexelsMediaProvider.search() lança erro quando o provider responde com HTTP 500", async () => {
  await withPexelsServer((request, response) => {
    response.writeHead(500);
    response.end("internal error");
  }, async (baseUrl) => {
    await withEnv({ MEDIA_PROVIDER: "pexels", MEDIA_PROVIDER_API_KEY: "chave" }, async () => {
      const provider = new PexelsMediaProvider({ baseUrl });
      await assert.rejects(() => provider.search({ text: "casal" }), /HTTP 500/);
    });
  });
});

test("PexelsMediaProvider.search() lança erro claro quando a chave é rejeitada (HTTP 401)", async () => {
  await withPexelsServer((request, response) => {
    response.writeHead(401);
    response.end();
  }, async (baseUrl) => {
    await withEnv({ MEDIA_PROVIDER: "pexels", MEDIA_PROVIDER_API_KEY: "chave-invalida" }, async () => {
      const provider = new PexelsMediaProvider({ baseUrl });
      await assert.rejects(() => provider.search({ text: "casal" }), /401|rejeitada/);
    });
  });
});

test("PexelsMediaProvider.search() lança erro claro em rate limit (HTTP 429)", async () => {
  await withPexelsServer((request, response) => {
    response.writeHead(429, { "X-Ratelimit-Reset": "1700000000" });
    response.end();
  }, async (baseUrl) => {
    await withEnv({ MEDIA_PROVIDER: "pexels", MEDIA_PROVIDER_API_KEY: "chave" }, async () => {
      const provider = new PexelsMediaProvider({ baseUrl });
      await assert.rejects(() => provider.search({ text: "casal" }), /429|limite/i);
    });
  });
});

test("PexelsMediaProvider.search() filtra candidatos abaixo de minWidth/minHeight/minDurationSeconds mesmo que o provider os devolva", async () => {
  await withPexelsServer((request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      page: 1, per_page: 2, total_results: 2,
      videos: [
        samplePexelsVideo({ id: 1, duration: 0.5 }),
        samplePexelsVideo({ id: 2, duration: 10 }),
      ],
    }));
  }, async (baseUrl) => {
    await withEnv({ MEDIA_PROVIDER: "pexels", MEDIA_PROVIDER_API_KEY: "chave" }, async () => {
      const provider = new PexelsMediaProvider({ baseUrl });
      const hits = await provider.search({ text: "casal", minDurationSeconds: 2 });
      assert.equal(hits.length, 1);
      assert.equal(hits[0].externalId, "2");
    });
  });
});

// ---------------------------------------------------------------------------------------------
// getById — usado por --media-acquire <resultadoId>
// ---------------------------------------------------------------------------------------------

test("PexelsMediaProvider.getById() rebusca um resultado específico com link de download fresco", async () => {
  await withPexelsServer((request, response) => {
    assert.equal(request.url, "/videos/videos/1448735");
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(samplePexelsVideo()));
  }, async (baseUrl) => {
    await withEnv({ MEDIA_PROVIDER: "pexels", MEDIA_PROVIDER_API_KEY: "chave" }, async () => {
      const provider = new PexelsMediaProvider({ baseUrl });
      const hit = await provider.getById("1448735");
      assert.equal(hit.externalId, "1448735");
    });
  });
});

test("PexelsMediaProvider.getById() devolve undefined (não lança) quando o id não existe mais (HTTP 404)", async () => {
  await withPexelsServer((request, response) => {
    response.writeHead(404);
    response.end();
  }, async (baseUrl) => {
    await withEnv({ MEDIA_PROVIDER: "pexels", MEDIA_PROVIDER_API_KEY: "chave" }, async () => {
      const provider = new PexelsMediaProvider({ baseUrl });
      const hit = await provider.getById("999999999");
      assert.equal(hit, undefined);
    });
  });
});
