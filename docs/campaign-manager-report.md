# Relatório técnico — Campaign Manager

Implementação do Campaign Manager: módulo que recebe um objetivo de campanha em texto livre e o quebra automaticamente em um Campaign Plan com múltiplos conteúdos, cada um capaz de gerar um `ExecutionPlan` independente através do Arthur. **Não é uma Skill** (sem manifesto, não descoberto por Helena, nunca participa de um `ExecutionPlan`) e **funciona acima do Arthur**: é o único módulo desta base que chama `arthur.planFromText`, em vez de ser chamado por Arthur/Caio/Helena.

## Arquitetura da nova camada

```
src/application/campaign/
  campaign.types.ts              CampaignPlan, CampaignContentItem, status, prioridade, formato, calendário, resumo
  campaign-manager.port.ts       CampaignManagerPort (createCampaign, listCampaigns, getCampaign,
                                 generateExecutionPlanForContent, updateContentStatus, getStatusSummary)
  campaign-repository.port.ts    CampaignRepositoryPort (save, findById, list)
  campaign-log.contract.ts       logs próprios do módulo
  campaign-manager.ts            CampaignManager — implementação (heurística determinística)
  index.ts

src/infrastructure/storage/
  in-memory-campaign-repository.ts
  local-json-campaign-repository.ts    .zuno-data/campaigns.json
```

Fluxo: **CLI/chamador → CampaignManager.createCampaign() → Campaign Plan persistido** (organização) e **CampaignManager.generateExecutionPlanForContent() → arthur.planFromText() → ExecutionPlan** (ponte unidirecional para o resto do sistema, um conteúdo por vez). Dependências: `valentina: ValentinaTenantPort` (obrigatória), `arthur: ArthurTextCommandPlannerPort` (obrigatória), `clara?: ClaraKnowledgePort` (opcional, enriquece persona/CTA).

## Arquivos criados

**Módulo de aplicação:**
- `src/application/campaign/campaign.types.ts`
- `src/application/campaign/campaign-manager.port.ts`
- `src/application/campaign/campaign-repository.port.ts`
- `src/application/campaign/campaign-log.contract.ts`
- `src/application/campaign/campaign-manager.ts`
- `src/application/campaign/index.ts`

**Infraestrutura:**
- `src/infrastructure/storage/in-memory-campaign-repository.ts`
- `src/infrastructure/storage/local-json-campaign-repository.ts`

**Documentação:**
- `docs/campaign-manager.md`
- `docs/campaign-manager-report.md` (este relatório)

**Testes:**
- `tests/campaign-manager.test.mjs` — 23 testes (quebra do objetivo, validação/regressão, histórico, geração de ExecutionPlan via Arthur fake, status/percentual, isolamento arquitetural).

## Arquivos alterados

- `src/application/events/zuno-event.contract.ts` — `CampaignCreated`, `CampaignContentExecutionPlanGenerated`, `CampaignContentStatusChanged`.
- `src/infrastructure/storage/index.ts` — exporta os dois novos repositórios.
- `src/interfaces/cli/run-command.ts` — `CampaignManager` instanciado em `buildRuntime()` (com `TimestampRandomIdGenerator`, ver "Decisão preventiva" abaixo); `createCampaign`, `listCampaigns`, `getCampaign`, `generateCampaignContentExecutionPlan`, `markCampaignContentStatus`.
- `src/interfaces/cli/index.ts` — flags `--campaign`, `--campaign-list`, `--campaign-show`, `--campaign-generate-plan`, `--campaign-mark`; `printCampaignPlan`/`printCampaignStatusSummary`; uso atualizado.
- `package.json` — `tests/campaign-manager.test.mjs` adicionado ao script `test`.
- `README.md`, `docs/architecture.md`, `docs/growth-roadmap.md`.

## Decisão arquitetural: acima do Arthur, não ao lado das Skills

Todos os módulos anteriores (Clara, Valentina, Quality Feedback) são consultados por Arthur ou por uma Skill. Campaign Manager é o primeiro a inverter essa direção: ele **produz o comando em texto** que alimenta `arthur.planFromText`, exatamente como um usuário digitando na CLI — não há capability nova, não há etapa nova no `ExecutionPlan`, e Arthur nunca sabe que o comando veio de uma campanha. Isso preserva integralmente a arquitetura baseada em Skills: cada conteúdo de uma campanha percorre o mesmíssimo caminho Arthur → Caio → Helena → Skills que qualquer outro comando percorreria, incluindo o Eduardo como primeira etapa (confirmado na validação manual abaixo).

## Decisão preventiva: id não sequencial no armazenamento persistente

Ao implementar o Quality Feedback (sessão anterior), um gerador de id sequencial reiniciando em 1 a cada processo causou colisão e sobrescrita de registros entre invocações separadas da CLI. Campaign Manager tem exatamente o mesmo padrão de uso (`--campaign` cria, `--campaign-generate-plan`/`--campaign-mark` referenciam a campanha em processos futuros e separados) — por isso já nasceu usando `TimestampRandomIdGenerator` (a mesma classe já corrigida para o Quality Feedback) desde o primeiro commit, em vez de repetir o bug e descobri-lo de novo.

## Exemplos de quebra do objetivo (validados em teste e na CLI real)

