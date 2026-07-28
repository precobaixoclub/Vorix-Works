import test from "node:test";
import assert from "node:assert/strict";
import { MetaInstagramSocialPublisherAdapter } from "../dist/infrastructure/social-networks/index.js";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createFakeFetch(handlers) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: url.toString(), method: init.method ?? "GET", body: init.body });
    for (const handler of handlers) {
      if (handler.match(url.toString(), init)) {
        return handler.respond(url.toString(), init);
      }
    }
    throw new Error(`Nenhum handler configurado para: ${init.method ?? "GET"} ${url}`);
  };
  return { fetchImpl, calls };
}

function createDraft(overrides = {}) {
  return {
    channel: "instagram",
    caption: "Sem taxa sobre os presentes.",
    cta: "Criar meu site agora: rumoaoaltar.com.br",
    hashtags: ["RumoAoAltar", "ListaDePresentes"],
    assetUris: ["https://cdn.example.com/arte-taxa-zero.png"],
    ...overrides,
  };
}

test("publish() publica uma imagem única com sucesso e retorna o permalink", async () => {
  const { fetchImpl, calls } = createFakeFetch([
    {
      match: (url, init) => url.endsWith("/17841400000000000/media") && init.method === "POST",
      respond: () => jsonResponse({ id: "creation-123" }),
    },
    {
      match: (url) => url.includes("/creation-123?") && url.includes("status_code"),
      respond: () => jsonResponse({ id: "creation-123", status_code: "FINISHED" }),
    },
    {
      match: (url) => url.endsWith("/17841400000000000/media_publish") ,
      respond: () => jsonResponse({ id: "media-456" }),
    },
    {
      match: (url) => url.includes("/media-456?") && url.includes("permalink"),
      respond: () => jsonResponse({ id: "media-456", permalink: "https://www.instagram.com/p/ABC123/" }),
    },
  ]);

  const adapter = new MetaInstagramSocialPublisherAdapter({
    accessToken: "token-abc",
    instagramBusinessAccountId: "17841400000000000",
    fetchImpl,
  });

  const result = await adapter.publish(createDraft());

  assert.equal(result.status, "published");
  assert.equal(result.externalId, "media-456");
  assert.equal(result.url, "https://www.instagram.com/p/ABC123/");
  assert.equal(calls.filter((c) => c.method === "POST").length, 2);
});

test("publish() monta um carrossel quando há mais de um assetUri", async () => {
  const createdChildren = [];
  const { fetchImpl } = createFakeFetch([
    {
      match: (url, init) =>
        url.endsWith("/ig-account/media") && init.method === "POST" && String(init.body).includes("is_carousel_item"),
      respond: (_url, init) => {
        const id = `child-${createdChildren.length + 1}`;
        createdChildren.push(id);
        return jsonResponse({ id });
      },
    },
    {
      match: (url, init) =>
        url.endsWith("/ig-account/media") && init.method === "POST" && String(init.body).includes("CAROUSEL"),
      respond: (_url, init) => {
        const params = new URLSearchParams(init.body.toString());
        assert.equal(params.get("children"), createdChildren.join(","));
        return jsonResponse({ id: "carousel-creation-1" });
      },
    },
    {
      match: (url) => url.includes("/carousel-creation-1?") && url.includes("status_code"),
      respond: () => jsonResponse({ id: "carousel-creation-1", status_code: "FINISHED" }),
    },
    {
      match: (url) => url.endsWith("/ig-account/media_publish"),
      respond: () => jsonResponse({ id: "carousel-media-1" }),
    },
    {
      match: (url) => url.includes("/carousel-media-1?"),
      respond: () => jsonResponse({ id: "carousel-media-1", permalink: "https://www.instagram.com/p/CAR1/" }),
    },
  ]);

  const adapter = new MetaInstagramSocialPublisherAdapter({
    accessToken: "token-abc",
    instagramBusinessAccountId: "ig-account",
    fetchImpl,
  });

  const result = await adapter.publish(
    createDraft({ assetUris: ["https://cdn.example.com/1.png", "https://cdn.example.com/2.png"] }),
  );

  assert.equal(result.status, "published");
  assert.equal(result.externalId, "carousel-media-1");
  assert.equal(createdChildren.length, 2);
});

