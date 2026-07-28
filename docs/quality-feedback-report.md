# Relatório técnico — Quality Feedback (ciclo de melhoria contínua)

Implementação do módulo Quality Feedback: registro local de avaliações humanas sobre execuções concluídas do Zuno, relatório agregado de qualidade e consulta opcional pelo Eduardo antes de montar um novo Editorial Brief. **Não é uma Skill**: não possui manifesto, não é descoberto por Helena e nunca participa de um `ExecutionPlan` — é um módulo de aplicação, no mesmo nível arquitetural de Clara e Valentina, consultado pelo Eduardo como dependência opcional (mesmo padrão do `IcaroBrainPort`).

## Arquitetura da nova camada

```
src/application/quality-feedback/
  quality-feedback.types.ts          tipos: categorias, avaliação, registro, consulta, relatório, insights
  quality-feedback.port.ts           QualityFeedbackPort (record, list, getReport, getInsightsForClient)
  quality-feedback-repository.port.ts QualityFeedbackRepositoryPort (save, list)
  quality-feedback-log.contract.ts   logs próprios do módulo
  quality-feedback-center.ts         QualityFeedbackCenter — implementação de QualityFeedbackPort
  index.ts                          barrel exports

src/infrastructure/storage/
  in-memory-quality-feedback-repository.ts   fixture/testes
  local-json-quality-feedback-repository.ts  .zuno-data/quality-feedback.json (mesmo padrão de Clara/Valentina)
```

Fluxo: **CLI → QualityFeedbackCenter.record() → LocalJsonQualityFeedbackRepository** (gravação) e **Eduardo → QualityFeedbackCenter.getInsightsForClient() → recomendações em texto** (consulta). Nenhum dos dois caminhos passa por Arthur, Caio ou Helena — deliberadamente, para não tocar a arquitetura baseada em Skills nem o `ExecutionPlan`.

## Arquivos criados

**Módulo de aplicação:**
- `src/application/quality-feedback/quality-feedback.types.ts`
- `src/application/quality-feedback/quality-feedback.port.ts`
- `src/application/quality-feedback/quality-feedback-repository.port.ts`
- `src/application/quality-feedback/quality-feedback-log.contract.ts`
- `src/application/quality-feedback/quality-feedback-center.ts`
- `src/application/quality-feedback/index.ts`

**Infraestrutura:**
- `src/infrastructure/storage/in-memory-quality-feedback-repository.ts`
- `src/infrastructure/storage/local-json-quality-feedback-repository.ts`

**Documentação:**
- `docs/quality-feedback.md`
- `docs/quality-feedback-report.md` (este relatório)

**Testes:**
- `tests/quality-feedback.test.mjs` — 16 testes (gravação, regressão/validação, leitura do histórico, estatísticas, consulta pelo Eduardo).

## Arquivos alterados

**Eventos:**
- `src/application/events/zuno-event.contract.ts` — `QualityFeedbackRecorded`, `QualityFeedbackReportGenerated`, `QualityFeedbackInsightsDelivered`.

**Skill (Eduardo) — única Skill tocada, como dependência opcional, não estrutural:**
- `src/skills/eduardo-editorial-planning/eduardo-editorial-planning.types.ts` — novo campo `feedbackInformed: boolean` no output.
- `src/skills/eduardo-editorial-planning/eduardo-log.contract.ts` — `FeedbackHistoryConsulted`, `FeedbackHistorySkipped`, `FeedbackHistoryFailed`.
- `src/skills/eduardo-editorial-planning/eduardo-editorial-planning.skill.ts` — dependência opcional `qualityFeedback?: QualityFeedbackPort`; consulta a `getInsightsForClient` após o apoio opcional do Ícaro; nova função pura `applyFeedbackInsights` (estritamente aditiva a `recommendationsForJoao`).
- `src/skills/eduardo-editorial-planning/eduardo.manifest.ts` e `skill.manifest.json` — `QualityFeedbackPort` declarada como dependência opcional; nova responsabilidade permitida documentada.

**CLI:**
- `src/interfaces/cli/run-command.ts` — `QualityFeedbackCenter` instanciado em `buildRuntime()` e injetado no `runtimeDependencies` de Helena (para o Eduardo); `TimestampRandomIdGenerator` (correção de bug, ver abaixo); novas funções `recordQualityFeedback` e `getQualityFeedbackReport`.
- `src/interfaces/cli/index.ts` — flags `--rate <executionId> [--stars|--score] [--needs-improvement] [--comment] [--campaign-id]` e `--quality-report [--client-id]`; `printQualityFeedbackReport`; uso atualizado.

**Testes existentes:**
- `tests/eduardo-editorial-planning.test.mjs` — 7 testes novos (funciona sem Quality Feedback; consulta o clientId correto; recomendação de CTA; recomendação de hashtags; nudge de vídeo vs. carrossel sem trocar o formato; tolerância a falha; `feedbackInformed` correto com amostra vazia).
- `tests/cli.smoke.test.mjs` — 1 teste novo de regressão (ver bug abaixo).

**Build:**
- `package.json` — `tests/quality-feedback.test.mjs` adicionado ao script `test`.

**Documentação:**
- `README.md`, `docs/architecture.md`, `docs/growth-roadmap.md`, `docs/eduardo-editorial-planning.md`.

## Exemplos de feedback

```jsonc
// ★★★★☆ com aspectos marcados e comentário
{ "executionId": "workflow-execution-0001", "rating": { "kind": "stars", "value": 4 },
  "categoriesNeedingImprovement": ["cta", "hashtags"],
  "comment": "Legenda ficou boa, mas o CTA podia ser mais direto e as hashtags mais variadas." }

// Nota de 1 a 10, com notas por categoria
{ "executionId": "workflow-execution-0002", "rating": { "kind": "score", "value": 9 },
  "categoryScores": [{ "category": "video", "score": 9 }, { "category": "roteiro", "score": 8 }] }
```

