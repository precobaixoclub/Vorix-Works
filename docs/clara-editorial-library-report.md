# Relatório — Módulo 9 da Clara: Biblioteca Editorial

## 1. O que foi construído

Um nono e último módulo de conhecimento para a Clara, `EditorialLibraryContext`, que registra o
conhecimento editorial acumulado da marca: o que já foi produzido, o que funcionou, o que não
funcionou, e o que evitar repetir. Nenhuma Skill, nenhuma etapa de pipeline e nenhuma das três
camadas de orquestração (Arthur, Caio, Helena) foi alterada — a mudança inteira vive na Clara
(`src/application/knowledge/clara.types.ts`, `clara-knowledge-center.ts`) e em um novo módulo de
sincronização (`src/application/knowledge/clara-editorial-library-sync.ts`), acionado pelo mesmo
ponto que já sincroniza o Módulo 6 (Aprendizado): `recordQualityFeedback` na CLI.

## 2. Por que "biblioteca", e não "mais um relatório"

O Quality Feedback já sabe calcular nota média, pior/melhor conteúdo e reclamações recorrentes
(`QualityFeedbackReport`). O Módulo 6 (Aprendizado) já espelha isso na Clara. A Biblioteca Editorial
**não repete esse trabalho** — ela lê o conteúdo real de cada execução avaliada (tema, formato, CTA,
emojis, gancho, framework de storytelling) cruzado com a nota recebida, e responde a perguntas que
nem o Quality Feedback nem o Aprendizado respondem sozinhos:

- Que temas já usamos, e quantas vezes?
- Que peça específica foi campeã, e o que ela tinha em comum com as outras campeãs?
- Que assunto está indo mal repetidamente e deveria ser evitado por um tempo?
- Que ganchos, CTAs e emojis já foram testados, para não reinventar (ou repetir sem querer) a cada
  campanha nova?

## 3. Arquitetura

### 3.1 Schema (`EditorialLibraryContext`)

```ts
export type EditorialLibraryContext = ClaraKnowledgeBase & {
  producedContent?: EditorialLibraryContentEntry[];   // histórico cumulativo, um item por execução avaliada
  usedThemes?: string[];
  usedFormats?: string[];
  campaigns?: string[];
  objectives?: string[];
  ctas?: string[];
  emojis?: string[];
  hooks?: string[];
  storytellingPatterns?: string[];
  evaluations?: EditorialLibraryEvaluation[];          // espelho leve de cada avaliação, por execução
  workingPatterns?: string[];
  nonWorkingPatterns?: string[];
  repeatedSubjects?: string[];
  temporarilyForbiddenSubjects?: EditorialLibraryForbiddenSubject[];
  championContent?: EditorialLibraryHighlightedContent[];
  lowPerformanceContent?: EditorialLibraryLowPerformanceContent[];
  futureRecommendations?: string[];
  lastSyncedAt?: string;
};
```

Todo o versionamento, histórico e auditoria (`versions[]`, `history[]`, `ClaraAuditMetadata`) já
vêm de graça de `ClaraKnowledgeRecord`, exatamente como qualquer outro módulo — nenhum código extra
foi necessário para isso.

### 3.2 Extração de sinais (`extractEditorialSignals`)

Lê o `WorkflowExecutionReport` já concluído, por acesso a campo por nome (mesmo padrão de duck
typing que Caio já usa em `caio.executor.ts`, para nunca importar tipos de nenhuma Skill — preserva
ADR 0002):

| Sinal | Fonte | Passo do pipeline |
|---|---|---|
| Tema | `campaignObjective` (com fallback para `planSnapshot.intent.objective`) | Eduardo (`editorial_planning`) |
| Formato | `recommendedFormatLabel` | Eduardo (`editorial_planning`) |
| CTA | `cta` | Maria (`copywriting`) |
| Emojis | extraídos de `caption` por regex Unicode | Maria (`copywriting`) |
| Gancho | `hook` (só existe no pipeline de vídeo) | Bruno (`video_script`) |
| Storytelling | `narrativeStructure` (só existe no pipeline de vídeo) | Bruno (`video_script`) |

