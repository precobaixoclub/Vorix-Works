# Campaign Manager

Campaign Manager é o módulo do Zuno que organiza uma campanha completa a partir de um único objetivo em texto. **Não é uma Skill**: não possui manifesto, não é descoberto por Helena e nunca participa de um `ExecutionPlan`. **Funciona acima do Arthur**: ele chama `arthur.planFromText` sob demanda, um conteúdo por vez — Arthur nunca chama o Campaign Manager de volta.

> Atenção ao nome: já existe uma capability de Skill chamada `campaign_management`, reservada para uma futura Skill de gestão de campanhas **pagas** (Meta Ads/Google Ads — ver `ArthurOrchestrator.detectsPaidCampaignManagementRequest`). Isso é um conceito completamente diferente do Campaign Manager deste documento, que organiza uma série de conteúdos **orgânicos**. Nenhum código é compartilhado entre os dois.

## Por que não é uma Skill

Uma Skill é convocada por Arthur, através de Caio e Helena, dentro de um `ExecutionPlan`. Campaign Manager é o inverso: ele **produz** o texto que vira um `ExecutionPlan`, chamando `ArthurTextCommandPlannerPort.planFromText` diretamente — a mesma porta que a CLI já usa em `runZunoCommand`. Ele fica arquiteturalmente acima de Arthur, não ao lado das Skills.

## Arquitetura

Mesmo padrão de Clara, Valentina e Quality Feedback:

```
src/application/campaign/
  campaign.types.ts              tipos: plano, conteúdo, calendário, resumo de status
  campaign-manager.port.ts       CampaignManagerPort
  campaign-repository.port.ts    CampaignRepositoryPort (save, findById, list)
  campaign-log.contract.ts       logs próprios do módulo
  campaign-manager.ts            CampaignManager — implementação
  index.ts

src/infrastructure/storage/
  in-memory-campaign-repository.ts
  local-json-campaign-repository.ts   .zuno-data/campaigns.json
```

Dependências do `CampaignManager`: `valentina: ValentinaTenantPort` (obrigatória, resolve o cliente), `arthur: ArthurTextCommandPlannerPort` (obrigatória, é o próprio motivo do módulo existir), `clara?: ClaraKnowledgePort` (opcional, enriquece persona e CTA). Diferente do João e do Eduardo, esta primeira versão **não usa Ícaro** — a quebra em conteúdos é inteiramente determinística (ver "Sugestões futuras").

## O Campaign Plan

`createCampaign({ clientId, objective, durationDays?, channels? })` devolve um `CampaignPlan` com exatamente os campos pedidos:

- `objective`, `objectiveType` (`divulgacao` | `captacao` | `conversao_especifica` | `engajamento`);
- `durationDays`, `startDate`, `endDate`;
- `persona` (da Clara `AudienceContext` quando disponível, senão um padrão por tipo de objetivo);
- `channels` (explícitos, detectados no texto, ou `["instagram", "facebook"]` por padrão);
- `frequency` (`postsPerWeek` + rótulo);
- `calendar`: entradas `{ date, contentId, topic, channel }` em ordem cronológica;
- `contents`: a lista de conteúdos, cada um com `recommendedFormat`, `priority`, `cta`, `scheduledDate`, `relatedContentIds` e `status`.

### Como o objetivo é quebrado em conteúdos

1. **Tipo de objetivo** — por palavras-chave: recursos específicos conhecidos ("lista de presentes", "confirmação de presença"/"RSVP", "painel") → `conversao_especifica`; "captar"/"atrair"/"recém-noivos" → `captacao`; "engajar"/"comunidade" → `engajamento`; caso contrário → `divulgacao`.
2. **Duração** — um número explícito no texto ("30 dias", "2 semanas", "1 mês") sempre vence; sem número explícito, `durationDays` default é 30.
3. **Quantidade de conteúdos** — `clamp(round(durationDays / 3), 3, 20)`: aproximadamente um conteúdo a cada 3 dias, nunca menos de 3 nem mais de 20.
4. **Sequência** — cada tipo de objetivo tem um conjunto de templates (papel narrativo + tópico + formato). O primeiro conteúdo é sempre `abertura`, o último é sempre `cta_final` (prioridade `alta` em ambos); os templates se repetem ciclicamente para preencher o restante, com `prova_social` em prioridade `media` e demais conteúdos em prioridade `baixa`.
5. **Relação entre os conteúdos** — todo conteúdo, exceto a abertura, referencia o id da abertura em `relatedContentIds`, modelando explicitamente o fio narrativo da campanha.
6. **CTA** — conteúdos comuns usam um CTA "suave" (`BrandContext.preferredCtas[0]` da Clara, ou "Saiba mais"); o conteúdo de fechamento usa um CTA mais forte (`preferredCtas[1]` ou "Comece agora").
7. **Datas** — distribuídas uniformemente entre `startDate` e `endDate`.

