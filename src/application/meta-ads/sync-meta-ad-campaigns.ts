import type { MetaAdCampaignRepositoryPort } from "../ports/meta-ad-campaign-repository.port.js";
import type { MetaAdSetRepositoryPort } from "../ports/meta-ad-set-repository.port.js";
import type { MetaAdRepositoryPort } from "../ports/meta-ad-repository.port.js";
import type { MetaAdsCredentialRepositoryPort } from "../ports/meta-ads-credential-repository.port.js";
import type { MetaAdAccount } from "../ports/meta-ad-account-repository.port.js";
import type { SecretManagerPort } from "../ports/secret-manager.port.js";
import { metaGraphRequest } from "../../infrastructure/meta/meta-graph-client.js";

/**
 * Sync assíncrono de campanhas/adsets/ads — módulo Meta Ads Manager, Fase 2.
 *
 * Correção central desta fase (achado do pacote de referência analisado,
 * bittencourtthulio/meta-graph-api-integration): números que não batem com o Ads Manager quase
 * nunca são bug de sync — é a JANELA DE ATRIBUIÇÃO. O Ads Manager usa `7d_click,1d_view` por
 * padrão; uma consulta de `insights` sem `action_attribution_windows` reporta números DIFERENTES
 * (não errados, diferentes) do que o cliente vê na tela dele. `ATTRIBUTION_WINDOWS` abaixo é
 * exatamente esse valor, aplicado em toda consulta de insights desta função.
 *
 * Uma ÚNICA chamada por conta de anúncio, usando expansão de campos aninhada da Graph API
 * (`campaigns{...adsets{...ads{...}}}`) — nunca N+1 chamadas (uma por campanha, uma por adset).
 * Limitação conhecida e documentada: conexões aninhadas (`adsets`, `ads`) vêm com a paginação
 * PADRÃO da Meta (não seguimos `paging.next` dentro do aninhamento) — contas com centenas de
 * adsets por campanha ficam truncadas na primeira página até uma Fase futura resolver isso; não
 * é um caso comum o suficiente para justificar a complexidade agora (ver auditoria de custo desta
 * mesma sessão: "não aumentar complexidade indefinidamente").
 */

export const ATTRIBUTION_WINDOWS = ["7d_click", "1d_view"] as const;

const INSIGHTS_FIELDS = "spend,impressions,clicks,reach,actions";
const AD_INSIGHTS_FIELDS = `${INSIGHTS_FIELDS},video_p100_watched_actions`;

function insightsField(fields: string): string {
  return `insights.action_attribution_windows(["${ATTRIBUTION_WINDOWS.join('","')}"]){${fields}}`;
}

const CAMPAIGNS_QUERY_FIELDS = [
  "id,name,objective,status,effective_status,buying_type,special_ad_categories,daily_budget,lifetime_budget,budget_remaining,start_time,stop_time,created_time",
  insightsField(INSIGHTS_FIELDS),
  `adsets.limit(100){id,name,status,effective_status,optimization_goal,billing_event,bid_amount,daily_budget,lifetime_budget,targeting,start_time,end_time,created_time,${insightsField(INSIGHTS_FIELDS)},ads.limit(100){id,name,status,effective_status,creative{id,object_story_spec,thumbnail_url},${insightsField(AD_INSIGHTS_FIELDS)}}}`,
].join(",");

type GraphInsights = { data?: Array<Record<string, unknown>> };
type GraphAd = { id: string; name: string; status: string; effective_status?: string; creative?: unknown; insights?: GraphInsights };
type GraphAdSet = { id: string; name: string; status: string; effective_status?: string; optimization_goal?: string; billing_event?: string; bid_amount?: string; daily_budget?: string; lifetime_budget?: string; targeting?: unknown; start_time?: string; end_time?: string; created_time?: string; insights?: GraphInsights; ads?: { data?: GraphAd[] } };
type GraphCampaign = {
  id: string; name: string; objective?: string; status: string; effective_status?: string; buying_type?: string; special_ad_categories?: string[];
  daily_budget?: string; lifetime_budget?: string; budget_remaining?: string; start_time?: string; stop_time?: string; created_time?: string;
  insights?: GraphInsights; adsets?: { data?: GraphAdSet[] };
};

function firstInsightsRow(insights: GraphInsights | undefined): Record<string, unknown> | undefined {
  return insights?.data?.[0];
}

