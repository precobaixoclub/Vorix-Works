import { createContact, linkContactIdentity, type ContactUseCaseDeps } from "../crm/contact-use-cases.js";
import type { InboxContactRepositoryPort } from "../ports/inbox-contact-repository.port.js";
import type { InboxMessageRepositoryPort } from "../ports/inbox-message-repository.port.js";
import type { InboxContact } from "../../domain/inbox/inbox.model.js";

/**
 * Jornada Comercial Integrada, Fase 1 — a ÚNICA ponte que cria/vincula automaticamente um `Contact`
 * do CRM a partir de um `InboxContact` do WhatsApp. Vive FORA de `/domain/crm/`, `/application/crm/`,
 * `/domain/inbox/` e `/application/inbox/` de propósito: `scripts/check-crm-isolation.mjs` proíbe
 * cada bounded context de importar o outro DIRETAMENTE, mas nunca proibiu — nem poderia, sem
 * impedir qualquer integração — um orquestrador NEUTRO que depende dos dois. Este módulo é esse
 * orquestrador: a única peça do sistema que enxerga Inbox e CRM ao mesmo tempo.
 *
 * Princípio de identidade preservado (ver auditoria, `docs/vorix-auditoria-jornada-comercial-integrada.md`):
 * PESSOA (Contact) ≠ CHAT (InboxConversation) ≠ IDENTIDADE TÉCNICA (telefone/LID/PN/JID, que
 * continua vivendo só em `inbox_contacts`, nunca replicada pro CRM). O telefone continua sendo o
 * pivô comercial da PESSOA — mas resolvido e deduplicado inteiramente pelo Inbox (`upsertByPhone`,
 * `unique(workspace_id, phone_normalized)`) ANTES desta ponte nunca precisar decidir nada sobre
 * telefone/LID/PN por conta própria.
 *
 * Convenção de identidade — reaproveitada, nunca reinventada: a MESMA convenção já usada pelo
 * vínculo manual existente ("Vincular ao CRM", `crm-panel.tsx`/`handleLink`) — `ContactIdentity`
 * (`channel: "whatsapp"`, `externalId: <InboxContact.id>`) — nunca o telefone cru como `externalId`
 * (isso criaria uma SEGUNDA convenção divergente da já em produção, quebrando consistência entre
 * contatos vinculados manualmente e automaticamente).
 */

/** Sinal mínimo de relacionamento real (seção 5 do pedido) — o MESMO limiar que já disparava o
 * destaque visual "Vorix encontrou uma oportunidade" em `crm-panel.tsx` (`messageCount >= 3`), só
 * que agora avaliado no backend, pra toda conversa, mesmo que ninguém abra a tela. Evita que uma
 * mensagem isolada (número errado, spam, "oi" solto) vire lixo permanente no CRM — ver Opção C da
 * auditoria (seção 6). */
export const MIN_MESSAGES_FOR_AUTO_CRM_CONTACT = 3;

/** Origem distinguível (seção 7 do pedido) — nunca a mesma string do vínculo manual (`"whatsapp"`),
 * pra relatórios/automações poderem filtrar "criado deliberadamente" vs. "capturado
 * automaticamente" sem ambiguidade (ver `conditionsMatch`/`condition.field === "origin"` em
 * `automation-use-cases.ts` — uma regra de automação escopada a `origin === "whatsapp"` NUNCA passa
 * a disparar sozinha pra estes; é opt-in, nunca silencioso). */
export const AUTO_CONTACT_ORIGIN = "whatsapp_auto";

export type InboxCrmBridgeDeps = {
  inboxContactRepository: InboxContactRepositoryPort;
  inboxMessageRepository: InboxMessageRepositoryPort;
  /** Deps do CRM de verdade (contactRepository/contactIdentityRepository/timelineEventRepository) —
   * `automation` deliberadamente OMITIDO nesta fase (ver `docs/vorix-jornada-comercial-fase1-contatos.md`,
   * seção "Automações": decisão consciente, não omissão silenciosa — o evento `contact_created`
   * ainda é gravado na timeline, só não dispara regras de automação para contatos auto-capturados
   * nesta fase 1; habilitar depois é só passar `automation` aqui). */
  contact: ContactUseCaseDeps;
};

export type EnsureCrmContactResult = { contactId: string; created: boolean };