Via CLI (`clientId`/`format`/`contentType`/`skillsUsed` derivados automaticamente de `artifacts/<executionId>/execution-report.json`):

```bash
npm run zuno -- --rate workflow-execution-0001 --stars 4 --needs-improvement cta,hashtags --comment "CTA podia ser mais direto"
npm run zuno -- --quality-report --client-id client-rumo
```

## Como o Eduardo utiliza o histórico

1. Sempre depois do apoio opcional do Ícaro (para que uma recomendação de feedback nunca seja apagada por `mergeStrategyEnhancement`, que substitui `recommendationsForJoao` inteiro quando o Ícaro devolve uma lista).
2. Chama `getInsightsForClient(clientId)`, que olha só as últimas 10 avaliações do cliente (mais recentes primeiro) e devolve `lowScoringCategories` (média por categoria abaixo de 6/10), `recurringComplaints` (categorias marcadas "precisa melhorar" mais de uma vez) e `formatPerformance` (nota média por formato, ordenada).
3. `applyFeedbackInsights` traduz isso em frases **acrescentadas** a `recommendationsForJoao` — nunca reatribui `recommendedFormat`, `recommendedSlideCount`, `recommendedVideoDurationSeconds`, `recommendedChannel` ou `recommendedCta`. Os três exemplos do pedido foram implementados e validados em teste (unitário e, no caso de CTA, também via CLI real de ponta a ponta):
   - CTA com nota baixa → recomenda CTA mais forte e direto.
   - Hashtags com nota baixa → recomenda maior variedade.
   - Vídeo com nota melhor que carrossel → recomenda considerar vídeo, mantendo `recommendedFormat: "carrossel"` intacto.
4. Falha na consulta (ex.: repositório indisponível) é capturada e logada (`FeedbackHistoryFailed`) sem interromper Eduardo — mesmo padrão de tolerância a falha já usado para o Ícaro.

## Limitações

- `averageByCampaign` só inclui avaliações com `campaignId` explícito (`--campaign-id` na CLI); não há inferência automática de campanha ativa via Clara nesta fase.
- `lowScoringCategories` depende de `categoryScores` numéricos; feedback que só marca `categoriesNeedingImprovement` (sem nota por categoria) afeta apenas `recurringComplaints`.
- `recurringComplaints`/`lowScoringCategories` exigem repetição (mais de uma ocorrência na amostra recente) — uma única avaliação isolada não gera recomendação adicional, por design, para não reagir a ruído estatístico de amostra única.
- O nudge de formato (vídeo vs. carrossel) só é gerado quando o formato decidido pela heurística já é carrossel; não cobre todas as combinações possíveis de formato (ex.: comparação entre Story e imagem única), deliberadamente restrito ao exemplo pedido para manter o escopo previsível.
- `getInsightsForClient` olha um número fixo de avaliações recentes (10, não configurável via CLI/Eduardo nesta fase).

## Bug real encontrado e corrigido durante a implementação

Ao validar manualmente pela CLI (avaliar a mesma execução duas vezes, em dois processos separados), a **segunda avaliação sobrescrevia silenciosamente a primeira** no arquivo local. Causa raiz: `QualityFeedbackCenter` usa por padrão um gerador de id sequencial que reinicia em 1 a cada instanciação — seguro dentro de uma única execução de processo (como Arthur/Caio/Helena já fazem), mas quebrado para um histórico que se acumula **entre invocações separadas da CLI**, já que cada `--rate` roda em um processo novo e todo registro nascia com o mesmo id `quality-feedback-0001`. Corrigido criando `TimestampRandomIdGenerator` (tempo + aleatoriedade) e usando-o especificamente na instanciação do `QualityFeedbackCenter` dentro de `buildRuntime()` (`run-command.ts`) — o comportamento padrão da classe permanece sequencial para testes/uso efêmero. Coberto por um teste de regressão dedicado em `tests/cli.smoke.test.mjs` que roda dois processos `--rate` reais e confirma dois registros distintos no arquivo.

## Validações executadas

- `npm run typecheck` — sem erros.
- `npm test` — **460/460 testes passando** (partindo de 436 antes desta sessão: +16 em `tests/quality-feedback.test.mjs`, +7 em `tests/eduardo-editorial-planning.test.mjs`, +1 em `tests/cli.smoke.test.mjs`).
- `npm run architecture:check` — build completo + descoberta real de Skills inalterada (Quality Feedback corretamente **não aparece** como Skill descoberta, confirmando que a arquitetura baseada em Skills não foi tocada).
- Validação manual de ponta a ponta pela CLI real: execução completa → `--rate` (stars e score) → `--quality-report` → segunda execução com Eduardo consultando o histórico real e produzindo `feedbackInformed: true` com recomendação adicional.

## Sugestões futuras

1. Tornar o limite de amostra de `getInsightsForClient` (hoje fixo em 10) configurável, e considerar decaimento temporal (dar mais peso a avaliações recentes em vez de tratar as últimas N igualmente).
2. Inferir `campaignId` automaticamente a partir do `CampaignContext` ativo na Clara no momento da avaliação, reduzindo a dependência de `--campaign-id` manual.
3. Ampliar o nudge de formato para outras comparações (Story vs. imagem única, carrossel vs. imagem única), hoje restrito ao caso vídeo vs. carrossel do pedido original.
4. Expor `getReport`/`getInsightsForClient` também por uma futura API/painel (reaproveitando a mesma porta), quando essa camada de apresentação existir.
