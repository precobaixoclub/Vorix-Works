# Relatório técnico — Clara como base de conhecimento estruturada (v1.1 → fase "inteligência de marketing")

## 1. Objetivo e restrições respeitadas

Evoluir exclusivamente a Clara (Centro de Conhecimento) para os 8 módulos temáticos pedidos, sem
criar nenhuma Skill, sem alterar arquitetura, sem alterar pipelines e sem tocar em nenhuma linha de
código de Arthur, Caio, Helena, Eduardo, João, Maria, Sofia, Bianca, Pedro, Bruno, Vanessa, Diego,
Rafa, Lucas ou Ana. Confirmado por `npm run architecture:check` (as 12 Skills continuam descobertas
com exatamente as mesmas capabilities de antes) e pela suíte de testes de isolamento ampliada.

## 2. Arquitetura da nova base de conhecimento

Nenhuma peça nova de arquitetura foi introduzida. Clara continua sendo uma Skill sem IA, sem
publicação e sem geração de conteúdo, acessada exclusivamente por `ClaraKnowledgePort`. O mecanismo
que já existia — `ClaraKnowledgeModule` (união de literais) + `ClaraKnowledgePayloadByModule`
(mapa módulo → formato do payload) — é genérico o bastante para que adicionar conhecimento seja
**apenas dados**: um novo literal na união, um novo tipo de payload, uma entrada no mapa. Todo o
resto (`ClaraKnowledgeRecord<TModule>`, `create`, `update`, versionamento, histórico, auditoria,
`requestContext`) já era genérico sobre esse mapa e não precisou de nenhuma alteração.

A decisão de design mais importante desta fase: **4 dos 8 módulos pedidos foram implementados como
campos novos e opcionais em módulos que já existiam** (`BrandContext`, `ProductContext`,
`AudienceContext`, `IdentityContext`), em vez de módulos totalmente novos. Motivo: `requestContext`
só entrega os módulos que cada Skill pede explicitamente na própria lista `modules: [...]` dentro do
seu código-fonte. Um módulo com nome novo nunca chegaria a nenhuma Skill sem editar a Skill — o que
é proibido nesta fase. Estender um módulo que a Skill **já pede hoje** é a única forma de o
conhecimento novo se tornar realmente útil imediatamente, sem violar a restrição. Os outros 4
módulos (Marketing, Aprendizado, Concorrência, Playbook) não tinham nenhum lar natural em um módulo
existente, então nasceram como módulos novos — disponíveis na Clara, mas invisíveis a qualquer Skill
até que uma Skill futura opte por pedi-los (trabalho fora do escopo desta fase, por definição).

## 3. Módulos criados/estendidos

| # | Módulo do pedido | Implementação | Skills que já enxergam hoje |
|---|---|---|---|
| 1 | Identidade da Marca | Campos novos em `BrandContext` | Eduardo, João, Sofia, Bruno, Vanessa, Diego, Lucas, Pedro, Rafa |
| 2 | Produto | Campos novos em `ProductContext` | João |
| 3 | Personas | Campos novos em cada item de `AudienceContext.personas` | João, Sofia, Bruno, Vanessa, Diego |
| 4 | Marketing | Módulo novo `MarketingContext` | nenhuma (pronto para pedido futuro) |
| 5 | Direção Criativa | Campos novos em `IdentityContext` | João, Sofia, Bianca, Vanessa, Diego, Lucas, Pedro, Rafa |
| 6 | Aprendizado | Módulo novo `LearningContext`, alimentado automaticamente pelo Quality Feedback | nenhuma (pronto para pedido futuro) |
| 7 | Concorrência | Módulo novo `CompetitionContext` | nenhuma (pronto para pedido futuro) |
| 8 | Playbook | Módulo novo `PlaybookContext`; "histórico de mudanças" usa o versionamento genérico já existente | nenhuma (pronto para pedido futuro) |

Campos exatos de cada módulo, com a explicação de cada um, estão documentados em
`docs/clara-knowledge-center.md` (seção "Fase 'inteligência de marketing'").

## 4. Impacto esperado em cada Skill

**Nenhuma mudança de comportamento acontece automaticamente** — todas as 12 Skills continuam
pedindo exatamente os mesmos módulos de antes, então nenhuma resposta de nenhuma Skill muda hoje.
O impacto é de **disponibilidade**, não de comportamento:

