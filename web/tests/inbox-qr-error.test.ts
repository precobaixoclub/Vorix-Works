import { describe, expect, it } from "vitest";
import { ApiError } from "../lib/api-error";
import { humanizeQrError } from "../features/inbox/qr-error";

/**
 * Fase 10 (Pre-Pilot Hardening) — `humanizeQrError` é o único ponto de tradução entre o erro cru
 * (backend/WuzAPI) e o que o usuário do onboarding vê. Nunca deve deixar passar `error.message` da
 * API diretamente (payload técnico), só os textos fixos abaixo.
 */
describe("humanizeQrError", () => {
  it("409 (conexão ainda iniciando no gateway) vira uma mensagem de 'tente de novo em instantes'", () => {
    const err = new ApiError("INBOX_CONNECTION_NOT_READY", "a conexão ainda não iniciou a sessão no gateway", 409, true);
    expect(humanizeQrError(err)).toBe("A conexão ainda está iniciando no gateway. Aguarde alguns segundos e tente de novo.");
  });

  it("503 (serviço indisponível) vira uma mensagem de indisponibilidade", () => {
    const err = new ApiError("SOME_UPSTREAM_ERROR", "connect ECONNREFUSED 127.0.0.1:8080", 503, true);
    expect(humanizeQrError(err)).toBe("O serviço de WhatsApp está indisponível no momento.");
  });

  it("statusCode 0 (rede fora do ar, mesmo código usado por NETWORK_ERROR no apiClient) também vira mensagem de indisponibilidade", () => {
    const err = new ApiError("NETWORK_ERROR", "Não foi possível conectar à API do Vorix. Ela está rodando?", 0, true);
    expect(humanizeQrError(err)).toBe("O serviço de WhatsApp está indisponível no momento.");
  });

  it("qualquer outro ApiError (ex.: 422/500 genérico) cai no texto genérico, nunca expõe error.message cru", () => {
    const err = new ApiError("SOME_INTERNAL_CODE", "stack trace interno sensível que nunca deveria aparecer pro usuário", 500, false);
    const result = humanizeQrError(err);
    expect(result).toBe("Não foi possível gerar o QR Code.");
    expect(result).not.toContain("stack trace");
  });

  it("erro que não é ApiError (ex.: TypeError genuíno) também cai no texto genérico", () => {
    expect(humanizeQrError(new TypeError("boom"))).toBe("Não foi possível gerar o QR Code.");
    expect(humanizeQrError("string solta")).toBe("Não foi possível gerar o QR Code.");
    expect(humanizeQrError(undefined)).toBe("Não foi possível gerar o QR Code.");
  });
});
