import type { Pool } from "pg";
import type { ContactPhoneRepositoryPort, ContactPhoneRow } from "../../../application/crm/contact-phone-use-cases.js";

type Row = {
  contact_id: string;
  name: string;
  identity_external_id: string | null;
  inbox_contact_id: string | null;
  phone_normalized: string | null;
  whatsapp_pn: string | null;
  whatsapp_lid: string | null;
  has_deals: boolean;
  has_proposals: boolean;
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
              exists (select 1 from deals d where d.contact_id = c.id) as has_deals,
              exists (select 1 from proposals p where p.contact_id = c.id) as has_proposals
         from contacts c
         left join contact_identities ci on ci.contact_id = c.id and ci.channel = 'whatsapp'
         left join inbox_contacts ic on ic.workspace_id = c.workspace_id and (ic.id = ci.external_id or ic.contact_id = c.id)
        where c.tenant_id = $1 and c.workspace_id = $2 ${filter}`,
      params,
    );
    return result.rows.map((row) => ({
      contactId: row.contact_id,
      name: row.name,
      hasDeals: row.has_deals,
      hasProposals: row.has_proposals,
      phoneNormalized: row.phone_normalized ?? undefined,
      whatsappPn: row.whatsapp_pn ?? undefined,
      whatsappLid: row.whatsapp_lid ?? undefined,
      // Identidade digitada à mão (o externalId é o próprio número, não o id de um contato da conversa).
      manualExternalId: row.identity_external_id && row.identity_external_id !== row.inbox_contact_id ? row.identity_external_id : undefined,
    }));
  }

  async deleteContacts(input: { tenantId: string; workspaceId: string; contactIds: readonly string[] }): Promise<number> {
    if (input.contactIds.length === 0) return 0;
    const result = await this.pool.query("delete from contacts where tenant_id = $1 and workspace_id = $2 and id = any($3::text[])", [input.tenantId, input.workspaceId, [...input.contactIds]]);
    return result.rowCount ?? 0;
  }
}
