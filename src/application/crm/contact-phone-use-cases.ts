import { classifyContactPhone, type ContactPhoneSource, type ContactPhoneSummary } from "../../domain/crm/contact-phone.js";

/**
 * Telefones e manutenção automática do diretório: registros técnicos só com LID aguardam
 * resolução fora da lista, preservando contatos e vínculos. Os comandos antigos de limpeza
 * continuam disponíveis para compatibilidade, mas não participam da manutenção automática.
 */
export type ContactPhoneRow = { contactId: string; name: string; hasDeals: boolean; hasProposals: boolean; preserveInDirectory?: boolean } & ContactPhoneSource;

export type ContactPhoneRepositoryPort = {
  listPhoneRows(input: { tenantId: string; workspaceId: string; contactIds?: readonly string[] }): Promise<ContactPhoneRow[]>;
  deleteContacts(input: { tenantId: string; workspaceId: string; contactIds: readonly string[] }): Promise<number>;
};

export type ContactPhoneDeps = { contactPhoneRepository: ContactPhoneRepositoryPort };

export type ContactDirectoryMaintenancePort = ContactPhoneRepositoryPort & {
  listDirectoryScopes(): Promise<{ tenantId: string; workspaceId: string }[]>;
  setPhoneResolutionStates(input: { tenantId: string; workspaceId: string; states: { contactId: string; pending: boolean }[] }): Promise<number>;
};

/** Suspende a exibição dos registros só-LID; conserva todos os dados e restaura quando o telefone chega. */
export async function reconcileContactDirectory(repository: ContactDirectoryMaintenancePort, input: { tenantId: string; workspaceId: string }): Promise<number> {
  const rows = await repository.listPhoneRows(input);
  const protectedIds = new Set(rows.filter(row => row.hasDeals || row.hasProposals || row.preserveInDirectory).map(row => row.contactId));
  const summaries = summarize(rows);
  return repository.setPhoneResolutionStates({ ...input, states: summaries.map(summary => ({ contactId: summary.contactId, pending: summary.kind === "lid_only" && !protectedIds.has(summary.contactId) })) });
}

function summarize(rows: readonly ContactPhoneRow[]) {
  const byContact = new Map<string, { name: string; hasDeals: boolean; hasProposals: boolean; sources: ContactPhoneSource[] }>();
  for (const row of rows) {
    const entry = byContact.get(row.contactId) ?? { name: row.name, hasDeals: row.hasDeals, hasProposals: row.hasProposals, sources: [] };
    entry.sources.push({ phoneNormalized: row.phoneNormalized, whatsappPn: row.whatsappPn, whatsappLid: row.whatsappLid, manualExternalId: row.manualExternalId });
    byContact.set(row.contactId, entry);
  }
  return [...byContact.entries()].map(([contactId, entry]) => ({ contactId, name: entry.name, hasDeals: entry.hasDeals, hasProposals: entry.hasProposals, ...classifyContactPhone(entry.sources) }));
}

/** Celular de cada contato (para mostrar na lista). */
export async function getContactPhones(deps: ContactPhoneDeps, input: { tenantId: string; workspaceId: string; contactIds: readonly string[] }): Promise<Record<string, ContactPhoneSummary>> {
  if (input.contactIds.length === 0) return {};
  const summaries = summarize(await deps.contactPhoneRepository.listPhoneRows(input));
  return Object.fromEntries(summaries.map((item) => [item.contactId, { kind: item.kind, ...(item.phone ? { phone: item.phone } : {}) }]));
}

export type LidCleanupPreview = {
  /** Contatos só com LID, sem venda nem proposta — serão removidos. */
  removable: { contactId: string; name: string }[];
  /** Contatos só com LID que têm oportunidade ou proposta — ficam para revisão manual. */
  protected: { contactId: string; name: string; reason: string }[];
  withPhone: number;
  withoutAnyNumber: number;
};

export async function previewLidCleanup(deps: ContactPhoneDeps, input: { tenantId: string; workspaceId: string }): Promise<LidCleanupPreview> {
  const summaries = summarize(await deps.contactPhoneRepository.listPhoneRows(input));
  const lid = summaries.filter((item) => item.kind === "lid_only");
  return {
    removable: lid.filter((item) => !item.hasDeals && !item.hasProposals).map((item) => ({ contactId: item.contactId, name: item.name })),
    protected: lid.filter((item) => item.hasDeals || item.hasProposals).map((item) => ({ contactId: item.contactId, name: item.name, reason: item.hasDeals ? "tem oportunidade" : "tem proposta" })),
    withPhone: summaries.filter((item) => item.kind === "phone").length,
    withoutAnyNumber: summaries.filter((item) => item.kind === "none").length,
  };
}

/** Remove os contatos só-LID sem venda/proposta. Recalcula na hora (nunca confia na prévia do navegador). */
export async function runLidCleanup(deps: ContactPhoneDeps, input: { tenantId: string; workspaceId: string; role: string }): Promise<{ removed: number; protected: number }> {
  if (input.role !== "owner" && input.role !== "admin") throw new Error("CONTACT_CLEANUP_FORBIDDEN: só o dono ou um administrador pode remover contatos em lote.");
  const preview = await previewLidCleanup(deps, input);
  const removed = preview.removable.length
    ? await deps.contactPhoneRepository.deleteContacts({ tenantId: input.tenantId, workspaceId: input.workspaceId, contactIds: preview.removable.map((item) => item.contactId) })
    : 0;
  return { removed, protected: preview.protected.length };
}
