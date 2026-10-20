import type { Pool } from "pg";
import type { ContactPhoneRepositoryPort, ContactPhoneRow } from "../../../application/crm/contact-phone-use-cases.js";
import { CONTACT_DIRECTORY_PROTECTED_SQL } from "./contact-directory-sql.js";

type Row = {
  contact_id: string;
  name: string;
  identity_external_id: string | null;
  inbox_contact_id: string | null;
  phone_normalized: string | null;
  whatsapp_pn: string | null;
  whatsapp_lid: string | null;
  manual_phone: string | null;
  has_deals: boolean;
  has_proposals: boolean;
  preserve_in_directory: boolean;
};

/** Fontes de telefone de cada contato do CRM: identidade WhatsApp (cadastrada à mão ou ligada a
 * um contato da conversa) e o contato da conversa ligado por `inbox_contacts.contact_id`. */
export class PostgresContactPhoneRepository implements ContactPhoneRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async listPhoneRows(input: { tenantId: string; workspaceId: string; contactIds?: readonly string[] }): Promise<ContactPhoneRow[]> {
    const params: unknown[] = [input.tenantId, input.workspaceId];
    let filter = "";
    if (input.contactIds) {
      params.push([...input.contactIds]);
      filter = "and c.id = any($3::text[])";
    }
    const result = await this.pool.query<Row>(
      `select c.id as contact_id, c.name,
              ci.external_id as identity_external_id,
              ic.id as inbox_contact_id, ic.phone_normalized, ic.whatsapp_pn, ic.whatsapp_lid,
              c.custom_fields->>'phone' as manual_phone,
              exists (select 1 from deals d where d.contact_id = c.id) as has_deals,
              exists (select 1 from proposals p where p.contact_id = c.id) as has_proposals,
              ${CONTACT_DIRECTORY_PROTECTED_SQL} as preserve_in_directory
         from contacts c
         left join contact_identities ci on ci.contact_id = c.id and ci.tenant_id = c.tenant_id and ci.workspace_id = c.workspace_id and ci.channel = 'whatsapp'
         left join inbox_contacts ic on ic.tenant_id = c.tenant_id and ic.workspace_id = c.workspace_id and (ic.id = ci.external_id or ic.contact_id = c.id)
        where c.tenant_id = $1 and c.workspace_id = $2 ${filter}`,
      params,
    );
    return result.rows.flatMap((row) => {
      const source: ContactPhoneRow = {
        contactId: row.contact_id,
        name: row.name,
        hasDeals: row.has_deals,
        hasProposals: row.has_proposals,
        preserveInDirectory: row.preserve_in_directory,
        phoneNormalized: row.phone_normalized ?? undefined,
        whatsappPn: row.whatsapp_pn ?? undefined,
        whatsappLid: row.whatsapp_lid ?? undefined,
        // Identidade digitada à mão (o externalId é o próprio número, não o id de um contato da conversa).
        manualExternalId: row.identity_external_id && row.identity_external_id !== row.inbox_contact_id ? row.identity_external_id : undefined,
      };
      // O telefone cadastrado no CRM também vale quando o WhatsApp ainda só informou o LID.
      return row.manual_phone ? [source, { ...source, phoneNormalized: row.manual_phone, whatsappPn: undefined, whatsappLid: undefined, manualExternalId: undefined }] : [source];
    });
  }

  async listDirectoryScopes(): Promise<{ tenantId: string; workspaceId: string }[]> {
    const result = await this.pool.query<{ tenant_id: string; workspace_id: string }>(
      `select distinct c.tenant_id, c.workspace_id from contacts c
       join workspaces w on w.id = c.workspace_id and w.tenant_id = c.tenant_id where w.status = 'active'`,
    );
    return result.rows.map(row => ({ tenantId: row.tenant_id, workspaceId: row.workspace_id }));
  }

  async setPhoneResolutionStates(input: { tenantId: string; workspaceId: string; states: { contactId: string; pending: boolean }[] }): Promise<number> {
    if (input.states.length === 0) return 0;
    const result = await this.pool.query(
      `update contacts c set phone_resolution_pending = state.pending
       from unnest($3::text[], $4::boolean[]) as state(id, pending)
       where c.tenant_id = $1 and c.workspace_id = $2 and c.id = state.id
         and c.phone_resolution_pending is distinct from state.pending
         and (not state.pending or not ${CONTACT_DIRECTORY_PROTECTED_SQL})`,
      [input.tenantId, input.workspaceId, input.states.map(state => state.contactId), input.states.map(state => state.pending)],
    );
    return result.rowCount ?? 0;
  }

  async deleteContacts(input: { tenantId: string; workspaceId: string; contactIds: readonly string[] }): Promise<number> {
    if (input.contactIds.length === 0) return 0;
    const result = await this.pool.query("delete from contacts where tenant_id = $1 and workspace_id = $2 and id = any($3::text[])", [input.tenantId, input.workspaceId, [...input.contactIds]]);
    return result.rowCount ?? 0;
  }
}
