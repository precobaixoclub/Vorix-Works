# RC1 — Lista consolidada de problemas encontrados na homologação

Homologação executada em 2026-07-10 contra a suíte `docs/homologacao-v1.0-checklist.md` (55 cenários, todos executados de fato via CLI real em `LOCAL_PRODUCTION`, com geração assistida real). Esta lista consolida **todo** problema encontrado — bug, regressão, melhoria de UX, de copy ou de design — antes de qualquer correção, conforme exigido para o RC1. Nenhum código foi alterado durante a homologação.

Cada item traz: ID, severidade, módulo afetado, Skill afetada (quando existir), descrição, como reproduzir, impacto e recomendação.

---

## BUG-01 — Story com mais de 1 tela falha sempre

- **Severidade:** Crítica
- **Módulo afetado:** `src/skills/bianca-social-media-design` → `src/skills/pedro-image-generation`
- **Skill afetada:** Bianca (Design de redes sociais) e Pedro (Geração de imagem)
- **Descrição:** Bianca decide se um pedido é multi-slide checando se o texto/formato contém as palavras `"carrossel"`, `"carousel"` ou `"slides"` (`isCarouselFormat`). O formato `"story"` não está nessa lista, então qualquer Story cai em `buildSingleSlide` e sempre produz exatamente **1** slide — independentemente de `recommendedSlideCount` do Eduardo (padrão 3 para Story). Pedro recebe `imageCount` do Eduardo/João (3) mas só encontra 1 slide descrito por Bianca, e falha com `"Carrossel solicitado com 3 imagens, mas Bianca descreveu apenas 1 slide(s)."`.
- **Como reproduzir:** `npm run zuno -- "crie um conteúdo para Instagram divulgando a confirmação de presença antes do prazo" --mode local-production` (Cenário 3, 7, 12 ou 31 do checklist). Falha 100% das vezes que o Story resultante tem mais de 1 tela.
- **Impacto:** Todo o formato Story com múltiplas telas está **completamente inutilizável** hoje — 4 de 4 cenários de Story testados falharam. Isso é uma lacuna funcional grave para um formato central do Instagram/TikTok.
- **Recomendação:** Adicionar `"story"` (e variações: `"stories"`) à lista de formatos multi-slide reconhecidos por `isCarouselFormat` em Bianca, e garantir que o número de telas geradas por Bianca para Story reconcilie com `recommendedSlideCount` do Eduardo (ver BUG-02, mesma causa raiz de fundo: falta de uma fonte única de verdade para a contagem de slides/telas).

---

## BUG-02 — Slide de fechamento (CTA) cortado silenciosamente em carrosséis

- **Severidade:** Crítica
- **Módulo afetado:** `src/skills/bianca-social-media-design` → `src/skills/pedro-image-generation`
- **Skill afetada:** Bianca (Design de redes sociais) e Pedro (Geração de imagem)
- **Descrição:** Bianca calcula sua própria contagem de slides a partir de `keyMessages.length` da Clara (limitada entre 3 e 10), **sem consultar** `recommendedSlideCount` do Eduardo. Para o tenant de demonstração, isso resulta consistentemente em **5 slides** (Gancho + 3 mensagens de apoio + Fechamento/CTA). Quando o `contentObjective` calculado por Eduardo não é `conversao` (cuja narrativa de 5 passos coincidentemente bate com os 5 slides de Bianca), `recommendedSlideCount` fica em **4**, e Pedro aplica `slides.slice(0, imageCount)` — descartando o **último** slide, que é sempre o Fechamento com o CTA. Nenhum warning é emitido (`warnings: []`).
- **Como reproduzir:** Qualquer carrossel cujo `contentObjective` não seja `conversao`, ex.: `npm run zuno -- "crie um carrossel com 2 imagens para Instagram sobre um tema com muitas mensagens-chave cadastradas na Clara" --mode local-production` (Cenário 51 do checklist, prova direta via inspeção do `execution-report.json`: Eduardo pediu `imageCount=2`, Bianca desenhou 5 slides, Pedro cortou para os 2 primeiros, descartando o Fechamento). Reproduzido também nos Cenários 4, 6, 11, 23, 25, 27, 29, 33 e 34.
- **Impacto:** O slide mais importante do ponto de vista de conversão (a chamada para ação final) é **removido sem qualquer aviso** em pelo menos 9 dos 13 cenários de carrossel testados fora do objetivo de conversão. O usuário recebe um carrossel "incompleto" sem saber disso — risco direto à qualidade de produção do produto.
- **Recomendação:** Unificar a fonte de verdade da contagem de slides: ou (a) Bianca passa a respeitar `recommendedSlideCount` do Eduardo como teto rígido ao montar seus slides (preservando sempre o slide de Fechamento como o último, redistribuindo/mesclando mensagens de apoio se necessário), ou (b) Pedro emite um warning explícito e recusa/pausa a execução quando `slides.length !== imageCount`, em vez de truncar silenciosamente. A opção (a) é a mais robusta a longo prazo.

