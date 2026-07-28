# Relatório de Correção — Zuno RC2

**Data:** 2026-07-10
**Escopo:** Correção dos bugs Críticos e Altos registrados em `docs/rc1-consolidated-issues.md` e `docs/rc1-release-candidate-report.md` (homologação RC1). Arquitetura, Skills, módulos, portas, adapters e contratos permanecem congelados — nenhuma funcionalidade nova, nenhuma Skill nova, nenhuma responsabilidade realocada. Todas as correções foram feitas na causa raiz identificada na RC1, sem workarounds.

---

## 1. Bugs corrigidos

| ID | Severidade | Descrição | Status |
|---|---|---|---|
| BUG-01 | Crítica | Story com mais de 1 tela falhava sempre em Pedro | **Corrigido** |
| BUG-02 | Crítica | Slide de fechamento (CTA) cortado silenciosamente em carrosséis fora do objetivo de conversão | **Corrigido** |
| BUG-03 | Crítica | Formas no gerúndio/conjugadas dos verbos não reconhecidas na classificação do Eduardo | **Corrigido** |
| BUG-04 | Crítica | Colisão de id de execução do Caio entre invocações separadas da CLI | **Corrigido** |
| BUG-05 | Alta | Flag de CLI rejeitava valores começando com `--`; mensagem de exemplo sempre citava `--mode` | **Corrigido** |
| MELHORIA-02 | Baixa | Vocabulário de conversão incompleto ("anunciando", "promoção") | **Corrigido** (trivial, sem risco) |
| MELHORIA-01 | Baixa | "Presentear" enviesando classificação de objetivo | Mantido por decisão técnica (ver seção 9) |
| MELHORIA-03 | Baixa | Eduardo sem rótulo de formato "vídeo" genérico | Mantido por decisão técnica (ver seção 9) |
| UX-01 | Baixa | Erro de cliente inexistente usa wrapper genérico de exceção | Mantido por decisão técnica (ver seção 9) |
| GAP-01 | Baixa | Vídeo ativado por "roteiro" pode divergir da recomendação do Eduardo | Mantido por decisão técnica (já assim na RC1) |

BUG-01 a BUG-05 (todos os Críticos e o Alto) foram corrigidos, conforme exigido. Dos itens de baixa severidade, apenas MELHORIA-02 atendia ao critério "sem regressão nem aumento de complexidade" e foi corrigido; os demais foram mantidos (ver seção 9).

---

## 2. Arquivos alterados

**Código de produção:**
- `src/interfaces/cli/run-command.ts` — `CaioWorkflowExecutor` passa a receber `idGenerator: new TimestampRandomIdGenerator()` (BUG-04).
- `src/application/orchestration/arthur.orchestrator.ts` — novo `inputBinding` de `recommendedSlideCount` (Eduardo → Bianca) na etapa "Design de redes sociais" (BUG-01/BUG-02).
- `src/skills/bianca-social-media-design/bianca-social-media-design.types.ts` — novo campo opcional `recommendedSlideCount?: number` em `BiancaDesignRequestInput`.
- `src/skills/bianca-social-media-design/bianca-social-media-design.skill.ts` — `isCarouselFormat` reconhece "story"/"stories"; nova função `resolveSlideCount`; `buildSlides` usa `recommendedSlideCount` como fonte única de verdade quando presente (BUG-01/BUG-02).
- `src/skills/eduardo-editorial-planning/eduardo-editorial-planning.skill.ts` — listas `CONVERSION_KEYWORDS`, `DEMONSTRATION_KEYWORDS`, `EDUCATION_KEYWORDS`, `ENGAGEMENT_KEYWORDS` expandidas com formas no gerúndio de cada verbo, e com "anunciar"/"anunciando"/"promocao" (BUG-03 + MELHORIA-02).
- `src/interfaces/cli/index.ts` — `extractOption` passa a comparar o token seguinte contra a lista real de flags conhecidas (`KNOWN_CLI_FLAGS`) em vez de rejeitar qualquer valor começando com `--`; nova função `exampleValueFor` gera o exemplo de erro específico de cada flag (BUG-05).

