import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import pg from "pg";
import { classifyContactPhone, normalizeContactPhone } from "../dist/domain/crm/contact-phone.js";
import { PostgresContactPhoneRepository } from "../dist/infrastructure/storage/postgres/postgres-contact-phone-repository.js";

/** Limpeza deliberada, limitada a UM tenant/workspace. Nunca usada pelo scheduler. */
export async function cleanupInvalidContacts(pool, { tenantId, workspaceId, apply = false, reportPath, expectedRemovals }) {
  if (!tenantId || !workspaceId || !reportPath) throw new Error("Tenant, workspace e arquivo privado de relatório são obrigatórios.");
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local lock_timeout = '10s'");
    // Evita excluir enquanto uma mensagem/edição está acrescentando o telefone real.
    if (apply) await client.query("lock table contacts, contact_identities, inbox_contacts in share row exclusive mode");
    const scope = { tenantId, workspaceId };
    const workspace = await client.query("select id, name from workspaces where tenant_id=$1 and id=$2", [tenantId, workspaceId]);
    if (workspace.rowCount !== 1) throw new Error("Workspace não encontrado neste tenant.");
    const contacts = (await client.query("select * from contacts where tenant_id=$1 and workspace_id=$2 order by id", [tenantId, workspaceId])).rows;
    const rows = await new PostgresContactPhoneRepository(client).listPhoneRows(scope);
    const sources = new Map();
    for (const row of rows) sources.set(row.contactId, [...(sources.get(row.contactId) ?? []), row]);
    const valid = [], invalid = [];
    for (const contact of contacts) {
      const inputs = sources.get(contact.id) ?? [];
      let summary = classifyContactPhone(inputs);
      // Recupera apenas um nome inteiramente numérico validável. Nunca converte um LID conhecido.
      const namePhone = normalizeContactPhone(contact.name);
      const nameIsKnownLid = inputs.some(source => [source.whatsappLid, /@lid\b|^LID_/i.test(source.manualExternalId ?? "") ? source.manualExternalId : undefined].some(lid => lid && lid.replace(/\D/g, "") === contact.name.replace(/\D/g, "")));
      if (summary.kind !== "phone" && namePhone && !nameIsKnownLid) summary = { kind: "phone", phone: namePhone };
      if (summary.kind === "phone") valid.push({ contact, phone: summary.phone });
      else invalid.push({ contact, kind: summary.kind, sources: inputs });
    }
    if (apply && (!Number.isInteger(expectedRemovals) || expectedRemovals !== invalid.length)) throw new Error(`Quantidade mudou: ${invalid.length} exclusões candidatas. Execute a prévia novamente.`);
    const report = { at: new Date().toISOString(), mode: apply ? "apply" : "preview", tenantId, workspaceId, workspaceName: workspace.rows[0].name,
      total: contacts.length, retained: valid.length, recovered: valid.filter(item => item.contact.custom_fields?.phone !== item.phone).length,
      removed: invalid.length, invalid, retainedIds: valid.map(item => item.contact.id) };
    // Falha ao salvar o relatório impede qualquer exclusão. Arquivo contém dados pessoais.
    await mkdir(dirname(resolve(reportPath)), { recursive: true, mode: 0o700 });
    await writeFile(reportPath, JSON.stringify(report, null, 2), { mode: 0o600, flag: "wx" });
    if (apply) {
      for (const { contact, phone } of valid) await client.query("update contacts set custom_fields=jsonb_set(custom_fields, '{phone}', to_jsonb($4::text)), phone_resolution_pending=false, updated_at=now() where tenant_id=$1 and workspace_id=$2 and id=$3", [tenantId, workspaceId, contact.id, phone]);
      const deletion = await client.query("delete from contacts where tenant_id=$1 and workspace_id=$2 and id=any($3::text[])", [tenantId, workspaceId, invalid.map(item => item.contact.id)]);
      if (deletion.rowCount !== invalid.length) throw new Error("Contagem de exclusões divergente; transação cancelada.");
      await client.query("commit");
    } else await client.query("rollback");
    return { mode: report.mode, total: report.total, retained: report.retained, recovered: report.recovered, removed: report.removed };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally { client.release(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { "tenant-id": { type: "string" }, "workspace-id": { type: "string" }, report: { type: "string" }, apply: { type: "boolean", default: false }, "expected-removals": { type: "string" } } });
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL obrigatório.");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    console.log(JSON.stringify(await cleanupInvalidContacts(pool, { tenantId: values["tenant-id"], workspaceId: values["workspace-id"], reportPath: values.report, apply: values.apply, expectedRemovals: values["expected-removals"] === undefined ? undefined : Number(values["expected-removals"]) })));
  } finally { await pool.end(); }
}
