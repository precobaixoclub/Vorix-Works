import type { MeetingRepositoryPort } from "../ports/meeting-repository.port.js";
import type { RecorderBotAccount } from "../../domain/meetings/meeting.model.js";

export type RecorderBotAdminDeps = {
  repository: MeetingRepositoryPort;
  encryptSession: (plaintext: string) => string;
  now: () => Date;
};

export async function provisionRecorderBot(
  deps: RecorderBotAdminDeps,
  input: { id: string; label: string; googleEmail: string; displayName?: string; storageState?: unknown },
): Promise<RecorderBotAccount> {
  const email = input.googleEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("RECORDER_BOT_INVALID_EMAIL");
  const label = input.label.trim();
  if (!label) throw new Error("RECORDER_BOT_INVALID_LABEL");
  let encryptedSessionState: string | undefined;
  if (input.storageState !== undefined) {
    const serialized = validateStorageState(input.storageState);
    encryptedSessionState = deps.encryptSession(serialized);
  }
  return deps.repository.upsertRecorderBot({
    id: input.id,
    label,
    googleEmail: email,
    displayName: input.displayName?.trim() || "Vorix Recorder",
    ...(encryptedSessionState ? { encryptedSessionState } : {}),
    // Uma sessao nova nunca vira ACTIVE sem ser aberta em meet.google.com pelo recorder host.
    status: "disabled",
  });
}

export async function requestRecorderBotHealthCheck(deps: RecorderBotAdminDeps, botId: string): Promise<RecorderBotAccount> {
  const bots = await deps.repository.listRecorderBots();
  const bot = bots.find((item) => item.id === botId);
  if (!bot) throw new Error("RECORDER_BOT_NOT_FOUND");
  if (!bot.hasEncryptedSessionState && !bot.credentialSecretRef) throw new Error("RECORDER_BOT_SESSION_REQUIRED");
  const updated = await deps.repository.updateRecorderBotStatus({ botId, status: "disabled", checkedAt: deps.now(), health: { requestedAt: deps.now().toISOString(), status: "pending" } });
  if (!updated) throw new Error("RECORDER_BOT_BUSY");
  return updated;
}

export async function disableRecorderBot(deps: RecorderBotAdminDeps, botId: string): Promise<RecorderBotAccount> {
  const account = await deps.repository.getRecorderAccount({ accountId: botId });
  if (account?.ownershipType === "customer_managed" && account.tenantId) {
    const result = await deps.repository.setRecorderAccountEnabled({ accountId: botId, tenantId: account.tenantId, enabled: false });
    if (!result || result === "busy") throw new Error("RECORDER_BOT_BUSY_OR_NOT_FOUND");
    return result;
  }
  const updated = await deps.repository.updateRecorderBotStatus({ botId, status: "disabled", lastError: undefined });
  if (!updated) throw new Error("RECORDER_BOT_BUSY_OR_NOT_FOUND");
  return updated;
}

export function validateStorageState(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("RECORDER_BOT_INVALID_STORAGE_STATE");
  const state = value as { cookies?: unknown; origins?: unknown };
  if (!Array.isArray(state.cookies)) throw new Error("RECORDER_BOT_INVALID_STORAGE_STATE");
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, "utf8") > 2 * 1024 * 1024) throw new Error("RECORDER_BOT_STORAGE_STATE_TOO_LARGE");
  return serialized;
}
