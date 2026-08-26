import type { MetaAdAccount } from "../ports/meta-ad-account-repository.port.js";
import type { MetaCustomAudienceRepositoryPort } from "../ports/meta-custom-audience-repository.port.js";
import type { MetaAdsCredentialRepositoryPort } from "../ports/meta-ads-credential-repository.port.js";
import type { SecretManagerPort } from "../ports/secret-manager.port.js";
import { metaGraphRequest, toActAccountId } from "../../infrastructure/meta/meta-graph-client.js";
import { hashPiiFields } from "../../infrastructure/meta/hash-pii.js";
import { resolveMetaAdsAccessToken } from "./resolve-meta-ads-access-token.js";

/**
 * Criação de público customizado a partir de lista de clientes (`subtype=CUSTOM`,
 * `customer_file_source=USER_PROVIDED_ONLY`) — Fase 4.
 *
 * Todo contato da lista precisa ter EXATAMENTE o mesmo conjunto de campos preenchidos (todos com
 * e-mail, todos com telefone, ou ambos) — a Marketing API espera colunas fixas (`schema`) com uma
 * linha de dado por contato; misturar linhas com campos diferentes faria algumas colunas
 * receberem hash de string vazia, o que a própria Meta desaconselha (reduz silenciosamente a taxa
 * de match, sem erro). Preferimos rejeitar explicitamente a inconsistência aqui a mandar dado
 * degradado pra Meta sem avisar ninguém.
 *
 * PII (e-mail/telefone) nunca é logada nem persistida — `hashPiiFields` devolve só o hash SHA-256,
 * enviado direto no corpo da chamada e descartado da memória do processo depois desta função
 * retornar.
 */

export type CreateMetaCustomAudienceCustomer = { email?: string; phone?: string };

export type CreateMetaCustomAudienceInput = {
  tenantId: string;
  workspaceId: string;
  adAccount: MetaAdAccount;
  name: string;
  description?: string;
  customers?: readonly CreateMetaCustomAudienceCustomer[];
};

export type CreateMetaCustomAudienceDeps = {
  audienceRepository: MetaCustomAudienceRepositoryPort;
  credentialRepository: MetaAdsCredentialRepositoryPort;
  secretManager: SecretManagerPort;
  fetchImpl?: typeof fetch;
};

export type CreateMetaCustomAudienceResult = {
  audience: Awaited<ReturnType<MetaCustomAudienceRepositoryPort["upsertAudience"]>>;
  usersUploaded: number;
};

function buildSchemaAndRows(customers: readonly CreateMetaCustomAudienceCustomer[]): { schema: string[]; data: string[][] } {
  const hasEmail = Boolean(customers[0]?.email);
  const hasPhone = Boolean(customers[0]?.phone);
  if (!hasEmail && !hasPhone) {
    throw new Error("META_ADS_AUDIENCE_UPLOAD_EMPTY_ROW: cada contato precisa de e-mail e/ou telefone.");
  }

  for (const customer of customers) {
    if (Boolean(customer.email) !== hasEmail || Boolean(customer.phone) !== hasPhone) {
      throw new Error(
        "META_ADS_AUDIENCE_UPLOAD_INCONSISTENT_SCHEMA: todos os contatos da lista precisam ter os mesmos campos preenchidos (e-mail e/ou telefone) — misturar linhas incompletas reduz o match sem avisar.",
      );
    }
  }

  const schema: string[] = [];
  if (hasEmail) schema.push("EMAIL");
  if (hasPhone) schema.push("PHONE");

  const data = customers.map((customer) => {
    const hashed = hashPiiFields({ email: customer.email, phone: customer.phone });
    const row: string[] = [];
    if (hasEmail) row.push(hashed.em!);
    if (hasPhone) row.push(hashed.ph!);
    return row;
  });

  return { schema, data };
}

export async function createMetaCustomAudience(deps: CreateMetaCustomAudienceDeps, input: CreateMetaCustomAudienceInput): Promise<CreateMetaCustomAudienceResult> {
  const accessToken = await resolveMetaAdsAccessToken(deps, { tenantId: input.tenantId, workspaceId: input.workspaceId, credentialReferenceId: input.adAccount.credentialReferenceId });

  const created = await metaGraphRequest<{ id: string }>(`/${toActAccountId(input.adAccount.accountId)}/customaudiences`, {
    method: "POST",
    accessToken,
    fetchImpl: deps.fetchImpl,
    params: {
      name: input.name,
      subtype: "CUSTOM",
      customer_file_source: "USER_PROVIDED_ONLY",
      ...(input.description ? { description: input.description } : {}),
    },
  });

  let usersUploaded = 0;
  if (input.customers && input.customers.length > 0) {
    const { schema, data } = buildSchemaAndRows(input.customers);
    await metaGraphRequest(`/${created.id}/users`, {
      method: "POST",
      accessToken,
      fetchImpl: deps.fetchImpl,
      params: { payload: { schema, data } },
    });
    usersUploaded = data.length;
  }

  const audience = await deps.audienceRepository.upsertAudience({
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    adAccountId: input.adAccount.id,
    audienceId: created.id,
    name: input.name,
    subtype: "CUSTOM",
    description: input.description,
    approximateCount: undefined,
  });

  return { audience, usersUploaded };
}