---

## BUG-03 — Formas conjugadas/gerúndio dos verbos não são reconhecidas na classificação do Eduardo

- **Severidade:** Crítica
- **Módulo afetado:** `src/skills/eduardo-editorial-planning`
- **Skill afetada:** Eduardo (Planejamento editorial)
- **Descrição:** As listas de palavras-chave usadas para classificar `contentObjective` (`EDUCATION_KEYWORDS`, `DEMONSTRATION_KEYWORDS`, e o termo "vender" em `CONVERSION_KEYWORDS`) contêm apenas a forma **infinitiva** dos verbos ("explicar", "ensinar", "mostrar", "vender"). A checagem é por substring literal, então formas no gerúndio ou conjugadas ("explicando", "ensinando", "mostrando", "vendendo") **não contêm** o infinitivo como substring e não são reconhecidas, fazendo o texto cair no objetivo padrão `awareness`.
- **Como reproduzir:** Confirmado com um script Node isolado testando as strings, e reproduzido ao vivo em: Cenário 16 (`"...explicando como cadastrar..."` → classificado `awareness`, esperado `educacao`), Cenário 18 (`"...mostrando..."` → `awareness`, esperado `demonstracao`), Cenário 25/26 (`"...ensinando..."` → `awareness`, esperado `educacao`), Cenário 27 (`"...vendendo..."` → `awareness`, esperado `conversao`).
- **Impacto:** Uma fração significativa de pedidos em português natural (que tende a usar gerúndio: "explicando", "mostrando", "ensinando", "vendendo") nunca aciona a classificação correta de objetivo, mesmo quando a intenção do usuário é inequívoca. Isso enfraquece silenciosamente a proposta de valor central do Eduardo (decidir estratégia antes do João), pois o conteúdo cai sempre na estrutura narrativa genérica de `awareness`. Não quebra a pipeline (conteúdo ainda é gerado, coerente), mas degrada a qualidade da decisão estratégica.
- **Recomendação:** Trocar a checagem de substring literal por comparação de radicais/stems (ex.: checar se o texto contém `"explic"`, `"ensin"`, `"mostr"`, `"vend"` em vez da palavra completa), ou expandir cada lista de keywords para incluir explicitamente as formas de gerúndio e as conjugações mais comuns (presente, passado).

---

## BUG-04 — Colisão de id de execução entre invocações separadas da CLI (artefatos de execuções não relacionadas sendo reaproveitados)

- **Severidade:** Crítica
- **Módulo afetado:** `src/interfaces/cli/run-command.ts` (gerador de id usado por Caio para `workflow-execution-*`)
- **Skill afetada:** Nenhuma diretamente — afeta o orquestrador Caio e, por consequência, toda execução de workflow.
- **Descrição:** O gerador de id sequencial usado para as execuções reais de workflow (`SequentialCaioIdGenerator` ou equivalente) reinicia em 1 a cada novo processo Node. Como cada invocação da CLI (`npm run zuno -- "..."`) é um processo novo, duas execuções completamente não relacionadas, rodadas em sequência sem limpar `.zuno-data`/`artifacts`, geram o **mesmo id** `workflow-execution-0001`. A segunda invocação lê o estado (e os artefatos) já salvos pela primeira e os trata como se fossem seus — pulando direto para `WAITING_HUMAN_APPROVAL` sem nunca rodar Pedro de fato para o novo conteúdo.
- **Como reproduzir:** Confirmado com prova forense definitiva (Cenário 52 do checklist): gerada uma imagem PNG real marcada com o pixel (255,0,0) — vermelho puro — para um "Comando A" sobre "taxa zero"; concluído o workflow. Em seguida, rodado um "Comando B" totalmente diferente (sobre "confirmação de presença"), no mesmo ambiente, sem limpeza. Comando B pulou direto para `WAITING_HUMAN_APPROVAL` com Pedro já `[COMPLETED]`. Inspeção do PNG final confirmou que o primeiro pixel era exatamente (255,0,0) — a mesma imagem do Comando A foi entregue como se fosse conteúdo do Comando B. Este é o mesmo bug de causa raiz já identificado e corrigido para Quality Feedback e Campaign Manager (via `TimestampRandomIdGenerator`), mas nunca corrigido para as execuções de workflow do próprio Caio.
- **Impacto:** É o bug de maior risco desta homologação: em produção, isso significa que **conteúdo de um cliente ou campanha pode ser entregue sob a identidade de outra execução completamente diferente**, sem qualquer erro, warning ou log visível ao usuário. Viola diretamente a integridade e a rastreabilidade do conteúdo entregue.
- **Recomendação:** Trocar o gerador de id sequencial de Caio pelo mesmo `TimestampRandomIdGenerator` (ou equivalente com um componente aleatório/temporal) já usado em Quality Feedback e Campaign Manager, eliminando a possibilidade de colisão entre processos. Esta é a correção de maior prioridade a ser aplicada antes de qualquer RC2.