### 3.3 Enriquecimento pelo Campaign Manager

Quando a avaliação informa um `campaignId` conhecido, `recordQualityFeedback` busca a `CampaignPlan`
correspondente e repassa para `syncEditorialLibrary`. Se existir um `CampaignContentItem` cujo
`executionPlanId` bate com o plano executado, o tema (`topic`), o CTA planejado e o objetivo
(`role`) desse conteúdo — mais autoritativos, por virem do planejamento da campanha — sobrepõem os
sinais extraídos do report. Sem campanha conhecida, a sincronização funciona normalmente só com os
sinais do report (fallback seguro, testado).

### 3.4 Derivações (puras, determinísticas, sem IA)

- **Conteúdos campeões**: nota >= 8 (escala 1–10 do Quality Feedback).
- **Conteúdos de baixa performance**: nota < 6, reaproveitando `QUALITY_FEEDBACK_LOW_SCORE_THRESHOLD`
  já exportado por `quality-feedback-center.ts` — mesmo limiar que o próprio Quality Feedback usa,
  para as duas leituras nunca divergirem.
- **Assuntos repetidos**: tema usado 3 ou mais vezes.
- **Assuntos proibidos temporariamente**: tema com 2 ou mais avaliações cuja média fica abaixo do
  limiar de baixa performance — gera um motivo em texto pronto (`"Média de X em N avaliações — evitar
  reutilizar este tema até revisar a abordagem."`).
- **Padrões que funcionaram / não funcionaram**: observação textual sobre o formato dominante entre
  os campeões vs. entre os de baixa performance.
- **Recomendações futuras**: combina os três achados acima em texto acionável, no mesmo estilo já
  usado pelo Módulo 6 (`clara-learning-sync.ts`).

### 3.5 Acumulação, não substituição

Diferença deliberada em relação ao Módulo 6: `syncQualityFeedbackToClara` **substitui** o
`LearningContext` inteiro a cada chamada (é sempre um retrato agregado e atual). `syncEditorialLibrary`
é **cumulativo** — cada chamada acrescenta uma entrada a `producedContent` (ou substitui a entrada
existente da mesma execução, se for uma reavaliação — resincronizar nunca duplica), porque detectar
repetição de tema exige memória de tudo que já foi produzido, não só da avaliação mais recente.

## 4. Ponto de integração

Um único ponto de disparo, ao lado do Módulo 6, em `recordQualityFeedback`
(`src/interfaces/cli/run-command.ts`):

```ts
try {
  await syncQualityFeedbackToClara({ clara, qualityFeedback, clientId: context.clientId });
} catch (error) { /* aviso, nunca bloqueia */ }

try {
  const campaign = options.campaignId ? await campaignManager.getCampaign(options.campaignId) : undefined;
  await syncEditorialLibrary({ clara, clientId: context.clientId, report, feedbackRecord: record, campaign });
} catch (error) { /* aviso, nunca bloqueia */ }
```

Toda vez que uma execução recebe uma avaliação humana (`npm run zuno -- --rate ...`), a Biblioteca
Editorial é atualizada automaticamente, na mesma transação lógica do Módulo 6 — sem intervenção
manual e sem exigir nenhuma mudança em nenhuma Skill.

## 5. Como Eduardo, João e Maria usarão este módulo

Nenhuma Skill consulta `EditorialLibraryContext` ainda — igual aos outros módulos novos, ele existe
e já acumula conhecimento real desde a primeira avaliação registrada, pronto para ser pedido no dia
em que uma Skill adicionar `"EditorialLibraryContext"` à sua própria lista `modules: [...]`. O uso
pretendido:

