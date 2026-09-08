import test from "node:test";
import assert from "node:assert/strict";

import { WuzApiClient } from "../dist/infrastructure/messaging/wuzapi/wuzapi-client.js";
import { WuzApiMessagingProvider } from "../dist/infrastructure/messaging/wuzapi/wuzapi-messaging-provider.js";
import { FakeMessagingProvider } from "../dist/infrastructure/messaging/fake-messaging-provider.js";
import { MESSAGING_MEDIA_KINDS } from "../dist/application/ports/messaging-provider.port.js";

/**
 * SaaS Commercialization — Fase 6 (Omnichannel). `MessagingProviderCapabilities` é lido pela
 * aplicação/UI ANTES de agir (ex.: só mostrar o fluxo de QR se `supportsQrConnect`), nunca
 * descoberto só por um erro do provider em runtime — mesmo papel de `SocialPublisherPort.
 * capabilities`. `FakeMessagingProvider` precisa espelhar EXATAMENTE `WuzApiMessagingProvider`
 * (o duplo de teste nunca pode divergir do adapter real que substitui nos testes).
 */

test("WuzApiMessagingProvider.capabilities: WhatsApp suporta QR-connect e todo tipo de mídia deste port", () => {
  const provider = new WuzApiMessagingProvider(new WuzApiClient({ baseUrl: "http://localhost:0", adminToken: "test" }));
  assert.equal(provider.capabilities.supportsQrConnect, true);
  assert.deepEqual([...provider.capabilities.supportedMediaKinds].sort(), [...MESSAGING_MEDIA_KINDS].sort());
});

test("FakeMessagingProvider.capabilities: espelha exatamente WuzApiMessagingProvider", () => {
  const real = new WuzApiMessagingProvider(new WuzApiClient({ baseUrl: "http://localhost:0", adminToken: "test" }));
  const fake = new FakeMessagingProvider();
  assert.deepEqual(fake.capabilities, real.capabilities);
});

test("capabilities é um vocabulário fechado — supportedMediaKinds nunca sai de MESSAGING_MEDIA_KINDS", () => {
  const provider = new WuzApiMessagingProvider(new WuzApiClient({ baseUrl: "http://localhost:0", adminToken: "test" }));
  for (const kind of provider.capabilities.supportedMediaKinds) {
    assert.ok(MESSAGING_MEDIA_KINDS.includes(kind), `"${kind}" não está no vocabulário fechado`);
  }
});