test("publish() monta container de vídeo quando mediaType é video", async () => {
  const { fetchImpl, calls } = createFakeFetch([
    {
      match: (url, init) => url.endsWith("/ig-account/media") && init.method === "POST",
      respond: (_url, init) => {
        const params = new URLSearchParams(init.body.toString());
        assert.equal(params.get("media_type"), "REELS");
        assert.equal(params.get("video_url"), "https://cdn.example.com/final-video.mp4");
        assert.equal(params.get("cover_url"), "https://cdn.example.com/thumb.jpg");
        return jsonResponse({ id: "video-creation-1" });
      },
    },
    {
      match: (url) => url.includes("/video-creation-1?") && url.includes("status_code"),
      respond: () => jsonResponse({ id: "video-creation-1", status_code: "FINISHED" }),
    },
    {
      match: (url) => url.endsWith("/ig-account/media_publish"),
      respond: () => jsonResponse({ id: "video-media-1" }),
    },
    {
      match: (url) => url.includes("/video-media-1?"),
      respond: () => jsonResponse({ id: "video-media-1", permalink: "https://www.instagram.com/reel/VID1/" }),
    },
  ]);

  const adapter = new MetaInstagramSocialPublisherAdapter({
    accessToken: "token-abc",
    instagramBusinessAccountId: "ig-account",
    fetchImpl,
  });

  const result = await adapter.publish(
    createDraft({
      mediaType: "video",
      assetUris: ["https://cdn.example.com/final-video.mp4"],
      videoUri: "https://cdn.example.com/final-video.mp4",
      thumbnailUri: "https://cdn.example.com/thumb.jpg",
      mimeType: "video/mp4",
      duration: 30,
    }),
  );

  assert.equal(result.status, "published");
  assert.equal(result.externalId, "video-media-1");
  assert.equal(result.metadata.mediaType, "video");
  assert.equal(calls.filter((c) => c.method === "POST").length, 2);
  assert.deepEqual(adapter.capabilities.supportedMediaTypes.instagram, ["image", "carousel", "video"]);
});

test("publish() retorna failed sem chamar a API quando não há assetUris", async () => {
  const { fetchImpl, calls } = createFakeFetch([]);
  const adapter = new MetaInstagramSocialPublisherAdapter({
    accessToken: "token-abc",
    instagramBusinessAccountId: "ig-account",
    fetchImpl,
  });

  const result = await adapter.publish(createDraft({ assetUris: [] }));

  assert.equal(result.status, "failed");
  assert.equal(result.error?.code, "MISSING_ASSET");
  assert.equal(calls.length, 0);
});

test("publish() rejeita canais diferentes de instagram sem chamar a API", async () => {
  const { fetchImpl, calls } = createFakeFetch([]);
  const adapter = new MetaInstagramSocialPublisherAdapter({
    accessToken: "token-abc",
    instagramBusinessAccountId: "ig-account",
    fetchImpl,
  });

  const result = await adapter.publish(createDraft({ channel: "facebook" }));

  assert.equal(result.status, "failed");
  assert.equal(result.error?.code, "UNSUPPORTED_CHANNEL");
  assert.equal(calls.length, 0);
});

test("publish() mapeia erro da Graph API (token inválido) como não repetível", async () => {
  const { fetchImpl } = createFakeFetch([
    {
      match: (url, init) => init.method === "POST",
      respond: () =>
        jsonResponse(
          {
            error: {
              message: "Invalid OAuth access token.",
              type: "OAuthException",
              code: 190,
              fbtrace_id: "abc123",
            },
          },
          400,
        ),
    },
  ]);

  const adapter = new MetaInstagramSocialPublisherAdapter({
    accessToken: "token-invalido",
    instagramBusinessAccountId: "ig-account",
    fetchImpl,
  });

  const result = await adapter.publish(createDraft());

  assert.equal(result.status, "failed");
  assert.equal(result.error?.code, "META_190");
  assert.equal(result.error?.retryable, false);
});

test("publish() mapeia erro de rate limit da Graph API como repetível", async () => {
  const { fetchImpl } = createFakeFetch([
    {
      match: (url, init) => init.method === "POST",
      respond: () =>
        jsonResponse(
          { error: { message: "Application request limit reached", type: "OAuthException", code: 17 } },
          400,
        ),
    },
  ]);

  const adapter = new MetaInstagramSocialPublisherAdapter({
    accessToken: "token-abc",
    instagramBusinessAccountId: "ig-account",
    fetchImpl,
  });

  const result = await adapter.publish(createDraft());

  assert.equal(result.status, "failed");
  assert.equal(result.error?.code, "META_17");
  assert.equal(result.error?.retryable, true);
});

test("schedule() nunca finge suporte a agendamento nativo", async () => {
  const { fetchImpl, calls } = createFakeFetch([]);
  const adapter = new MetaInstagramSocialPublisherAdapter({
    accessToken: "token-abc",
    instagramBusinessAccountId: "ig-account",
    fetchImpl,
  });

  const result = await adapter.schedule(createDraft({ scheduledAt: "2026-08-01T12:00:00.000Z" }));

  assert.equal(result.status, "failed");
  assert.equal(result.error?.code, "SCHEDULING_NOT_SUPPORTED");
  assert.equal(calls.length, 0);
  assert.equal(adapter.capabilities.supportsScheduling, false);
});

test("construtor exige accessToken e instagramBusinessAccountId", () => {
  assert.throws(() => new MetaInstagramSocialPublisherAdapter({ accessToken: "", instagramBusinessAccountId: "x" }));
  assert.throws(() => new MetaInstagramSocialPublisherAdapter({ accessToken: "x", instagramBusinessAccountId: "" }));
});