function num(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export type SyncMetaAdCampaignsDeps = {
  campaignRepository: MetaAdCampaignRepositoryPort;
  adSetRepository: MetaAdSetRepositoryPort;
  adRepository: MetaAdRepositoryPort;
  credentialRepository: MetaAdsCredentialRepositoryPort;
  secretManager: SecretManagerPort;
  fetchImpl?: typeof fetch;
};

export type SyncMetaAdCampaignsResult = { campaignsSynced: number; adSetsSynced: number; adsSynced: number };

function secretReference(tenantId: string, workspaceId: string, credentialReferenceId: string): string {
  return `meta-ads:${tenantId}:${workspaceId}:${credentialReferenceId}`;
}

/** Sincroniza UMA conta de anúncio (todas as campanhas/adsets/ads dela). Chamado pelo scheduler
 * (`meta-ads-sync-scheduler.ts`) uma vez por conta ativa, e pela rota de resync manual. */
export async function syncMetaAdCampaignsForAccount(deps: SyncMetaAdCampaignsDeps, input: { tenantId: string; workspaceId: string; adAccount: MetaAdAccount }): Promise<SyncMetaAdCampaignsResult> {
  const reference = await deps.credentialRepository.getCredentialReference(input.adAccount.credentialReferenceId);
  if (!reference || reference.tenantId !== input.tenantId || reference.workspaceId !== input.workspaceId || reference.status !== "active") {
    throw new Error("META_ADS_CREDENTIAL_NOT_ACTIVE: esta conexão não está ativa — reconecte antes de sincronizar.");
  }
  const secret = await deps.secretManager.get(secretReference(input.tenantId, input.workspaceId, input.adAccount.credentialReferenceId));
  const accessToken = secret?.value.accessToken;
  if (!accessToken) throw new Error("META_ADS_TOKEN_MISSING: token não encontrado para esta conexão — reconecte.");

  const response = await metaGraphRequest<{ data?: GraphCampaign[] }>(`/${input.adAccount.accountId}/campaigns`, {
    accessToken,
    params: { fields: CAMPAIGNS_QUERY_FIELDS, limit: 200 },
    fetchImpl: deps.fetchImpl,
    timeoutMs: 60_000,
  });

  const keptCampaignIds: string[] = [];
  const keptAdSetIds: string[] = [];
  const keptAdIds: string[] = [];
  let campaignsSynced = 0;
  let adSetsSynced = 0;
  let adsSynced = 0;

  for (const campaign of response.data ?? []) {
    const campaignInsights = firstInsightsRow(campaign.insights);
    const savedCampaign = await deps.campaignRepository.upsertCampaign({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      adAccountId: input.adAccount.id,
      campaignId: campaign.id,
      name: campaign.name,
      objective: campaign.objective,
      status: campaign.status as never,
      effectiveStatus: campaign.effective_status,
      buyingType: campaign.buying_type,
      specialAdCategories: campaign.special_ad_categories,
      dailyBudget: num(campaign.daily_budget),
      lifetimeBudget: num(campaign.lifetime_budget),
      budgetRemaining: num(campaign.budget_remaining),
      spend: num(campaignInsights?.spend),
      impressions: num(campaignInsights?.impressions),
      clicks: num(campaignInsights?.clicks),
      reach: num(campaignInsights?.reach),
      insights: campaignInsights,
      startTime: campaign.start_time,
      stopTime: campaign.stop_time,
      metaCreatedTime: campaign.created_time,
    });
    keptCampaignIds.push(campaign.id);
    campaignsSynced++;

    for (const adSet of campaign.adsets?.data ?? []) {
      const adSetInsights = firstInsightsRow(adSet.insights);
      const savedAdSet = await deps.adSetRepository.upsertAdSet({
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        campaignId: savedCampaign.id,
        adAccountId: input.adAccount.id,
        adSetId: adSet.id,
        name: adSet.name,
        status: adSet.status as never,
        effectiveStatus: adSet.effective_status,
        optimizationGoal: adSet.optimization_goal,
        billingEvent: adSet.billing_event,
        bidAmount: num(adSet.bid_amount),
        dailyBudget: num(adSet.daily_budget),
        lifetimeBudget: num(adSet.lifetime_budget),
        targeting: adSet.targeting,
        spend: num(adSetInsights?.spend),
        impressions: num(adSetInsights?.impressions),
        clicks: num(adSetInsights?.clicks),
        reach: num(adSetInsights?.reach),
        insights: adSetInsights,
        startTime: adSet.start_time,
        endTime: adSet.end_time,
        metaCreatedTime: adSet.created_time,
      });
      keptAdSetIds.push(adSet.id);
      adSetsSynced++;

      for (const ad of adSet.ads?.data ?? []) {
        const adInsights = firstInsightsRow(ad.insights);
        const videoCompletionActions = (adInsights?.video_p100_watched_actions as Array<{ value?: string }> | undefined)?.[0]?.value;
        await deps.adRepository.upsertAd({
          tenantId: input.tenantId,
          workspaceId: input.workspaceId,
          adSetId: savedAdSet.id,
          campaignId: savedCampaign.id,
          adAccountId: input.adAccount.id,
          adId: ad.id,
          name: ad.name,
          status: ad.status as never,
          effectiveStatus: ad.effective_status,
          creative: ad.creative,
          spend: num(adInsights?.spend),
          impressions: num(adInsights?.impressions),
          clicks: num(adInsights?.clicks),
          reach: num(adInsights?.reach),
          videoCompletionRate: num(videoCompletionActions),
          insights: adInsights,
          metaCreatedTime: undefined,
        });
        keptAdIds.push(ad.id);
        adsSynced++;
      }
    }
  }

  await deps.campaignRepository.markDeletedMissing({ adAccountId: input.adAccount.id, keepCampaignIds: keptCampaignIds });
  await deps.adSetRepository.markDeletedMissing({ adAccountId: input.adAccount.id, keepAdSetIds: keptAdSetIds });
  await deps.adRepository.markDeletedMissing({ adAccountId: input.adAccount.id, keepAdIds: keptAdIds });

  return { campaignsSynced, adSetsSynced, adsSynced };
}
