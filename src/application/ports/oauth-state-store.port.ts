/**
 * Estado OAuth persistente e compartilhado (sobrevive a restart, deploy e múltiplas instâncias).
 * O token `state` em si nunca é guardado — só o hash; uso único, expiração curta, vinculado ao
 * tenant/usuário/provider que iniciou o fluxo.
 */
export type OAuthStateRecord = {
  provider: string;
  tenantId: string;
  workspaceId: string;
  userId?: string;
  network?: string;
  /** Caminho interno de retorno (sempre relativo, validado ao criar). */
  returnPath?: string;
  /** Verificador PKCE: necessário para trocar o `code`; descartado no consumo. */
  codeVerifier?: string;
  createdAt: string;
  expiresAt: string;
};

export type OAuthStateConsumeResult =
  | { ok: true; record: OAuthStateRecord }
  | { ok: false; reason: "NOT_FOUND" | "EXPIRED" | "ALREADY_CONSUMED" | "PROVIDER_MISMATCH" | "TENANT_MISMATCH" | "USER_MISMATCH" };

export type OAuthStateStorePort = {
  create(state: string, record: OAuthStateRecord): Promise<void>;
  /**
   * Consome ATOMICAMENTE (uso único). Mesmo uma tentativa com tenant/usuário errado queima o state:
   * um state vazado não pode ser testado várias vezes.
   */
  consume(input: { state: string; provider: string; now: string; tenantId?: string; userId?: string }): Promise<OAuthStateConsumeResult>;
  purgeExpired(now: string): Promise<number>;
};

/** Só caminhos internos relativos (nunca URL externa / protocol-relative). */
export function safeReturnPath(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\") || /[\r\n]/.test(value) || value.length > 300) return undefined;
  return value;
}