/**
 * Idempotente e segura pra chamar mais de uma vez pro MESMO `InboxContact` (retries, reentrega de
 * evento, corrida entre a ponte automática e um clique manual simultâneo em "Vincular ao CRM") —
 * nunca cria um segundo `Contact` pra quem já tem um.
 *
 * Ordem de resolução (seção 6 do pedido, "Contato automático"):
 * 1. `InboxContact` já vinculado? Devolve o vínculo existente, no-op.
 * 2. Já existe uma `ContactIdentity(whatsapp, <inboxContactId>)` de uma corrida anterior (ex.: duas
 *    mensagens quase simultâneas do mesmo número, cada uma dececionando a mesma ponte em paralelo)?
 *    Reusa o `Contact` dela — nunca cria um duplicado.
 * 3. Senão, cria um `Contact` novo (`origin: AUTO_CONTACT_ORIGIN`) e a `ContactIdentity`
 *    correspondente.
 *
 * NUNCA funde/sobrescreve silenciosamente (seção 10 do pedido): se o passo 3 esbarrar num conflito
 * real (a identidade que acabamos de tentar criar já pertence a OUTRO contato — só possível numa
 * corrida bem apertada, já que acabamos de checar o passo 2), o conflito é logado e a ligação
 * `inbox_contacts.contact_id` segue o DONO real da identidade, nunca o `Contact` recém-criado (que
 * fica órfão, sem `ContactIdentity` — inofensivo, nunca aparece em nenhuma listagem por identidade).
 */
export async function ensureCrmContactForInboxContact(
  deps: InboxCrmBridgeDeps,
  input: { tenantId: string; workspaceId: string; inboxContactId: string; contactName?: string; contactPhone?: string },
): Promise<EnsureCrmContactResult | undefined> {
  const inboxContact = await deps.inboxContactRepository.getById(input.inboxContactId);
  if (!inboxContact) return undefined;
  // Tombstone (migration 0118) — nunca vincula um InboxContact que já foi fundido em outro; quem
  // chama deveria estar operando sobre o vencedor da fusão, não o perdedor.
  if (inboxContact.mergeStatus === "merged") return undefined;
  if (inboxContact.crmContactId) return { contactId: inboxContact.crmContactId, created: false };

  const existingIdentity = await deps.contact.contactIdentityRepository.findByChannelAndExternalId("whatsapp", input.inboxContactId);
  if (existingIdentity) {
    await deps.inboxContactRepository.linkCrmContact(input.inboxContactId, existingIdentity.contactId);
    return { contactId: existingIdentity.contactId, created: false };
  }

  const displayName = input.contactName?.trim() || input.contactPhone?.trim() || "Contato do WhatsApp";
  const contact = await createContact(deps.contact, {
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    name: displayName,
    origin: AUTO_CONTACT_ORIGIN,
  });

  const { identity, conflictsWithAnotherContact } = await linkContactIdentity(deps.contact, {
    contactId: contact.id,
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    channel: "whatsapp",
    externalId: input.inboxContactId,
  });

  // Corrida real (duas mensagens quase simultâneas do mesmo número, cada uma nesta função ao mesmo
  // tempo) — o vencedor já ganhou a `ContactIdentity`; nunca sobrescrevemos com o `Contact` que
  // acabamos de criar aqui (que fica órfão, sem identidade — nunca aparece em nada por busca de
  // canal, e não há motivo pra apagá-lo: um `Contact` sem `ContactIdentity` é um estado válido,
  // igual a qualquer lead criado manualmente sem WhatsApp, seção 24 do pedido).
  const resolvedContactId = conflictsWithAnotherContact ? identity.contactId : contact.id;
  if (conflictsWithAnotherContact) {
    console.warn(
      `[commercial-bridge] corrida detectada ao vincular InboxContact "${input.inboxContactId}" — identidade já pertencia ao Contact "${identity.contactId}"; usando o vencedor da corrida, Contact "${contact.id}" fica órfão (sem identidade, nunca fundido automaticamente).`,
    );
  }

  await deps.inboxContactRepository.linkCrmContact(input.inboxContactId, resolvedContactId);
  return { contactId: resolvedContactId, created: !conflictsWithAnotherContact };
}

/**
 * O GATILHO (seção 5 do pedido) — chamado a cada mensagem inbound de conversa DIRETA (nunca grupo:
 * grupo nunca tem `InboxContact`, então nunca chega a ser chamado pra ele — ver
 * `registerInboundMessage`, que só resolve `contact` quando `!input.isGroup`). Best-effort por
 * design: quem chama (o worker) trata falha daqui como best-effort, mesmo padrão de
 * `syncContactProfilePicture`/`syncGroupMetadata` — nunca no caminho crítico do ACK de uma
 * mensagem.
 */
export async function maybeAutoLinkInboxContactToCrm(
  deps: InboxCrmBridgeDeps,
  input: { tenantId: string; workspaceId: string; inboxContact: InboxContact; conversationId: string },
): Promise<EnsureCrmContactResult | undefined> {
  if (input.inboxContact.crmContactId || input.inboxContact.mergeStatus === "merged") return undefined;
  const messageCount = await deps.inboxMessageRepository.countByConversation({ conversationId: input.conversationId });
  if (messageCount < MIN_MESSAGES_FOR_AUTO_CRM_CONTACT) return undefined;
  return ensureCrmContactForInboxContact(deps, {
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    inboxContactId: input.inboxContact.id,
    contactName: input.inboxContact.name,
    contactPhone: input.inboxContact.phoneNormalized,
  });
}
