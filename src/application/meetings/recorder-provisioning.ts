import { normalizeGoogleEmail, recorderHealthFailureStatus } from "../../domain/meetings/meeting.model.js";
import type { MeetingRepositoryPort, RecorderProvisioningSession } from "../ports/meeting-repository.port.js";
import { validateStorageState } from "./recorder-bot-admin.js";

/**
 * Login SELF-SERVICE de uma conta de gravação, do lado do host do recorder.
 *
 * Um navegador temporário e isolado (perfil próprio, descartado no fim) abre a página oficial de
 * login do Google; a TELA é transmitida ao cliente e os cliques/teclas dele voltam para o
 * navegador. Quem digita senha e MFA é o cliente, direto no Google:
 * - o Vorix NUNCA preenche, lê, registra ou guarda senha, código MFA ou recovery code — a entrada
 *   do teclado só é repassada ao navegador (sem log, sem banco, sem auditoria, sem telemetria);
 * - CAPTCHA/challenge do Google aparecem para o cliente resolver; nada é contornado;
 * - quando o Meet abre logado, só o ESTADO DE SESSÃO é capturado, cifrado e guardado; o perfil
 *   temporário é destruído.
 */

/** Entrada do visualizador (coordenadas no espaço do frame transmitido). */
export type ViewerInput =
  | { t: "mouse"; a: "move" | "down" | "up"; x: number; y: number; b?: "left" | "right" | "middle" }
  | { t: "wheel"; x: number; y: number; dy: number; dx?: number }
  | { t: "key"; a: "down" | "up"; key: string }
  | { t: "text"; v: string };

export type LoginDetection = { loggedIn: boolean; email?: string; challenge?: boolean };

export type RemoteLoginBrowser = {
  onFrame(listener: (frame: { jpeg: Buffer; width: number; height: number }) => void): void;
  dispatch(input: ViewerInput): Promise<void>;
  detect(): Promise<LoginDetection>;
  /** Estado de sessão (cookies + storage) em JSON — sai daqui direto para a cifragem. */
  storageState(): Promise<string>;
  close(): Promise<void>;
};

export type RemoteLoginBrowserFactory = {
  open(input: { sessionId: string; loginHint: string }): Promise<RemoteLoginBrowser>;
};

export type SessionHealthCheckPort = {
  check(storageStateJson: string): Promise<{ ok: boolean; reason?: string; details: Record<string, unknown> }>;
};

/** Canal com o visualizador (o WebSocket vindo da API). */
export type ViewerChannel = {
  sendFrame(frame: { jpeg: Buffer; width: number; height: number }): void;
  sendStatus(status: { s: RecorderProvisioningSession["status"] | "detected"; m?: string; code?: string }): void;
};

export type RecorderProvisioningDeps = {
  repository: MeetingRepositoryPort;
  browsers: RemoteLoginBrowserFactory;
  healthCheck: SessionHealthCheckPort;
  encryptSession: (plaintext: string) => string;
  workerId: string;
  now: () => Date;
  pollMs?: number;
  /** Visualizador ausente por mais que isto = cancelado (aba fechada). */
  viewerGraceMs?: number;
  log?: (message: string, details?: Record<string, unknown>) => void;
};

/** Valida uma entrada do visualizador: forma e limites. Nunca devolve/registra o conteúdo. */
export function parseViewerInput(raw: unknown): ViewerInput | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const num = (field: unknown, max = 10_000) => typeof field === "number" && Number.isFinite(field) && Math.abs(field) <= max;
  switch (value.t) {
    case "mouse":
      if (!["move", "down", "up"].includes(value.a as string) || !num(value.x) || !num(value.y)) return undefined;
      return { t: "mouse", a: value.a as "move" | "down" | "up", x: value.x as number, y: value.y as number, ...(["left", "right", "middle"].includes(value.b as string) ? { b: value.b as "left" } : {}) };
    case "wheel":
      if (!num(value.x) || !num(value.y) || !num(value.dy, 5_000)) return undefined;
      return { t: "wheel", x: value.x as number, y: value.y as number, dy: value.dy as number, ...(num(value.dx, 5_000) ? { dx: value.dx as number } : {}) };
    case "key":
      if (!["down", "up"].includes(value.a as string) || typeof value.key !== "string" || value.key.length === 0 || value.key.length > 32) return undefined;
      return { t: "key", a: value.a as "down" | "up", key: value.key };
    case "text":
      if (typeof value.v !== "string" || value.v.length === 0 || value.v.length > 512) return undefined;
      return { t: "text", v: value.v };
    default:
      return undefined;
  }
}

