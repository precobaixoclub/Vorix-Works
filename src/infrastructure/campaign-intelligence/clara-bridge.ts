import type { ClaraKnowledgePort } from "../../application/knowledge/clara-knowledge.port.js";
import type { ClaraKnowledgeActor } from "../../application/knowledge/clara.types.js";
import type { CampaignWorkspace } from "../../domain/campaign-intelligence/campaign-intelligence.model.js";

/**
 * Ponte Campaign Intelligence → Clara (seção 11, "Creative Context"). Mesmo padrão do bridge do
 * Company Intelligence: só chama `clara.create()`, a API pública que toda Skill já usa via
 * `requestContext()`. João pede `ProductContext`/`IdentityContext` (entre outros) sem nenhum
 * filtro de `campaignId` — então um registro publicado aqui aparece automaticamente na próxima
 * consulta de qualquer especialista para o mesmo `clientId`, sem qualquer mudança de código na
 * Skill. `payload.campaignId` fica preenchido para rastreabilidade, mesmo sem filtro automático.
 *
 * Cobre só `ProductContext` (funcionalidades/benefícios encontrados nos arquivos) e
 * `IdentityContext` (cores encontradas) — os dois únicos módulos cujo payload cabe honestamente o
 * que a ingestão de arquivos de campanha realmente produz. O resto do conhecimento (Screens, Media
 * Library, Knowledge Graph completo, timestamps de vídeo) não cabe no formato flat de Clara — fica
 * disponível via Product Screen Catalog (telas) e via consulta direta ao Workspace pela CLI.
 */

const ENGINE_ACTOR: ClaraKnowledgeActor = { id: "campaign-intelligence-engine", type: "system", name: "Campaign Intelligence Engine" };

export type ClaraPublishResult = { module: string; recordId: string };

export async function publishCampaignWorkspaceToClara(
  workspace: CampaignWorkspace,
  clientId: string,
  clara: ClaraKnowledgePort,
): Promise<ClaraPublishResult[]> {
  const results: ClaraPublishResult[] = [];
  const audit = { actor: ENGINE_ACTOR, reason: `Ingestão automática de arquivos da campanha ${workspace.campaignId}`, correlationId: `campaign-intelligence-${workspace.campaignId}` };

  const featureNames = workspace.features.map((feature) => feature.name);
  const benefits = Array.from(new Set(workspace.features.map((feature) => feature.benefit).filter(Boolean)));
  if (featureNames.length > 0 || benefits.length > 0) {
    const product = await clara.create({
      module: "ProductContext",
      title: `Produto — arquivos da campanha ${workspace.campaignId}`,
      payload: {
        clientId,
        campaignId: workspace.campaignId,
        description: `Conhecimento extraído de ${workspace.files.length} arquivo(s) enviado(s) para a campanha.`,
        features: featureNames,
        benefits,
        keywords: featureNames,
      },
      tags: ["campaign-intelligence", workspace.campaignId],
      audit,
    });
    results.push({ module: "ProductContext", recordId: product.id });
  }

  const colors = Array.from(new Set(workspace.mediaLibrary.filter((item) => item.category === "logo" || item.category === "color_swatch").flatMap((item) => item.tags)));
  const logoItem = workspace.mediaLibrary.find((item) => item.category === "logo");
  if (logoItem || colors.length > 0) {
    const identity = await clara.create({
      module: "IdentityContext",
      title: `Identidade Visual — arquivos da campanha ${workspace.campaignId}`,
      payload: {
        clientId,
        campaignId: workspace.campaignId,
        logoUri: logoItem?.originalFilePath,
        keywords: [workspace.campaignId],
      },
      tags: ["campaign-intelligence", workspace.campaignId],
      audit,
    });
    results.push({ module: "IdentityContext", recordId: identity.id });
  }

  return results;
}