**Testes (novos, todos de regressão):**
- `tests/bianca-social-media-design.test.mjs` — 4 testes novos (Story multi-slide, `recommendedSlideCount` respeitado, degradação seguro para contagem 1, heurística antiga preservada quando o campo está ausente).
- `tests/eduardo-editorial-planning.test.mjs` — 2 testes novos (gerúndio de 4 verbos, "anunciando"/"promoção").
- `tests/cli.smoke.test.mjs` — 2 testes novos (duas execuções não relacionadas nunca colidem de id; `--comment` aceita valor começando com `--` e a mensagem de erro cita a flag correta).

Nenhum arquivo de manifesto, contrato, porta ou adapter foi criado, removido ou teve sua assinatura pública alterada — apenas um campo opcional novo foi adicionado a um tipo de input já existente (`BiancaDesignRequestInput`), extensão aditiva e retrocompatível.

---

## 3 e 4. Causa raiz e como cada bug foi corrigido

### BUG-01 — Story com mais de 1 tela falhava sempre

**Causa raiz:** `isCarouselFormat` em Bianca só reconhecia `"carrossel"`, `"carousel"` e `"slides"`. Como `"story"` não estava na lista, Bianca sempre montava exatamente 1 slide (`buildSingleSlide`) para qualquer Story, enquanto Pedro recebia `imageCount` diretamente do Eduardo (3 por padrão para Story) através de um `inputBinding` próprio em Arthur. A divergência (1 slide descrito vs. 3 imagens pedidas) disparava um `blockingIssue` em `evaluateProductionReadiness` (Pedro), falhando a etapa.

**Correção:** `isCarouselFormat` (`bianca-social-media-design.skill.ts`) passou a incluir `"story"`/`"stories"` na lista de formatos que usam múltiplos slides/telas.

### BUG-02 — Slide de fechamento (CTA) cortado silenciosamente

**Causa raiz:** Bianca calculava sua própria contagem de slides a partir de `keyMessages.length` (heurística independente), nunca recebendo nem consultando `recommendedSlideCount` do Eduardo — a mesma fonte usada para o `imageCount` de Pedro. Quando os dois números não coincidiam, Pedro aplicava `slides.slice(0, imageCount)` (em `buildSlideProductionSpecs`), descartando os últimos slides — sempre incluindo o de Fechamento/CTA, construído por último — sem emitir nenhum warning.

**Correção:** três mudanças coordenadas, preservando a comunicação por nome de campo entre Skills isoladas (ADR 0002):
1. Novo campo opcional `recommendedSlideCount?: number` em `BiancaDesignRequestInput`.
2. Novo `inputBinding` em `arthur.orchestrator.ts` ligando `recommendedSlideCount` do Eduardo ao mesmo campo em Bianca (mesma fonte já usada para o `imageCount` de Pedro, na etapa logo abaixo).
3. Nova função `resolveSlideCount` em Bianca: quando `recommendedSlideCount` está presente, ele é a autoridade única (substitui a heurística de `keyMessages.length`); ausente, mantém a heurística original para retrocompatibilidade total com o comportamento já testado.

Como resultado, Bianca e Pedro sempre concordam na contagem de slides por construção — `slides.slice(0, imageCount)` em Pedro se torna um no-op, e o slide de Fechamento nunca é descartado. `buildSlides` também foi protegido contra o caso `slideCount <= 1` (degrada para peça única em vez de gerar dois slides com o mesmo índice).

**Verificação real (não só testes automatizados):** reexecutei ao vivo os Cenários 3 e 4 da homologação RC1 depois da correção. Story de 3 telas concluiu a etapa de Pedro pedindo corretamente "imagem 3 de 3" (antes falhava). O carrossel do Cenário 4 (Eduardo pediu 4 imagens) manteve `totalSlides: 4` e o slide `"Fechamento: converter atenção em ação."` presente no prompt final — antes, esse slide era descartado.

