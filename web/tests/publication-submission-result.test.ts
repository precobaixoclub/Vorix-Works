import { describe, expect, it, vi } from "vitest";
import { checkPublicationSubmission } from "../features/publishing-studio/submission-result";

describe("resultado real da publicação", () => {
  it("HTTP 200 com estado failed mostra o bloqueio de domínio em vez de sucesso", async () => {
    const detail = vi.fn().mockResolvedValue({ failures: [{ code: "url_ownership_unverified", message: "Please review our URL ownership verification rules" }] });
    await expect(checkPublicationSubmission("ws-1", { publicationId: "p1", state: "failed" }, detail)).rejects.toThrow("O domínio dos arquivos ainda não está validado no TikTok");
    expect(detail).toHaveBeenCalledOnce();
  });
  it("distingue publicação confirmada, agendamento e envio ainda em processamento", async () => {
    const detail = vi.fn();
    await expect(checkPublicationSubmission("ws-1", { publicationId: "p1", state: "published" }, detail)).resolves.toMatchObject({ status: "published", message: "Publicado." });
    await expect(checkPublicationSubmission("ws-1", { publicationId: "p1", state: "approved", scheduledAt: "2030-01-01T12:00:00Z" }, detail)).resolves.toMatchObject({ status: "scheduled" });
    await expect(checkPublicationSubmission("ws-1", { publicationId: "p1", state: "publishing" }, detail)).resolves.toMatchObject({ status: "processing" });
    expect(detail).not.toHaveBeenCalled();
  });
  it("usa a falha da última tentativa e explica as restrições de privacidade", async () => {
    await expect(checkPublicationSubmission("ws-1", { publicationId: "p1", state: "failed" }, async () => ({ failures: [], attempts: [{ failure: { code: "unaudited_client_can_only_post_to_private_accounts" } }] }))).rejects.toThrow("conta TikTok privada");
  });
  it("falha na consulta do detalhe nunca transforma failed em sucesso", async () => {
    await expect(checkPublicationSubmission("ws-1", { publicationId: "p1", state: "failed" }, async () => { throw new Error("offline"); })).rejects.toThrow("A publicação falhou");
  });
  it("resultado desconhecido orienta conferir o histórico antes de repetir o envio", async () => {
    await expect(checkPublicationSubmission("ws-1", { publicationId: "p1", state: "unknown_outcome" })).rejects.toThrow("evitar uma publicação duplicada");
    await expect(checkPublicationSubmission("ws-1", { publicationId: "p1", state: "unexpected" })).rejects.toThrow("Não foi possível confirmar");
  });
});
