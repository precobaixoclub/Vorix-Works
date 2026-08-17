import type { BriefingSchema, BriefingType } from "./briefing.model.js";
import { CAMPAIGN_CREATION_SCHEMA_V1 } from "./schemas/campaign-creation.schema.js";
import { CONTENT_REQUEST_SCHEMA_V1 } from "./schemas/content-request.schema.js";

/**
 * Registro de schemas por tipo — Sprint 07 (escopo aprovado), com `content_request` acrescentado
 * depois (caminho reduzido de geração visual, ver `content-request.schema.ts`). `campaign_edit`/
 * `knowledge_query`/`asset_search`/`generic_task` continuam existindo só como `BriefingType`
 * válido (o contrato existe), mas `getBriefingSchema` devolve `undefined` para eles — quem chama
 * trata a ausência como "sem schema ainda" e preserva o comportamento conversacional da Sprint 06
 * para essa intenção, nunca cria uma implementação pela metade.
 */
const SCHEMA_REGISTRY: Partial<Record<BriefingType, BriefingSchema>> = {
  campaign_creation: CAMPAIGN_CREATION_SCHEMA_V1,
  content_request: CONTENT_REQUEST_SCHEMA_V1,
};

export function getBriefingSchema(type: BriefingType): BriefingSchema | undefined {
  return SCHEMA_REGISTRY[type];
}

export function hasBriefingSchema(type: BriefingType): boolean {
  return type in SCHEMA_REGISTRY;
}
