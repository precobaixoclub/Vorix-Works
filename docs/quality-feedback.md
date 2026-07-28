# Quality Feedback

Quality Feedback é o módulo de ciclo de melhoria contínua do Zuno. **Não é uma Skill**: não possui manifesto, não é descoberta por Helena e nunca participa de um `ExecutionPlan`. É um módulo de aplicação — mesmo nível arquitetural de Clara e Valentina — que registra avaliações humanas sobre execuções já concluídas, para que o Eduardo possa consultar esse histórico antes de montar um novo Editorial Brief.

## Por que não é uma Skill

Uma Skill é convocada por Arthur, através de Caio e Helena, dentro de um `ExecutionPlan`, para produzir um artefato do workflow (estratégia, copy, direção de arte, imagem, revisão etc.). Quality Feedback nunca é convocado assim: ele é consultado por outra Skill (Eduardo) como uma dependência opcional — exatamente como `IcaroBrainPort` — e é operado diretamente pela interface (CLI) depois que um workflow termina, fora do ciclo de vida de qualquer `ExecutionPlan`.

## Arquitetura

Estrutura idêntica, em espírito, a `src/application/knowledge` (Clara) e `src/application/tenancy` (Valentina):

- `quality-feedback.types.ts` — tipos: categorias, avaliação, registro, consulta, relatório, insights.
- `quality-feedback.port.ts` — `QualityFeedbackPort` (porta pública: `record`, `list`, `getReport`, `getInsightsForClient`).
- `quality-feedback-repository.port.ts` — `QualityFeedbackRepositoryPort` (porta de persistência: `save`, `list`).
- `quality-feedback-log.contract.ts` — logs próprios do módulo.
- `quality-feedback-center.ts` — `QualityFeedbackCenter`, implementação de `QualityFeedbackPort`.
- Infraestrutura: `InMemoryQualityFeedbackRepository` (testes) e `LocalJsonQualityFeedbackRepository` (`.zuno-data/quality-feedback.json`, mesmo padrão de `LocalJsonClaraKnowledgeRepository`).

## O que é armazenado

Cada avaliação (`QualityFeedbackRecord`) guarda:

- `id`, `executionId`, `clientId`, `submittedAt` (data);
- `contentType` (ex.: "imagem", "video", "texto") e `format` (ex.: "carrossel", "reels", "post único" — derivados automaticamente do relatório da execução pela CLI, sem o usuário precisar informar);
- `skillsUsed`: lista de Skills que participaram da execução avaliada;
- `campaignId` (opcional — só presente quando informado explicitamente);
- `overallScore`: nota geral normalizada de 1 a 10. Aceita as duas entradas citadas no pedido — `{ kind: "stars", value: 1-5 }` (convertida por `stars * 2`) ou `{ kind: "score", value: 1-10 }` — preservando a entrada original em `ratingInput` para auditoria;
- `categoryScores`: notas por categoria (granular, opcional);
- `categoriesNeedingImprovement`: categorias marcadas pelo usuário como "precisa melhorar" (checklist, independente de ter uma nota numérica);
- `comment`: comentário livre.

Categorias (`QUALITY_FEEDBACK_CATEGORIES`): `estrategia`, `copy`, `legenda`, `cta`, `hashtags`, `layout`, `design`, `hierarquia_visual`, `imagem`, `video`, `roteiro`, `tempo`, `reels`, `qualidade_geral` — exatamente a lista do pedido original.

## Exemplos de feedback

```jsonc
// ★★★★☆ com aspectos marcados e comentário
{
  "executionId": "workflow-execution-0001",
  "rating": { "kind": "stars", "value": 4 },
  "categoriesNeedingImprovement": ["cta", "hashtags"],
  "comment": "Legenda ficou boa, mas o CTA podia ser mais direto e as hashtags mais variadas."
}

// Nota de 1 a 10, com notas por categoria
{
  "executionId": "workflow-execution-0002",
  "rating": { "kind": "score", "value": 9 },
  "categoryScores": [{ "category": "video", "score": 9 }, { "category": "roteiro", "score": 8 }]
}
```

Via CLI:

```bash
npm run zuno -- --rate workflow-execution-0001 --stars 4 --needs-improvement cta,hashtags --comment "CTA podia ser mais direto"
npm run zuno -- --rate workflow-execution-0002 --score 9
npm run zuno -- --quality-report --client-id client-rumo
```