---

## BUG-05 — Flag de CLI rejeita valores que começam com `--`, e mensagem de exemplo sempre cita `--mode`

- **Severidade:** Alta
- **Módulo afetado:** `src/interfaces/cli/index.ts` (parsing de argumentos)
- **Skill afetada:** Nenhuma (camada de interface/CLI)
- **Descrição:** O parser de flags da CLI rejeita qualquer valor que comece literalmente com `--`, mesmo quando esse valor é um texto legítimo do usuário (ex.: um comentário de feedback que começa com `--`). Além disso, a mensagem de erro emitida sempre sugere o exemplo de `--mode` (`"Exemplo: --comment local-production."`), independentemente de qual flag realmente falhou — um exemplo de outra flag, incorreto e confuso.
- **Como reproduzir:** `npm run zuno -- --rate exec-B --score 8 --comment "--ótimo trabalho, parabéns" --mode local-production` (Cenário 54 do checklist) → erro `"Informe o valor de --comment. Exemplo: --comment local-production."`.
- **Impacto:** Impede o uso de comentários/textos legítimos que comecem com `--` (comum em copy criativa, ex. "-- confira já!"), e a mensagem de erro genérica confunde o usuário sobre qual flag de fato precisa de correção.
- **Recomendação:** Ajustar o parser para tratar o próximo token como valor da flag atual sempre que a flag exigir um argumento (independentemente do prefixo do token), permitindo opcionalmente um separador explícito (ex. `--comment=texto` ou `--`) para os casos ambíguos remanescentes. Corrigir a mensagem de erro para citar o nome e exemplo da flag que realmente falhou.

---

## UX-01 — Erro de cliente inexistente usa o wrapper genérico de exceção

- **Severidade:** Baixa
- **Módulo afetado:** `src/interfaces/cli/index.ts` (`main().catch()`)
- **Skill afetada:** Nenhuma (camada de interface/CLI)
- **Descrição:** Quando `--client-id` aponta para um cliente inexistente, Valentina já produz uma mensagem clara e específica ("Valentina não encontrou o cliente cliente-que-nao-existe."), mas ela chega ao usuário prefixada por `"[zuno] Erro inesperado: ..."` — o mesmo wrapper usado para exceções verdadeiramente inesperadas/internas.
- **Como reproduzir:** `npm run zuno -- "crie um post para Instagram" --client-id cliente-que-nao-existe --mode local-production` (Cenário 55 do checklist).
- **Impacto:** Baixo — a informação certa chega ao usuário, mas o tom de "erro inesperado" para um erro de digitação comum e esperado é desnecessariamente alarmante e não transmite profissionalismo.
- **Recomendação:** Tratar erros de validação conhecidos (cliente não encontrado, capability ausente etc.) com uma categoria de erro dedicada na CLI, exibida sem o prefixo "Erro inesperado", reservando esse texto exclusivamente para exceções realmente não previstas.

---

## MELHORIA-01 — "Presentear"/termos de tópico enviesando a classificação de objetivo

- **Severidade:** Baixa
- **Módulo afetado:** `src/skills/eduardo-editorial-planning`
- **Skill afetada:** Eduardo (Planejamento editorial)
- **Descrição:** Palavras de tópico/domínio como "presentear" contêm substrings que coincidem com keywords de `conversao` (ex. "presente" dentro de listas relacionadas a presentes/vendas), fazendo com que perguntas essencialmente de engajamento (ex. pedir para o público comentar sobre presentear alguém) sejam classificadas como conversão.
- **Como reproduzir:** Cenário 8 do checklist (`"...pergunte ao público sobre presentear o casal..."` → classificado `conversao`, quando a intenção era engajamento).
- **Impacto:** Baixo — o conteúdo final ainda é coerente e aprovável, mas a estrutura narrativa aplicada (conversão) não é a mais adequada à intenção original (engajamento).
- **Recomendação:** Dar prioridade a keywords de engajamento explícitas (ex. "comente", "participe", "responda") sobre keywords de tópico genéricas ao desempatar classificações, ou revisar a lista de keywords de conversão para não incluir substrings tão genéricos.