### Exemplos (validados em teste)

| Objetivo | Tipo | Duração | Conteúdos | 1º conteúdo | Último conteúdo |
| --- | --- | --- | --- | --- | --- |
| "Quero uma campanha para divulgar o Rumo ao Altar durante 30 dias." | `divulgacao` | 30 dias | 10 | Apresentação da marca (carrossel) | Convite direto para conhecer a plataforma (carrossel) |
| "Quero uma campanha para captar casais recém-noivos." | `captacao` | 30 dias (padrão) | 10 | A dor de organizar o casamento sem ajuda (carrossel) | Convite para casais recém-noivos começarem agora (story) |
| "Quero uma campanha para divulgar a lista de presentes." | `conversao_especifica` | 30 dias (padrão) | 10 | Teaser sobre a lista de presentes (story) | CTA final para usar a lista de presentes agora (carrossel) |

## Cada conteúdo gera um ExecutionPlan independente pelo Arthur

`generateExecutionPlanForContent(campaignId, contentId)`:

1. Monta um comando em texto livre a partir do conteúdo: `"Crie um ${formato} para ${canal} sobre ${tópico}, com CTA: ${cta}."`.
2. Chama `arthur.planFromText({ command, clientId, tenantId })` — a mesma chamada que a CLI já faz para qualquer comando digitado pelo usuário. O `ExecutionPlan` resultante já sai com Eduardo como primeira etapa, exatamente como qualquer outro comando (validado manualmente: `Planejamento editorial -> Estratégia de marketing -> Criação da copy -> Direção de arte -> Design de redes sociais -> Geração de imagem -> Revisão -> Aprovação`).
3. Guarda `executionPlanId` no conteúdo e, se o status ainda era `pending`, avança para `execution_planned`. Chamar de novo para o mesmo conteúdo gera um novo `ExecutionPlan` (independente do anterior) sem retroceder um status que já avançou (ex.: `approved` continua `approved`).

Rodar esse `ExecutionPlan` de fato (Caio) continua sendo um passo manual separado, do mesmo jeito que qualquer `ExecutionPlan` produzido pela CLI hoje — Campaign Manager entrega o plano, não o executa.

## Status, percentual concluído e histórico

Cada conteúdo tem um `status`: `pending`, `execution_planned`, `in_review`, `approved`, `rejected`, `published` ou `failed`, com `statusHistory` completo (status, data, motivo opcional). `updateContentStatus(campaignId, contentId, status, reason?)` atualiza e audita.

`getStatusSummary(campaignId)` devolve contagens por status e `percentComplete` — percentual de conteúdos `approved` ou `published` sobre o total.

`listCampaigns(query?)` e `getCampaign(campaignId)` dão acesso ao histórico completo de campanhas (nunca são apagadas).

## Uso pela CLI

```bash
npm run zuno -- --campaign "Quero uma campanha para divulgar o Rumo ao Altar durante 30 dias." --client-id client-rumo
npm run zuno -- --campaign-list --client-id client-rumo
npm run zuno -- --campaign-show <campaignId>
npm run zuno -- --campaign-generate-plan <campaignId> <contentId>
npm run zuno -- --campaign-mark <campaignId> <contentId> approved --reason "Aprovado pelo time de marketing"
```

## Limitações

- Não usa Ícaro nesta primeira versão: a quebra em conteúdos é inteiramente determinística, sem aprimoramento por IA (diferente de João/Eduardo).
- Não roda o `ExecutionPlan` gerado — só o entrega. Rodar (Caio), aprovar/rejeitar o workflow e publicar continuam passos manuais separados via `npm run zuno -- "<comando>"` de cada conteúdo.
- Não há sincronização automática entre o estado real de um `ExecutionPlan`/workflow (COMPLETED, publicado pela Ana etc.) e o `status` do conteúdo na campanha — `updateContentStatus` precisa ser chamado explicitamente hoje.
- `channels`/`durationDays` explícitos sempre vencem a detecção por texto; a detecção de canal é uma lista fixa e pequena (instagram, facebook, tiktok, youtube, linkedin, threads, pinterest).