A CLI deriva `clientId`, `format`, `contentType` e `skillsUsed` automaticamente a partir de `artifacts/<executionId>/execution-report.json` (o mesmo relatório que a entrega final já grava) — o usuário só informa nota, categorias e comentário.

## Relatório local

`QualityFeedbackPort.getReport(query?)` devolve:

- `overallAverageScore`: média geral;
- `averageByFormat` / `averageBySkill` / `averageByCampaign`: médias agrupadas, ordenadas por volume de avaliações;
- `qualityOverTime`: evolução mensal (`YYYY-MM`) da média, em ordem cronológica;
- `bestRatedContent` / `worstRatedContent`: top 5 execuções mais e menos bem avaliadas;
- `topRecurringComplaints`: até 5 categorias mais frequentemente marcadas como "precisa melhorar", com contagem e proporção sobre o total avaliado.

## Como o Eduardo utiliza o histórico

Eduardo recebe `qualityFeedback?: QualityFeedbackPort` como dependência **opcional** (mesmo padrão do `IcaroBrainPort`). Antes de finalizar o Editorial Brief, se a dependência estiver configurada, Eduardo chama `getInsightsForClient(clientId)`, que devolve `QualityFeedbackInsights`:

- `lowScoringCategories`: categorias cuja nota média (via `categoryScores`) está abaixo de `QUALITY_FEEDBACK_LOW_SCORE_THRESHOLD` (6, em escala 1-10), calculada apenas sobre as últimas execuções do cliente (por padrão, as 10 mais recentes);
- `recurringComplaints`: categorias marcadas como "precisa melhorar" mais de uma vez nesse mesmo recorte;
- `formatPerformance`: nota média por formato, ordenada da melhor para a pior — permite comparar, por exemplo, vídeo com carrossel.

**Importante — o feedback nunca decide sozinho.** `applyFeedbackInsights` (em `eduardo-editorial-planning.skill.ts`) só acrescenta strings a `recommendationsForJoao`; `recommendedFormat`, `recommendedSlideCount`, `recommendedVideoDurationSeconds`, `recommendedChannel` e `recommendedCta` permanecem exatamente os mesmos que a heurística determinística já havia calculado. Os três exemplos do pedido original são tratados assim:

- **CTA com nota baixa** → `"Histórico de avaliações mostra nota baixa em CTA nas últimas execuções — recomenda-se um CTA mais forte e direto."`
- **Hashtags com nota baixa** → `"Histórico de avaliações mostra nota baixa em hashtags nas últimas execuções — recomenda-se maior variedade de hashtags."`
- **Vídeo com nota melhor que carrossel** (e o formato decidido pela heurística é carrossel) → `"Histórico mostra desempenho melhor em vídeo (média X) do que em carrossel (média Y) — considerar recomendar vídeo quando fizer sentido para o objetivo."` — o `recommendedFormat` continua `"carrossel"`; a nota é só uma recomendação adicional para o João avaliar no contexto daquele conteúdo.

O campo `feedbackInformed: boolean` no output de Eduardo indica se o histórico tinha avaliações suficientes para influenciar alguma recomendação nessa execução. Falha na consulta ao histórico (ex.: erro de I/O) nunca falha Eduardo — fica registrada em log (`FeedbackHistoryFailed`) e o planejamento segue apenas com heurística e, se configurado, Ícaro.

## Limitações

- `averageByCampaign` só inclui avaliações que informaram `campaignId` explicitamente (via `--campaign-id` na CLI); não há inferência automática de campanha ativa a partir da Clara nesta fase.
- `lowScoringCategories` depende de `categoryScores` numéricos terem sido informados; um feedback que só marca `categoriesNeedingImprovement` (sem nota por categoria) influencia `recurringComplaints`, não `lowScoringCategories`.
- `recurringComplaints`/`lowScoringCategories` exigem repetição (mais de uma ocorrência) — uma única avaliação isolada não gera recomendação adicional, por design (evita reagir a ruído de uma amostra única).
- Ids de avaliação usam `TimestampRandomIdGenerator` (tempo + aleatoriedade) especificamente na CLI, porque cada `--rate` roda em um processo novo e um contador sequencial reiniciado em 1 a cada processo colidiria e sobrescreveria avaliações anteriores no arquivo local (bug real, encontrado e corrigido durante esta implementação — ver relatório técnico).