---

## MELHORIA-02 — Vocabulário de conversão incompleto ("anunciando", "promoção")

- **Severidade:** Baixa
- **Módulo afetado:** `src/skills/eduardo-editorial-planning`
- **Skill afetada:** Eduardo (Planejamento editorial)
- **Descrição:** Termos comuns de divulgação comercial como "anunciando" (Cenário 5) e "promoção" (Cenário 34) não estão presentes em `CONVERSION_KEYWORDS`, fazendo pedidos claramente comerciais caírem no objetivo padrão `awareness`.
- **Como reproduzir:** Cenários 5 e 34 do checklist.
- **Impacto:** Baixo isoladamente, mas se soma ao BUG-03 como parte de uma lacuna geral de cobertura de vocabulário na classificação determinística do Eduardo.
- **Recomendação:** Ao corrigir BUG-03, aproveitar para expandir as listas de keywords de todos os objetivos com os termos mais comuns de divulgação comercial em português (anunciar, promoção, oferta, lançamento etc.).

---

## MELHORIA-03 — Eduardo não tem rótulo de formato "vídeo" genérico

- **Severidade:** Baixa
- **Módulo afetado:** `src/skills/eduardo-editorial-planning`
- **Skill afetada:** Eduardo (Planejamento editorial)
- **Descrição:** `recommendedFormat` do Eduardo é sempre `"reels"` para qualquer conteúdo em vídeo, mesmo quando o texto do usuário só diz "vídeo" genérico sem menção a Reels/Shorts. Não há caminho de texto livre que produza um rótulo `"video"` distinto de `"reels"`.
- **Como reproduzir:** Cenário 22 do checklist (`"...crie um vídeo..."` sem outras pistas → `recommendedFormat: reels`).
- **Impacto:** Baixo — o conteúdo de vídeo é gerado corretamente de qualquer forma (a pipeline de vídeo não depende desse rótulo específico), mas o rótulo em relatórios/logs é tecnicamente impreciso quando o pedido não menciona Reels.
- **Recomendação:** Avaliar se vale a pena introduzir um rótulo `"video"` genérico distinto de `"reels"` para refletir melhor a intenção original, sem alterar o comportamento da pipeline.

---

## GAP-01 — Vídeo ativado por palavra "roteiro" pode divergir da recomendação de formato do Eduardo

- **Severidade:** Baixa (limitação arquitetural já documentada na auditoria técnica anterior, não uma regressão nova)
- **Módulo afetado:** `src/application` (Arthur/João — decisão de qual pipeline usar) e `src/skills/eduardo-editorial-planning`
- **Skill afetada:** Eduardo, indiretamente João
- **Descrição:** A palavra "roteiro" no texto do usuário ativa a pipeline de vídeo antes mesmo do Eduardo avaliar o `contentObjective` — então mesmo quando o objetivo classificado seria mais adequado a um carrossel (ex. conversão simples), a pipeline de vídeo já foi decidida.
- **Como reproduzir:** Cenário 20 do checklist.
- **Impacto:** Baixo — o vídeo ainda é gerado com estrutura coerente; é uma questão de a escolha de pipeline (imagem vs. vídeo) não ser mediada pelo Eduardo.
- **Recomendação:** Já registrado na auditoria técnica anterior como item de melhoria para a v2.0 (dar ao Eduardo poder de recomendar a via/pipeline, não só o formato dentro da via já escolhida). Nenhuma ação necessária para o RC1.

---

## Resumo por severidade

| Severidade | Quantidade | IDs |
|---|---|---|
| Crítica | 4 | BUG-01, BUG-02, BUG-03, BUG-04 |
| Alta | 1 | BUG-05 |
| Média | 0 | — |
| Baixa | 5 | UX-01, MELHORIA-01, MELHORIA-02, MELHORIA-03, GAP-01 |

**Regressões confirmadas em relação à auditoria técnica anterior (`docs/zuno-auditoria-1.0.html`):** BUG-02 (corte de slide) e BUG-04 (colisão de id) já haviam sido identificados por inferência estática na auditoria; esta homologação os **confirma com reprodução real e evidência forense**, elevando-os de "risco teórico" para "defeito comprovado em execução real". BUG-05 também já constava na auditoria e foi confirmado ao vivo. BUG-01 e BUG-03 são **achados novos**, não haviam sido identificados na auditoria estática anterior.