- **Eduardo, João, Sofia, Bruno, Vanessa, Diego, Lucas, Pedro, Rafa** já recebem `BrandContext`
  e/ou `IdentityContext` inteiros hoje, e a maioria dos prompts para o Ícaro (ou para a IA
  desenvolvedora, no Developer Assisted Mode) serializa o contexto completo em JSON. Isso significa
  que, assim que a Clara tiver `mission`/`archetypes`/`formalityLevel`/`composition`/
  `approvedExamples` etc. preenchidos para um cliente, esses campos **já aparecem no prompt** que
  cada Skill constrói, sem qualquer edição de código — o ganho de qualidade é imediato, só depende
  dos dados serem cadastrados na Clara (ver seção 8, plano de alimentação).
- **Bianca** só pedia `IdentityContext`/`PublishingContext` — os novos campos de Direção Criativa
  chegam a ela do mesmo jeito.
- **Maria e Ana** não consultam a Clara diretamente (Maria recebe briefing já montado por João; Ana
  só usa `PublishingContext`) — nenhum módulo novo os afeta, nem deveria.
- **Marketing, Aprendizado, Concorrência e Playbook**: zero impacto em qualquer Skill até uma delas
  ser explicitamente atualizada para pedir o módulo — deliberadamente fora do escopo desta fase.

## 5. Arquivos alterados/criados

**Alterados:**
- `src/application/knowledge/clara.types.ts` — 4 novos literais de módulo; campos novos em
  `BrandContext`, `ProductContext`, `AudienceContext.personas`, `IdentityContext`; 4 novos tipos de
  payload (`MarketingContext`, `LearningContext`, `CompetitionContext`, `PlaybookContext`); mapa
  `ClaraKnowledgePayloadByModule` atualizado.
- `src/application/knowledge/clara-knowledge-center.ts` — `allModules()` (array runtime usado como
  padrão quando `requestContext` não informa `modules`) passou a incluir os 4 módulos novos.
- `src/application/knowledge/index.ts` — export do novo arquivo de sincronização.
- `src/interfaces/cli/run-command.ts` — `recordQualityFeedback` agora chama
  `syncQualityFeedbackToClara` depois de gravar a avaliação (com tratamento de erro que nunca
  bloqueia o registro do feedback em si).
- `docs/clara-knowledge-center.md` — nova seção descrevendo os 8 módulos e a integração automática
  com o Quality Feedback.
- `tests/clara-knowledge-center.test.mjs` — teste de isolamento ampliado de 5 para 16 arquivos
  (as 12 Skills + Arthur/Helena/Caio/Ícaro), mais um teste novo confirmando que toda Skill
  dependente da Clara usa só `ClaraKnowledgePort` (nunca a implementação concreta).
- `package.json` — novo arquivo de teste adicionado ao script `test`.

**Criados:**
- `src/application/knowledge/clara-learning-sync.ts` — `buildLearningContextPayload` (função pura)
  e `syncQualityFeedbackToClara` (orquestração), conectando Quality Feedback → Clara pela primeira
  vez.
- `tests/clara-knowledge-modules.test.mjs` — 13 testes novos (um por módulo/cenário, ver seção 6).
- `docs/clara-knowledge-modules-report.md` — este relatório.

**Preservado sem nenhuma alteração:** todas as 12 Skills, Arthur, Caio, Helena, Ícaro, todos os
pipelines, `LOCAL_PRODUCTION`, Developer Assisted Mode (texto, imagem e vídeo).

## 6. Testes adicionados (17 novos, 588 no total)

`tests/clara-knowledge-modules.test.mjs` (13): um teste por módulo (1 a 8, incluindo o caso do
Playbook provando que "histórico de mudanças" vem de graça do versionamento genérico via `update`/
`getVersion`), mais os testes de `LearningContext`/sincronização (`buildLearningContextPayload`
pura, `syncQualityFeedbackToClara` criando na primeira vez e atualizando — mesma versão do mesmo
registro — nas seguintes), mais 3 testes de compatibilidade/fallback: `requestContext` para um
módulo sem nenhum registro devolve lista vazia (nunca lança erro); uma Skill que só pede módulos
antigos nunca vê os novos; um registro "antigo" (só com os campos que já existiam antes desta fase)
continua sendo lido normalmente, com os campos novos simplesmente `undefined`.

