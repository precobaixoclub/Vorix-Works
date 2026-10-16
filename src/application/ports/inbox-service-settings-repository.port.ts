import type { InboxServiceSettings } from "../../domain/inbox/service-settings.js";

/** Regras de atendimento por workspace. Ver `db/migrations/0151_inbox_service_rules.sql`. */
export type InboxServiceSettingsRepositoryPort = {
  /** `undefined` = workspace ainda sem configuração salva (o caso de uso aplica os padrões). */
  get(workspaceId: string): Promise<InboxServiceSettings | undefined>;
  upsert(settings: InboxServiceSettings): Promise<InboxServiceSettings>;
};