### BUG-03 — Formas no gerúndio/conjugadas não reconhecidas

**Causa raiz:** As listas de keywords do Eduardo (`CONVERSION_KEYWORDS`, `DEMONSTRATION_KEYWORDS`, `EDUCATION_KEYWORDS`, `ENGAGEMENT_KEYWORDS`) continham apenas a forma infinitiva de cada verbo, e a checagem é por substring literal (`text.includes(keyword)`). Como o gerúndio troca a terminação "-ar"/"-er"/"-ir" por "-ando"/"-endo", ele nunca contém o infinitivo como substring (ex.: "explicando" não contém "explicar").

**Correção:** cada verbo nas quatro listas ganhou sua forma explícita no gerúndio como entrada adicional (ex.: "explicar" + "explicando", "vender" + "vendendo"). Termos que não são verbos (ex.: "taxa zero", "desconto") não precisaram de alteração. Optei por expansão explícita da lista, em vez de um stemmer genérico: um stemmer genérico aplicado a **todos** os termos atingiria também termos como "presentear" (já sinalizado como fonte de falso-positivo na RC1 — MELHORIA-01), tornando aquele problema pior em vez de resolver este.

### BUG-04 — Colisão de id de execução entre invocações da CLI

**Causa raiz:** `CaioWorkflowExecutor` usa `SequentialCaioIdGenerator` (reinicia em 1) quando nenhum `idGenerator` é passado no construtor. `buildRuntime()` em `run-command.ts` nunca passava um `idGenerator` para `CaioWorkflowExecutor` — diferente de Quality Feedback e Campaign Manager, que já usavam `TimestampRandomIdGenerator` desde suas respectivas implementações. Como cada invocação da CLI é um processo Node novo, toda execução de workflow gerava `workflow-execution-0001`, e uma segunda execução não relacionada (rodada sem limpar `.zuno-data`/`artifacts`) reaproveitava silenciosamente o estado e os artefatos da primeira.

**Correção:** `buildRuntime()` agora passa `idGenerator: new TimestampRandomIdGenerator()` ao construir `CaioWorkflowExecutor`, mesma classe já usada e testada para Quality Feedback e Campaign Manager — nenhuma classe nova foi criada.

**Verificação real:** rodei duas CLIs completamente distintas em sequência, sem limpar o diretório de dados compartilhado; os dois ids gerados (`workflow-execution-mrf01d1n-rx0vl9` e `workflow-execution-mrf01d72-4sw9uj`) são únicos, contra o `workflow-execution-0001` fixo de antes.

### BUG-05 — Flag `--` rejeitada + mensagem de exemplo errada

**Causa raiz:** `extractOption` (CLI) rejeitava qualquer valor que começasse com `--`, mesmo quando esse valor era um texto legítimo do usuário (ex.: um comentário começando com "--"). A mensagem de erro sempre citava `${flag} local-production` como exemplo, mesmo quando a flag que falhou não era `--mode`.

**Correção:** `extractOption` agora só rejeita o valor quando ele **é exatamente** o nome de uma flag reconhecida da CLI (`KNOWN_CLI_FLAGS`, com todas as 22 flags existentes), preservando a proteção original contra "o usuário esqueceu o valor e o próximo token é outra flag" sem mais rejeitar textos legítimos que apenas começam com `--`. A mensagem de erro agora usa `exampleValueFor(flag)`, com um exemplo específico por flag, em vez de sempre sugerir `--mode local-production`.

---

## 5. Testes adicionados

Todos os testes novos são testes de regressão (reproduzem exatamente o cenário de falha da RC1 e travam se o bug voltar):