`tests/clara-knowledge-center.test.mjs` (+2, um ampliado): isolamento de armazenamento cobrindo
agora as 12 Skills (antes só cobria Maria); novo teste confirmando que toda Skill que depende da
Clara importa apenas `ClaraKnowledgePort`/tipos, nunca `ClaraKnowledgeCenter`.

`npm run typecheck`, `npm test` (588/588) e `npm run architecture:check` — todos verdes.

## 7. Exemplos de utilização

**Cadastrar identidade de marca completa (Módulo 1):**
```ts
await clara.create({
  module: "BrandContext",
  title: "Identidade de marca — Rumo ao Altar",
  payload: {
    clientId: "client-rumo",
    brandName: "Rumo ao Altar",
    mission: "Tornar a organização do casamento leve para todo casal.",
    values: ["transparência", "leveza", "cuidado"],
    archetypes: ["Cuidador"],
    formalityLevel: "informal",
    preferredEmojis: ["💍", "✨"],
    communicationStyle: "caloroso e direto",
    toneOfVoice: "leve divertido persuasivo",     // campo já existente, continua funcionando
    mandatoryWords: ["Rumo ao Altar"],              // idem
  },
  audit: { actor: { id: "cli-user", type: "human" }, reason: "Cadastro de identidade completa" },
});
```

**Consultar aprendizado acumulado (Módulo 6, uso futuro por uma Skill):**
```ts
const context = await clara.requestContext({
  requester: { id: "eduardo-editorial-planning", type: "specialist" },
  clientId: "client-rumo",
  modules: ["BrandContext", "LearningContext"], // "LearningContext" precisa ser adicionado à lista da Skill
});
const learning = context.modules.LearningContext?.[0]?.payload;
// learning.bestRatedContent, learning.recurringPatterns, learning.futureRecommendations...
```

**Sincronizar aprendizado manualmente (fora do fluxo automático do `--rate`):**
```ts
import { syncQualityFeedbackToClara } from "../../application/knowledge/index.js";
await syncQualityFeedbackToClara({ clara, qualityFeedback, clientId: "client-rumo" });
```

## 8. Plano recomendado para alimentar a Clara com dados reais do Rumo ao Altar

Sugestão de ordem, do maior para o menor impacto imediato (por já serem consultados por várias
Skills hoje):

1. **BrandContext completo** — preencher `mission`, `vision`, `values`, `purpose`, `personality`,
   `archetypes`, `formalityLevel`, `preferredEmojis`/`forbiddenEmojis`, `communicationStyle`,
   `audienceAddressForm` para o Rumo ao Altar, além dos campos já usados hoje. Maior alcance:
   afeta 9 das 12 Skills imediatamente.
2. **IdentityContext completo** — preencher `composition`, `lighting`, `photographyStyle`,
   `layoutPatterns`, e principalmente `approvedExamples`/`rejectedExamples` com peças reais já
   produzidas (os pilotos de "taxa zero" gerados nesta sessão são um bom primeiro lote). Afeta 8
   Skills.
3. **AudienceContext.personas** — estruturar pelo menos 2-3 personas reais (ex.: "noiva
   organizadora", "convidado prático") com `pains`/`fears`/`objections`/`emotionalTriggers`/
   `funnelStage` reais, a partir do conhecimento que já existe sobre o público do Rumo ao Altar.
4. **ProductContext completo** — `features`, `objections`, `salesArguments`, `faq`,
   `commonCustomerMistakes`, `competitiveAdvantages` reais (RSVP, álbum colaborativo, cronograma,
   lista de presentes com taxa zero, site de casamento).
5. **Rodar `--rate` em execuções reais já concluídas** para começar a popular `LearningContext`
   automaticamente (não exige nenhuma ação manual além de avaliar conteúdo já produzido).
6. **MarketingContext, CompetitionContext, PlaybookContext** — podem ser alimentados quando
   houver decisão de negócio de wireá-los a alguma Skill; até lá, cadastrá-los cedo (mesmo sem
   nenhuma Skill consumindo ainda) já começa a construir o histórico versionado da Clara.

Nenhum desses passos exige alteração de código — são apenas chamadas a `clara.create`/`clara.update`
com dados reais, seguindo os exemplos da seção 7.