| Objetivo | Tipo | Duração | Conteúdos | Abertura | Fechamento |
| --- | --- | --- | --- | --- | --- |
| "...divulgar o Rumo ao Altar durante 30 dias." | divulgação | 30 dias | 10 | Apresentação da marca (carrossel) | Convite direto para conhecer a plataforma (carrossel) |
| "...captar casais recém-noivos." | captação | 30 dias (padrão) | 10 | A dor de organizar o casamento sem ajuda (carrossel) | Convite para casais recém-noivos começarem agora (story) |
| "...divulgar a lista de presentes." | conversão específica | 30 dias (padrão) | 10 | Teaser sobre a lista de presentes (story) | CTA final para usar a lista de presentes agora (carrossel) |

Cada `CampaignContentItem` carrega `recommendedFormat`, `priority` (abertura/fechamento sempre `alta`), `cta` (suave para conteúdos comuns, forte para o fechamento — enriquecido pela Clara quando disponível) e `relatedContentIds` (todo conteúdo referencia a abertura, modelando a relação narrativa pedida).

## Como cada conteúdo gera um ExecutionPlan independente

`generateExecutionPlanForContent(campaignId, contentId)` monta `"Crie um ${formato} para ${canal} sobre ${tópico}, com CTA: ${cta}."` e chama `arthur.planFromText`. Validado manualmente com o Arthur real (não um fake):

```
ExecutionPlan plan-0010 gerado para o conteúdo campaign-content-... da campanha campaign-...
Etapas: Planejamento editorial -> Estratégia de marketing -> Criação da copy -> Direção de arte ->
        Design de redes sociais -> Geração de imagem -> Revisão -> Aprovação
```

Confirma duas coisas: (1) o plano nasce completo, com o Eduardo já como primeira etapa, exatamente como qualquer comando digitado por um humano; (2) Campaign Manager não precisou de nenhuma mudança em Arthur/Caio/Helena para funcionar. Chamar de novo para o mesmo conteúdo gera um novo `ExecutionPlan` independente; se o status já avançou (ex.: `approved`), ele não retrocede para `execution_planned`.

## Status, percentual concluído e histórico

`CampaignContentStatus`: `pending → execution_planned → in_review → approved | rejected | published | failed`, com `statusHistory` auditável (status, data, motivo). `getStatusSummary` devolve contagens por status e `percentComplete` (proporção de `approved`+`published`). Validado manualmente: uma campanha de 10 conteúdos com 1 `approved` reporta `10%`. `listCampaigns`/`getCampaign` dão acesso ao histórico completo (campanhas nunca são apagadas).

## Testes criados

**`tests/campaign-manager.test.mjs` (23 testes):** os três exemplos do pedido (com todos os campos do Campaign Plan validados); duração/canais explícitos vencendo o texto; extração de duração (dias/semanas/meses); limites de quantidade de conteúdo (3 a 20); enriquecimento por Clara (persona e CTA); validação (cliente ausente, objetivo vazio, duração inválida, canais vazios); cliente não encontrado; histórico (`listCampaigns` filtrado, `getCampaign`); persistência local JSON entre instâncias; geração de `ExecutionPlan` independente por conteúdo (com Arthur fake, verificando `clientId`/comando enviados); não retrocesso de status ao regenerar plano; erros de campanha/conteúdo inexistente; atualização de status com histórico auditável; status inválido rejeitado; percentual concluído e contagens; cobertura de todos os status; confirmação de que não é Skill (sem manifesto, não aparece em `dist/skills`); confirmação de que não cria copy/imagem/vídeo; confirmação de que não importa nenhuma Skill nem chama Caio/Helena diretamente.

## Validações executadas

- `npm run typecheck` — sem erros, na primeira tentativa.
- `npm test` — **483/483 testes passando** (partindo de 460 antes desta sessão: +23 em `tests/campaign-manager.test.mjs`).
- `npm run architecture:check` — build completo + descoberta real de Skills inalterada (Campaign Manager corretamente **não aparece** como Skill descoberta).
- Validação manual de ponta a ponta pela CLI real: `--campaign` (criação com persona/CTA reais da Clara) → `--campaign-list` → `--campaign-show` → `--campaign-generate-plan` (ExecutionPlan real, via Arthur real, com Eduardo como primeira etapa) → `--campaign-mark ... approved` → `--campaign-show` (percentual concluído atualizado para 10%).

## Limitações

- Não usa Ícaro nesta primeira versão — a quebra em conteúdos é inteiramente determinística (diferente de João/Eduardo, que aceitam apoio opcional de IA).
- Não executa o `ExecutionPlan` gerado (Caio) nem publica — apenas o entrega; rodar, aprovar/rejeitar e publicar cada conteúdo continuam passos manuais separados.
- Não há sincronização automática entre o resultado real de um workflow (ex.: `COMPLETED` com Ana `published`) e o `status` do conteúdo na campanha — `updateContentStatus` precisa ser chamado explicitamente.
- Detecção de canal e de recurso específico (para `conversao_especifica`) usa listas fixas e pequenas de palavras-chave, sem cobrir todos os casos possíveis.

## Sugestões futuras

1. Sincronizar automaticamente o `status` do conteúdo com o estado real do workflow quando `generateExecutionPlanForContent` for seguido de execução real via Caio (ex.: um `executionId` seria vinculado ao conteúdo e consultado depois).
2. Permitir apoio opcional do Ícaro para enriquecer `topic`/justificativas, seguindo o mesmo padrão restrito já usado por João e Eduardo (nunca alterar formato/quantidade/datas).
3. Expor `createCampaign`/`getStatusSummary` também por uma futura API/painel, reaproveitando a mesma porta.
4. Permitir editar/ajustar manualmente um conteúdo específico do Campaign Plan (tópico, formato, data) antes de gerar o `ExecutionPlan`, em vez de só marcar status depois de criado.