- **`tests/bianca-social-media-design.test.mjs`** (+4): reconhecimento de Story como multi-slide; `recommendedSlideCount` como autoridade sobre a heurística de `keyMessages`; degradação segura para peça única quando a contagem recomendada é 1 (sem colisão de índice); heurística antiga preservada quando o campo está ausente/inválido (retrocompatibilidade).
- **`tests/eduardo-editorial-planning.test.mjs`** (+2): classificação correta de "explicando"/"ensinando"/"mostrando"/"vendendo"; reconhecimento de "anunciando"/"promoção" como conversão.
- **`tests/cli.smoke.test.mjs`** (+2): duas execuções de workflow completamente diferentes, no mesmo ambiente compartilhado, nunca recebem o mesmo `executionId` e cada uma pausa corretamente na sua própria etapa de geração assistida; `--comment` aceita um valor começando com `--` e a mensagem de erro (quando a flag falha de verdade) cita a flag correta.

---

## 6. Validações executadas

- `npm run typecheck` — **sem erros**.
- `npm test` — **491/491 testes passando** (483 antes desta sessão + 8 novos testes de regressão).
- `npm run architecture:check` — build completo + descoberta real de Skills validada; as 12 Skills continuam descobertas corretamente, nenhuma capability órfã ou duplicada.
- Verificação manual ao vivo (CLI real, `LOCAL_PRODUCTION`), reproduzindo os cenários exatos da RC1: Story de 3 telas (Cenário 3) completou a etapa de Pedro sem falha; carrossel de demonstração (Cenário 4) preservou o slide de Fechamento com `totalSlides` consistente; duas execuções não relacionadas em sequência (Cenário 52) geraram ids únicos.

---

## 7. Possíveis impactos

- **Bianca/Pedro (BUG-01/02):** qualquer execução de Story ou carrossel agora usa exatamente a contagem de slides recomendada pelo Eduardo, em vez da heurística antiga baseada só em `keyMessages.length`. Isso muda o número de slides entregues em qualquer conteúdo onde os dois números já divergiam — essa é a correção pretendida, mas é uma mudança de comportamento observável (mais slides entregues em alguns casos, menos em outros, sempre alinhados ao que o Eduardo já recomendava e já era mostrado no relatório).
- **Eduardo (BUG-03 + MELHORIA-02):** textos que antes caíam no objetivo padrão `awareness` por usarem gerúndio (ex.: "...explicando...") agora classificam corretamente como `educacao`/`demonstracao`/`conversao`. Isso muda a estrutura narrativa e a emoção principal recomendadas para esses textos — mudança pretendida, mas observável em conteúdo já em produção que dependia do comportamento anterior.
- **Caio (BUG-04):** todo novo `workflow-execution-*` passa a ter um sufixo aleatório/temporal em vez de um número sequencial simples. Não afeta nada que dependa do formato do id (nenhum código do projeto faz parsing do sufixo numérico).
- **CLI (BUG-05):** qualquer script externo que dependia da mensagem de erro antiga (sempre "Exemplo: --mode local-production") precisa ser ajustado — a mensagem agora é específica por flag. Nenhum uso legítimo de flag deixou de funcionar; pelo contrário, valores antes rejeitados por engano agora são aceitos.

Nenhuma mudança alterou assinatura pública de porta/contrato, formato de `ExecutionPlan`, nem a forma como Helena descobre/carrega Skills.

---

## 8. Riscos remanescentes