**Eduardo (planejamento editorial)** — hoje decide `recommendedFormat` e `campaignObjective` sem
memória do que já foi tentado. Com a Biblioteca Editorial, poderia:
- Consultar `repeatedSubjects` e `temporarilyForbiddenSubjects` antes de propor um novo tema, e
  ativamente sugerir um ângulo diferente quando o tema pedido já está saturado ou performando mal.
- Consultar `championContent`/`workingPatterns` para entender que formato tem historicamente
  performado melhor para aquele cliente, e usar isso como sinal adicional (nunca substituindo sua
  própria heurística de formato, que continua sendo autoridade única).

**João (estratégia de marketing)** — hoje monta ângulo, promessa central e CTA recomendado sem saber
quais CTAs/ganchos já foram usados. Com a Biblioteca Editorial, poderia:
- Consultar `ctas` e `hooks` já usados para não repetir literalmente o mesmo CTA campanha após
  campanha, e para saber quais já foram validados como eficazes (via `championContent`).
- Consultar `futureRecommendations` para embutir diretamente no briefing enviado a Maria uma
  recomendação como "evitar o tema X, priorizar o formato Y".

**Maria (copywriting)** — hoje escreve legenda, CTA e hashtags sem histórico de storytelling.
Com a Biblioteca Editorial, poderia:
- Consultar `storytellingPatterns` e `emojis` já usados para variar o texto entre execuções
  (evitando "sempre a mesma abertura"), em vez de depender só da criatividade da IA desenvolvedora
  a cada chamada isolada.
- Consultar `nonWorkingPatterns` para saber que tipo de abordagem já foi mal avaliada e evitar
  repeti-la.

Em todos os três casos, o padrão de consulta seria idêntico ao de qualquer outro módulo: a Skill
adiciona `"EditorialLibraryContext"` à sua lista `modules` em `requestContext`, e passa a receber o
payload junto com os módulos que já pede hoje — nenhuma mudança na Clara, no Caio, no Arthur ou na
Helena seria necessária nesse momento futuro.

## 6. Testes

`tests/clara-editorial-library.test.mjs` (16 testes) cobre: extração de sinais (tema, formato, CTA,
emojis, fallback de tema via `planSnapshot.intent`, ausência de gancho/storytelling fora do pipeline
de vídeo), criação na primeira sincronização, acumulação em sincronizações sucessivas, idempotência
por execução (resync não duplica), detecção de tema repetido (>= 3 ocorrências), detecção de tema
proibido temporariamente (média abaixo do limiar em >= 2 avaliações), classificação de campeões e
baixa performance com derivação de padrões em texto, funcionamento sem Campaign Manager (fallback
seguro), enriquecimento de tema/CTA quando a campanha é conhecida, e — o teste mais importante para
a garantia pedida — confirmação de que `LearningContext` e o `QualityFeedbackRecord` original
continuam existindo e intocados depois que a Biblioteca Editorial é sincronizada (os três sistemas
coexistem, nenhum substitui o outro).

## 7. Validação técnica

- `npm run typecheck`: **limpo**, zero erros.
- `npm test`: **600/600 testes passando** (584 pré-existentes + 16 novos).
- `npm run architecture:check`: **limpo** — 12 Skills descobertas, todas READY, nenhuma capability
  duplicada ou ausente.

## 8. Estado final do Centro de Conhecimento da Clara

Com a Biblioteca Editorial, a Clara chega a **nove módulos temáticos** na fase "inteligência de
marketing": Identidade da Marca, Produto, Personas, Marketing, Direção Criativa, Aprendizado,
Concorrência, Playbook e Biblioteca Editorial — cobrindo quem a marca é, o que ela vende, para quem
vende, como se comunica, o que já funcionou e o que não funcionou. Dois desses módulos
(`LearningContext` e `EditorialLibraryContext`) já se alimentam sozinhos a cada avaliação real,
mesmo sem nenhuma Skill os consultar ainda — o conhecimento se acumula desde já, e fica pronto para
o dia em que Eduardo, João e Maria passarem a consultá-lo.