export type ActiveProvisioning = {
  session: RecorderProvisioningSession & { expectedGoogleEmail: string };
  /** Liga/desliga o visualizador. Só um por vez. */
  attachViewer(channel: ViewerChannel): void;
  detachViewer(channel: ViewerChannel): void;
  input(raw: unknown): void;
  cancel(reason: string): Promise<void>;
  done: Promise<RecorderProvisioningSession["status"]>;
};

/**
 * Executa UMA sessão de login reivindicada por este worker até terminar (concluída, falha,
 * expirada ou cancelada). O navegador é sempre fechado no fim.
 */
export function runProvisioningSession(deps: RecorderProvisioningDeps, session: RecorderProvisioningSession & { expectedGoogleEmail: string }): ActiveProvisioning {
  const pollMs = deps.pollMs ?? 2_000;
  const viewerGraceMs = deps.viewerGraceMs ?? 90_000;
  let viewer: ViewerChannel | undefined;
  let viewerLostAt: number | undefined = Date.now();
  let browser: RemoteLoginBrowser | undefined;
  let finished = false;
  let terminalStatus: RecorderProvisioningSession["status"] | undefined;
  let cancelRequested: string | undefined;
  let lastFrame: { jpeg: Buffer; width: number; height: number } | undefined;
  const expected = normalizeGoogleEmail(session.expectedGoogleEmail);

  const finish = async (status: RecorderProvisioningSession["status"], error?: { code: string; message: string }) => {
    if (finished) return status;
    finished = true;
    terminalStatus = status;
    await deps.repository.updateProvisioningSession({ sessionId: session.id, workerId: deps.workerId, status, ...(error ? { errorCode: error.code, errorMessage: error.message } : {}) }).catch(() => undefined);
    viewer?.sendStatus({ s: status, ...(error ? { code: error.code, m: error.message } : {}) });
    await browser?.close().catch(() => undefined);
    browser = undefined;
    lastFrame = undefined;
    deps.log?.("provisionamento encerrado", { sessionId: session.id, accountId: session.recorderAccountId, status, ...(error ? { code: error.code } : {}) });
    return status;
  };

  const done = (async (): Promise<RecorderProvisioningSession["status"]> => {
    try {
      browser = await deps.browsers.open({ sessionId: session.id, loginHint: expected ?? "" });
      browser.onFrame((frame) => {
        lastFrame = frame;
        viewer?.sendFrame(frame);
      });
      if (!await deps.repository.updateProvisioningSession({ sessionId: session.id, workerId: deps.workerId, status: "live" })) return await finish("cancelled");
      viewer?.sendStatus({ s: "live" });
      const expiresAt = Date.parse(session.expiresAt);
      while (!finished) {
        if (cancelRequested) return await finish("cancelled", { code: "CANCELLED", message: cancelRequested });
        if (Date.now() >= expiresAt) return await finish("expired", { code: "PROVISIONING_EXPIRED", message: "O tempo para conectar a conta acabou. Tente de novo." });
        if (viewerLostAt !== undefined && Date.now() - viewerLostAt > viewerGraceMs) return await finish("cancelled", { code: "VIEWER_GONE", message: "A janela de conexão foi fechada." });
        // Cancelada por fora (outra aba, conta removida)?
        const current = await deps.repository.getProvisioningSession({ sessionId: session.id });
        if (!current || ["cancelled", "expired", "failed", "completed"].includes(current.status)) return await finish(current?.status ?? "cancelled");

        const detection = await browser.detect().catch((): LoginDetection => ({ loggedIn: false }));
        if (detection.loggedIn) {
          viewer?.sendStatus({ s: "detected" });
          const detected = normalizeGoogleEmail(detection.email);
          if (!detected) return await finish("failed", { code: "GOOGLE_IDENTITY_UNVERIFIED", message: "Não foi possível confirmar a conta Google conectada. Tente novamente." });
          if (expected && detected !== expected) {
            return await finish("failed", { code: "WRONG_GOOGLE_ACCOUNT", message: `Você entrou com outra conta Google. Entre com ${expected}.` });
          }
          // Só o estado de sessão; validado, cifrado e guardado. Nada de senha passa por aqui.
          const storageState = validateStorageState(JSON.parse(await browser.storageState()));
          await browser.close().catch(() => undefined);
          browser = undefined;
          const health = await deps.healthCheck.check(storageState);
          if (cancelRequested) return await finish("cancelled");
          if (deps.now().getTime() >= expiresAt) return await finish("expired");
          const currentSession = await deps.repository.getProvisioningSession({ sessionId: session.id, tenantId: session.tenantId });
          if (!currentSession || ["cancelled", "expired", "failed"].includes(currentSession.status)) return await finish(currentSession?.status ?? "cancelled");
          const checkedAt = deps.now();
          const saved = await deps.repository.saveRecorderAccountSession({
            accountId: session.recorderAccountId,
            tenantId: session.tenantId,
            provisioningSessionId: session.id,
            workerId: deps.workerId,
            ...(health.ok ? { encryptedSessionState: deps.encryptSession(storageState) } : {}),
            status: health.ok ? "active" : recorderHealthFailureStatus(health.reason),
            health: { status: health.ok ? "healthy" : "invalid", method: "self_service_login", checkedAt: checkedAt.toISOString(), ...(health.reason ? { reason: health.reason } : {}), ...pickSafeHealth(health.details) },
            checkedAt,
            ...(detected ? { googleEmail: detected } : {}),
            ...(health.ok ? {} : { lastError: "Esta conta precisa ser reconectada." }),
          });
          if (!saved) return await finish("failed", { code: "RECORDER_ACCOUNT_UNAVAILABLE", message: "A conta de gravação foi removida ou está em uso." });
          return health.ok
            ? await finish("completed")
            : await finish("failed", { code: "INVALID_SESSION", message: "Esta conta precisa ser reconectada." });
        }
        await delay(pollMs);
      }
      return "cancelled";
    } catch (error) {
      deps.log?.("falha no provisionamento", { sessionId: session.id, code: "PROVISIONING_FAILED" });
      return await finish("failed", { code: "PROVISIONING_FAILED", message: "Não foi possível abrir o navegador de conexão. Tente de novo." });
    }
  })();

  return {
    session,
    attachViewer(channel) {
      if (viewer) throw new Error("VIEWER_ALREADY_ATTACHED");
      viewer = channel;
      viewerLostAt = undefined;
      channel.sendStatus({ s: terminalStatus ?? (browser ? "live" : "starting") });
      if (lastFrame) channel.sendFrame(lastFrame);
    },
    detachViewer(channel) {
      if (viewer === channel) {
        viewer = undefined;
        viewerLostAt = Date.now();
      }
    },
    input(raw) {
      const parsed = parseViewerInput(raw);
      // Repasse cego para o navegador; o conteúdo nunca é registrado.
      if (parsed && browser && !finished) void browser.dispatch(parsed).catch(() => undefined);
    },
    async cancel(reason) {
      cancelRequested = reason;
    },
    done,
  };
}

/** Só metadados não sensíveis do teste de saúde vão para o banco. */
function pickSafeHealth(details: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const key of ["finalHost", "checkedAt"]) if (typeof details[key] === "string") safe[key] = details[key];
  return safe;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