- **Achado novo, fora do escopo desta correção:** ao verificar ao vivo o Cenário 3 (Story) após a correção do BUG-01, notei que o Story gerado usa `desiredAspectRatio: "4:5"` e resolução `1080x1350` — o mesmo valor estático usado para todos os formatos, hardcoded em `arthur.orchestrator.ts` (`input: { imageCount, desiredAspectRatio: "4:5" }`). Formats verticais como Story normalmente usam `9:16`. Este problema **já existia antes** (era estruturalmente impossível de observar, porque todo Story com mais de 1 tela falhava antes de chegar à geração de imagem), e só ficou visível agora que o BUG-01 foi corrigido. Não foi corrigido nesta sessão por estar fora do escopo dos bugs registrados na RC1 (nenhuma funcionalidade nova ou correção não solicitada deveria ser feita nesta fase) — fica registrado aqui explicitamente para ser tratado na RC2 ou em item específico do backlog.
- MELHORIA-01 (viés de "presentear"), MELHORIA-03 (rótulo "vídeo" genérico) e UX-01 (wrapper de erro genérico) permanecem sem correção — ver seção 9 para justificativa.
- A correção do BUG-03 cobre os verbos hoje presentes nas listas de keywords do Eduardo. Um verbo totalmente novo, ainda não listado, continuaria sujeito ao mesmo problema de vocabulário incompleto (risco residual inerente a qualquer lista fechada de palavras-chave, não uma falha da correção em si).
- A correção do BUG-02 depende de o Eduardo sempre rodar antes de Bianca no plano (`editorialPlanningStepId` presente). Isso já é garantido hoje — Eduardo é sempre a primeira etapa de qualquer plano de conteúdo — mas se um plano futuro (fora do escopo desta fase) removesse essa garantia, Bianca voltaria a usar sua heurística própria (comportamento de fallback seguro, não uma regressão silenciosa).

---

## 9. Bugs/melhorias que permaneceram por decisão técnica

- **MELHORIA-01** (viés de "presentear" na classificação): corrigir exigiria introduzir uma regra de precedência entre categorias de keywords (engajamento explícito vencendo termos de tópico genéricos) — uma mudança de comportamento de classificação mais ampla, com risco de afetar outros textos já classificados corretamente hoje. Não atende ao critério "sem regressão nem aumento de complexidade" definido para itens de baixa severidade nesta fase. Mantido como estava na RC1.
- **MELHORIA-03** (rótulo "vídeo" genérico distinto de "reels"): exigiria alterar o tipo `EduardoRecommendedFormat` e revisar onde "reels" é comparado por igualdade, criando um novo valor possível — aumento de complexidade e superfície de mudança desproporcional a uma melhoria cosmética de rótulo. Mantido como estava.
- **UX-01** (wrapper genérico de erro para cliente inexistente): corrigir exigiria uma nova categoria de erro dedicada na CLI e ajuste no tratamento de exceções do `main().catch()` — mudança estrutural na camada de erros da CLI, não uma correção pontual. Mantido como estava; a informação certa (qual clientId não foi encontrado) já chega ao usuário, só o prefixo da mensagem é genérico.
- **GAP-01** (vídeo ativado por "roteiro" pode divergir da recomendação do Eduardo): já havia sido explicitamente classificado como limitação arquitetural aceitável para o RC1 (não uma correção pendente) tanto na auditoria técnica quanto no relatório da RC1. Mantido sem alteração, consistente com a decisão já tomada.

---

## 10. Recomendação para iniciar a RC2 de homologação

Todos os 4 bugs Críticos e o bug Alto da RC1 foram corrigidos na causa raiz, com testes de regressão automatizados e verificação manual ao vivo confirmando cada correção nos cenários exatos que originalmente falharam. `npm run typecheck`, `npm test` (491/491) e `npm run architecture:check` passam sem ressalvas.

**Recomendação: reexecutar a suíte de homologação (`docs/homologacao-v1.0-checklist.md`) focada nos cenários antes reprovados** — 3, 4, 6, 7, 11, 12, 23, 25, 27, 29, 31, 33, 34, 51, 52, 54 — e nos aprovados-com-ressalva — 16, 18, 20, 22, 26, 55 — como suíde de regressão da RC2, sem necessidade de repetir os 33 cenários já aprovados sem ressalva na RC1 (cuja lógica não foi tocada nesta correção).

Ao planejar essa homologação, vale registrar como item de atenção (não um bug desta correção) a resolução/aspect ratio estática de Story descrita na seção 8, hoje visível pela primeira vez graças à correção do BUG-01.
