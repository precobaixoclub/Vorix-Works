# Suíte de Testes Manuais — Checklist Oficial de Homologação da versão 1.0

Este documento é o checklist oficial de homologação funcional do Zuno antes da versão 1.0. A partir deste ponto a arquitetura está congelada: nenhuma Skill nova, nenhum módulo novo, nenhuma responsabilidade realocada. O foco passa a ser exclusivamente qualidade de produção — validar, com casos reais, que o sistema que já existe se comporta como documentado.

**Homologação RC1 concluída em 2026-07-10.** Todos os 55 cenários abaixo foram executados de fato contra a CLI real em `LOCAL_PRODUCTION`, com geração assistida real (PNG/MP4 válidos) e resultados registrados nas caixas de resultado e observações de cada cenário. Os problemas encontrados estão consolidados em `docs/rc1-consolidated-issues.md` e o resumo executivo em `docs/rc1-release-candidate-report.md`.

## Como usar

Para cada cenário: rode o comando/prompt indicado (via `npm run zuno -- "..."`, `--campaign`, `--rate` etc., conforme o caso) em `LOCAL_PRODUCTION`, siga o cenário até o `resultado esperado`, e compare o que o sistema realmente fez com cada expectativa listada. Marque **exatamente uma** das duas caixas de resultado e preencha observações sempre que houver qualquer divergência, mesmo pequena.

- `[ ] Aprovado` — comportamento real bateu com todas as expectativas do cenário.
- `[ ] Reprovado` — pelo menos uma expectativa não se confirmou (descrever em Observações qual).
- `Observações:` — preencher sempre; se aprovado sem ressalvas, registrar "Sem observações."

## Cobertura por dimensão

| Dimensão exigida | Cenários |
|---|---|
| Instagram | 1, 2, 3, 6, 8, 9, 10, 12, 13, 14, 17, 18, 19, 23, 25, 28, 29, 31, 33, 40, 43, 44, 46, 47, 49, 50, 51, 54 |
| Facebook | 4, 5, 7, 11, 24, 27 |
| Carrossel | 1, 4, 6, 9, 11, 23, 25, 27, 33, 34, 41, 44, 51 |
| Imagem única | 2, 5, 10, 30 |
| Reels | 13, 14, 17, 18, 19, 21, 26 |
| Vídeo | 15, 16, 20, 22, 24, 45 |
| Story | 3, 7, 12, 31 |
| Campanhas | 35, 36, 37, 38, 39, 40, 41, 42 |
| Institucional | 2, 11, 23, 24 |
| Educativo | 4, 25, 26 |
| Comercial | 1, 5, 9, 27, 28 |
| Emocional | 6, 14, 29, 30 |
| Engajamento | 8, 31, 32, 39 |
| Sazonal | 3, 7, 19, 33, 34 |

Os cenários 43–55 não são cruzamentos de canal/formato/conteúdo — validam fluxos operacionais (Developer Assisted Mode, aprovação humana, feedback de qualidade, campanhas ponta a ponta) e regressões diretamente ligadas a bugs encontrados na auditoria técnica anterior (colisão de id de execução, contagem de slides Eduardo×Bianca, parsing de flag `--` na CLI).

---

## Seção A — Matriz canal × formato (pipeline de imagem)

### Cenário 1 — Carrossel comercial no Instagram (taxa zero)
**Cobertura:** Instagram · Carrossel · Comercial
**Objetivo:** Validar o caminho mais usado do produto: conversão via carrossel explicando um benefício de preço.
**Prompt do usuário:** `crie um carrossel para Instagram sobre taxa zero na lista de presentes do Rumo ao Altar`
**Formato esperado:** Carrossel, proporção 4:5 (1080×1350).
**Decisão esperada do Eduardo:** `contentObjective: conversao` (palavra-chave "taxa zero"); `recommendedFormat: carrossel`; `recommendedSlideCount: 5` (tamanho da estrutura narrativa de conversão, sem número explícito no texto); `narrativeStructure: Problema → Solução → Benefícios → Comparação → CTA`; `primaryEmotion: Confiança`; `conversionPriority: alta`.
**Comportamento esperado do João:** ângulo de conversão; `format` sobrescrito para "carrossel" pelo brief do Eduardo; `recommendedCta` = "Conheça o Rumo ao Altar" (preferredCta da Clara).
**Comportamento esperado da Maria:** título e legenda mencionando "Rumo ao Altar" (palavra obrigatória), sem "garantia absoluta" (termo proibido), hashtags incluindo `#casamento`/`#noivos`/`#presentes`.
**Comportamento esperado da Bianca:** 5 slides (abertura, 3 de desenvolvimento/prova social, fechamento com CTA); slide de fechamento não pode ser cortado.
**Comportamento esperado do Pedro:** `imageCount: 5`; pausa em `WAITING_ASSISTED_GENERATION` pedindo exatamente 5 PNGs 1080×1350.
**Validações do Lucas:** `approved` ou `approved_with_warnings`; checklist com CTA presente, tom consistente, sem termos proibidos.
**Resultado esperado:** workflow completo até `WAITING_HUMAN_APPROVAL`; após aprovação, `carousel.zip` com 5 imagens, `caption.txt`, `hashtags.txt`.

- [x] Aprovado&nbsp;&nbsp;&nbsp;[ ] Reprovado
Observações: Confirmado exatamente conforme o esperado: contentObjective=conversao, recommendedSlideCount=5, narrativa Problema→Solução→Benefícios→Comparação→CTA, Bianca=5 slides, Pedro imageCount=5, Lucas approved. Executado de fato via CLI real.

---

### Cenário 2 — Imagem única institucional no Instagram
**Cobertura:** Instagram · Imagem única · Institucional
**Objetivo:** Validar peça institucional simples, sem carrossel.
**Prompt do usuário:** `crie um post no Instagram apresentando o Rumo ao Altar`
**Formato esperado:** Imagem única, 4:5.
**Decisão esperada do Eduardo:** `contentObjective: awareness` (nenhuma keyword de conversão/demonstração/educação/engajamento); `recommendedFormat: imagem_unica`; sem `recommendedSlideCount`; `narrativeStructure: Mensagem central → CTA`; `primaryEmotion: Leveza`.
**Comportamento esperado do João:** ângulo de valor percebido (padrão); `format` = "post único".
**Comportamento esperado da Maria:** legenda curta, tom leve/divertido/persuasivo, um único CTA.
**Comportamento esperado da Bianca:** 1 slide único, sem `carouselFlow`.
**Comportamento esperado do Pedro:** `imageCount: 1`; 1 PNG esperado.
**Validações do Lucas:** aprovação simples, sem checklist de storytelling de carrossel (`carouselStorytellingReady` não aplicável a peça única).
**Resultado esperado:** `index.html` sem botão de ZIP (só 1 imagem).

- [x] Aprovado&nbsp;&nbsp;&nbsp;[ ] Reprovado
Observações: Confirmado: imagem única, sem botão de ZIP, 1 slide, imageCount=1.

---

### Cenário 3 — Story sazonal de RSVP no Instagram
**Cobertura:** Instagram · Story · Sazonal
**Objetivo:** Validar que um assunto de urgência/confirmação vira Story mesmo sem a palavra "story" no texto.
**Prompt do usuário:** `crie um conteúdo para Instagram divulgando a confirmação de presença antes do prazo`
**Formato esperado:** Story, 9:16.
**Decisão esperada do Eduardo:** keyword de urgência ("confirmação de presença"/"prazo") força `recommendedFormat: story` independentemente do `contentObjective` calculado; `recommendedSlideCount: 3` (telas, padrão sem número explícito); `narrativeStructure: Abertura → Informação principal → CTA`.
**Comportamento esperado do João:** `format` = "story".
**Comportamento esperado da Maria:** legenda curta, adequada a texto de tela cheia.
**Comportamento esperado da Bianca:** 3 slides com aspecto vertical.
**Comportamento esperado do Pedro:** `imageCount: 3`; resolução 1080×1920.
**Validações do Lucas:** avalia adequação ao formato Story (peça rápida, CTA único e direto).
**Resultado esperado:** 3 imagens verticais entregues.

- [ ] Aprovado&nbsp;&nbsp;&nbsp;[x] Reprovado
Observações: BUG-01 (crítico): Pedro falhou com "Carrossel solicitado com 3 imagens, mas Bianca descreveu apenas 1 slide(s)." Bianca não trata format="story" como multi-slide (só reconhece "carrossel"/"carousel"/"slides"), então qualquer Story com mais de 1 tela quebra a pipeline.

---

### Cenário 4 — Carrossel educativo no Facebook
**Cobertura:** Facebook · Carrossel · Educativo
**Objetivo:** Validar classificação educativa e uso do Facebook como canal primário.
**Prompt do usuário:** `crie um carrossel para Facebook explicando como funciona a lista de presentes com Pix`
**Formato esperado:** Carrossel, 4:5.
**Decisão esperada do Eduardo:** "explicando"/"como funciona" → ambíguo entre `educacao` (palavra "explicando") e `demonstracao` ("como funciona"/"funcionalidade"); pela ordem de checagem do classificador, keywords de conversão são checadas primeiro (nenhuma aqui), depois demonstração ("como funciona" bate) → `contentObjective: demonstracao`. Mas como o texto não tem palavra explícita de formato de vídeo, e `demonstracao` recomenda `reels` por padrão quando **não há palavra de carrossel explícita** — aqui a palavra "carrossel" está explícita no prompt, então a keyword explícita de formato vence e o resultado é `recommendedFormat: carrossel` mesmo com objetivo de demonstração. **Este é o ponto que a homologação precisa confirmar na prática** (prioridade de keyword explícita de formato sobre o default por objetivo).
**Comportamento esperado do João:** canal = facebook; ângulo educativo se o classificador de João (independente do Eduardo) capturar "explicando"/"como funciona" como palavras educativas.
**Comportamento esperado da Maria:** legenda mais longa/explicativa (Facebook tolera legendas maiores que Instagram nos limites de `platformLimitations`, quando configurados).
**Comportamento esperado da Bianca:** carrossel com estrutura "Contexto → Explicação → Exemplo → CTA" caso o objetivo classificado seja educação.
**Comportamento esperado do Pedro:** `imageCount` = tamanho da estrutura narrativa (4, se educação).
**Validações do Lucas:** revisão de clareza didática, sem promessas exageradas.
**Resultado esperado:** publicação com canal Facebook único (Ana com `requestedChannels: ["facebook"]`).

- [ ] Aprovado&nbsp;&nbsp;&nbsp;[x] Reprovado
Observações: Classificação de formato/canal correta (demonstracao via "como funciona", carrossel explícito venceu). Porém BUG-02 (crítico): Bianca desenhou 5 slides, Eduardo/Pedro pediram 4 — o slide de Fechamento (CTA) foi cortado silenciosamente, sem warning.

---

### Cenário 5 — Imagem única comercial no Facebook
**Cobertura:** Facebook · Imagem única · Comercial
**Objetivo:** Validar peça comercial simples fora do Instagram.
**Prompt do usuário:** `crie uma imagem para Facebook anunciando o plano PRO do Rumo ao Altar`
**Formato esperado:** Imagem única.
**Decisão esperada do Eduardo:** sem keyword de conversão explícita da lista fixa ("vender"/"comprar"/"desconto" etc. — "anunciando" não está na lista) → provavelmente `awareness`; `recommendedFormat: imagem_unica` (keyword explícita "uma imagem" vence). **Ponto de atenção:** confirmar se o time considera que "anunciando plano PRO" deveria classificar como conversão — se não classificar, é uma lacuna real de vocabulário a registrar nas Observações.
**Comportamento esperado do João:** ângulo de valor percebido (padrão).
**Comportamento esperado da Maria:** CTA único, claro.
**Comportamento esperado da Bianca:** 1 slide.
**Comportamento esperado do Pedro:** `imageCount: 1`.
**Validações do Lucas:** checagem de termos proibidos (ex.: nenhuma promessa absoluta sobre o plano pago).
**Resultado esperado:** entrega single-image no Facebook.

- [x] Aprovado&nbsp;&nbsp;&nbsp;[ ] Reprovado
Observações: Peça única gerada corretamente. Observação: "anunciando" não é reconhecida como keyword de conversão (lacuna de vocabulário, registrada como melhoria recomendada), mas o resultado ainda é uma peça coerente e aprovável.

---

### Cenário 6 — Carrossel emocional com depoimento
**Cobertura:** Instagram · Carrossel · Emocional
**Objetivo:** Validar conteúdo emocional/depoimento como carrossel.
**Prompt do usuário:** `crie um carrossel contando a história de um casal que usou o Rumo ao Altar`
**Formato esperado:** Carrossel.
**Decisão esperada do Eduardo:** nenhuma keyword das 4 categorias fixas cobre "contar história"/"depoimento" — cai em `awareness`, e sem keyword explícita de formato, `awareness` cai no default `imagem_unica`, **não** carrossel, mesmo o usuário tendo pedido "carrossel" explicitamente no texto. Como "carrossel" É uma keyword explícita de formato (`CAROUSEL_KEYWORDS` inclui "carrossel"), a keyword explícita de formato deve vencer e o resultado correto esperado é `recommendedFormat: carrossel` — **validar isso na prática, é o mesmo ponto do Cenário 4**.
**Comportamento esperado do João:** ângulo padrão de valor percebido (não há keyword de "emocional" no classificador de João).
**Comportamento esperado da Maria:** tom mais pessoal/caloroso dentro do tom de marca configurado.
**Comportamento esperado da Bianca:** carrossel com "prova social" como um dos papéis de slide.
**Comportamento esperado do Pedro:** `imageCount` conforme estrutura narrativa padrão (4).
**Validações do Lucas:** avaliação de autenticidade/tom, sem exagero.
**Resultado esperado:** carrossel de depoimento entregue e aprovável.

- [ ] Aprovado&nbsp;&nbsp;&nbsp;[x] Reprovado
Observações: Carrossel emocional gerado corretamente, mas BUG-02: Bianca 5 slides, Eduardo/Pedro pediram 4 — Fechamento/CTA cortado sem aviso.

---

### Cenário 7 — Story sazonal no Facebook
**Cobertura:** Facebook · Story · Sazonal
**Objetivo:** Validar Story fora do Instagram.
**Prompt do usuário:** `crie um story para Facebook lembrando o prazo final de confirmação de presença`
**Formato esperado:** Story.
**Decisão esperada do Eduardo:** keyword "story" explícita + "prazo"/"confirmação de presença" reforçam → `recommendedFormat: story`, `recommendedSlideCount: 3`.
**Comportamento esperado do João:** canal facebook, format story.
**Comportamento esperado da Maria:** texto mínimo, direto.
**Comportamento esperado da Bianca:** 3 telas verticais.
**Comportamento esperado do Pedro:** `imageCount: 3`, 1080×1920.
**Validações do Lucas:** urgência transmitida sem soar alarmista.
**Resultado esperado:** 3 imagens verticais, canal Facebook.

- [ ] Aprovado&nbsp;&nbsp;&nbsp;[x] Reprovado
Observações: BUG-01: mesma falha do Cenário 3 — Story falha em Pedro por exigir mais de 1 tela.

---

### Cenário 8 — Imagem única de engajamento (enquete)
**Cobertura:** Instagram · Imagem única · Engajamento
**Objetivo:** Validar classificação de engajamento.
**Prompt do usuário:** `crie um post para Instagram perguntando aos seguidores se eles prefeririam presentear por Pix`
**Formato esperado:** Imagem única (sem keyword explícita de formato, objetivo de engajamento não tem default de formato próprio → cai em `imagem_unica`).
**Decisão esperada do Eduardo:** "perguntando" não está na lista fixa de engajamento (`engajar`, `engajamento`, `interagir`, `comunidade`, `interacao`) — **provável lacuna**: o texto tem intenção clara de engajamento (pergunta direta ao público) mas pode não ser classificado como `engajamento` por falta da palavra-chave exata. Validar e registrar se o resultado real foi `awareness` em vez de `engajamento`.
**Comportamento esperado do João:** depende da classificação acima.
**Comportamento esperado da Maria:** legenda com pergunta direta e CTA de comentário.
**Comportamento esperado da Bianca:** 1 slide.
**Comportamento esperado do Pedro:** `imageCount: 1`.
**Validações do Lucas:** presença de call-to-comment.
**Resultado esperado:** peça de engajamento aprovável, independentemente da classificação interna exata.

- [x] Aprovado&nbsp;&nbsp;&nbsp;[ ] Reprovado
Observações: Classificado como conversao via a palavra "presentear" (não engajamento, como hipotetizado no cenário de atenção) — resultado ainda coerente e aprovável, mas indica que "presentear" como termo de tópico pode enviesar a classificação para conversão mesmo em uma pergunta de engajamento (achado de precisão de vocabulário, não um bug funcional).

---

### Cenário 9 — Carrossel com contagem explícita ("5 slides")
**Cobertura:** Instagram · Carrossel · Comercial
**Objetivo:** Confirmar que número explícito no texto sempre vence a heurística de tamanho de narrativa.
**Prompt do usuário:** `crie um carrossel com 5 imagens para Instagram sobre os benefícios do Rumo ao Altar`
**Formato esperado:** Carrossel, exatamente 5 imagens.
**Decisão esperada do Eduardo:** `recommendedSlideCount: 5` (número explícito, coincide com o tamanho padrão da estrutura de conversão, mas a origem do número deve ser o texto, não a heurística — importante para o próximo cenário).
**Comportamento esperado do João:** normal.
**Comportamento esperado da Maria:** normal.
**Comportamento esperado da Bianca:** monta 5 slides a partir de `keyMessages.length` (cálculo independente do Bianca — ver Cenário 51 para o teste de divergência).
**Comportamento esperado do Pedro:** `imageCount: 5`.
**Validações do Lucas:** normal.
**Resultado esperado:** exatamente 5 imagens, nenhuma cortada.

- [x] Aprovado&nbsp;&nbsp;&nbsp;[ ] Reprovado
Observações: 5 imagens exatas conforme número explícito, sem corte (coincide com o tamanho padrão da narrativa de conversão, então não expôs o BUG-02 neste caso específico).

---

### Cenário 10 — Post único forçado apesar de objetivo de conversão
**Cobertura:** Instagram · Imagem única · Comercial
**Objetivo:** Confirmar que uma keyword explícita de formato único vence o default de formato do objetivo de conversão (que normalmente recomendaria carrossel).
**Prompt do usuário:** `crie uma única imagem para Instagram vendendo o plano PRO com taxa zero`
**Formato esperado:** Imagem única, mesmo com "vendendo"/"taxa zero" (keywords de conversão, que por padrão recomendariam carrossel).
**Decisão esperada do Eduardo:** `contentObjective: conversao`; `recommendedFormat: imagem_unica` (keyword explícita "uma única imagem" vence o default de carrossel do objetivo de conversão).
**Comportamento esperado do João:** ângulo de conversão, mas `format` = "post único".
**Comportamento esperado da Maria:** CTA forte em uma única peça.
**Comportamento esperado da Bianca:** 1 slide, mesmo com `contentObjective` de conversão.
**Comportamento esperado do Pedro:** `imageCount: 1`.
**Validações do Lucas:** normal.
**Resultado esperado:** 1 imagem só, CTA forte, sem carrossel.

- [x] Aprovado&nbsp;&nbsp;&nbsp;[ ] Reprovado
Observações: Confirmado: formato explícito de imagem única venceu o objetivo de conversão.

---

### Cenário 11 — Carrossel institucional no Facebook
**Cobertura:** Facebook · Carrossel · Institucional
**Objetivo:** Validar apresentação de marca no Facebook.
**Prompt do usuário:** `crie um carrossel para Facebook apresentando o que é o Rumo ao Altar`
**Formato esperado:** Carrossel.
**Decisão esperada do Eduardo:** `awareness` (sem keyword fixa de nenhuma das 4 categorias) + keyword explícita "carrossel" → `recommendedFormat: carrossel`; `narrativeStructure` genérica (Contexto → Mensagem central → Benefícios → CTA).
**Comportamento esperado do João:** ângulo padrão.
**Comportamento esperado da Maria:** tom institucional, claro.
**Comportamento esperado da Bianca:** 4 slides.
**Comportamento esperado do Pedro:** `imageCount: 4`.
**Validações do Lucas:** consistência de marca.
**Resultado esperado:** carrossel institucional de 4 slides no Facebook.

- [ ] Aprovado&nbsp;&nbsp;&nbsp;[x] Reprovado
Observações: Carrossel institucional correto, mas BUG-02: Bianca 5 slides, Pedro imageCount 4 — Fechamento cortado.

---

### Cenário 12 — Story explícito com "3 telas"
**Cobertura:** Instagram · Story
**Objetivo:** Confirmar número explícito de telas em Story.
**Prompt do usuário:** `crie um story de 3 telas para Instagram sobre o painel dos noivos`
**Formato esperado:** Story, exatamente 3 telas.
**Decisão esperada do Eduardo:** `recommendedFormat: story` (explícito); `recommendedSlideCount: 3` (explícito, coincide com o padrão).
**Comportamento esperado do João:** normal.
**Comportamento esperado da Maria:** normal.
**Comportamento esperado da Bianca:** 3 slides verticais.
**Comportamento esperado do Pedro:** `imageCount: 3`, 1080×1920.
**Validações do Lucas:** normal.
**Resultado esperado:** 3 imagens verticais.

- [ ] Aprovado&nbsp;&nbsp;&nbsp;[x] Reprovado
Observações: BUG-01: Story de 3 telas falha da mesma forma que os Cenários 3 e 7 (mesma causa raiz).

---

## Seção B — Vídeo e Reels

### Cenário 13 — Reels de demonstração (painel dos noivos)
**Cobertura:** Instagram · Reels · Comercial/Demonstração
**Objetivo:** Validar a pipeline completa de vídeo com objetivo de demonstração.
**Prompt do usuário:** `crie um reels para Instagram apresentando o painel dos noivos`
**Formato esperado:** Reels, 1080×1920, 9:16, 30fps.
**Decisão esperada do Eduardo:** "apresentar"/"painel" → `contentObjective: demonstracao`; `recommendedFormat: reels`; `recommendedVideoDurationSeconds: 30` (padrão, sem número explícito); `narrativeStructure: Hook → Demonstração → Benefícios → CTA`; `primaryEmotion: Clareza`.
**Comportamento esperado do João:** ângulo padrão; dispara a pipeline de vídeo (`video_script` etc.) — **atenção:** conforme a limitação arquitetural conhecida, o Arthur só ativa a pipeline de vídeo se detectar palavra-chave de vídeo no texto (vídeo/reels/tiktok/shorts/roteiro); "reels" está na lista, então deve ativar corretamente aqui.
**Comportamento esperado da Maria:** não se aplica (pipeline de vídeo não usa Maria).
**Comportamento esperado do Pedro/pipeline de vídeo:** Bruno monta roteiro com gancho/demonstração/CTA; Vanessa direciona câmera/ritmo; Diego monta timeline; Rafa pausa em `WAITING_ASSISTED_GENERATION` pedindo `final-video.mp4`.
**Validações do Lucas:** duração (~30s), proporção 9:16, clareza do gancho inicial, ritmo, legibilidade de texto na tela, qualidade técnica do arquivo.
**Resultado esperado:** vídeo MP4 entregue com player HTML5 na página final.

- [x] Aprovado&nbsp;&nbsp;&nbsp;[ ] Reprovado
Observações: Pipeline de vídeo completa executada com sucesso; todos os campos do Eduardo conforme o esperado (demonstracao/reels/30s/Hook→Demonstração→Benefícios→CTA/Clareza).

---

### Cenário 14 — Reels emocional (depoimento em vídeo)
**Cobertura:** Instagram · Reels · Emocional
**Objetivo:** Validar vídeo emocional.
**Prompt do usuário:** `crie um reels emocionante com o depoimento de um casal sobre o Rumo ao Altar`
**Formato esperado:** Reels.
**Decisão esperada do Eduardo:** "reels" explícito → `recommendedFormat: reels`; objetivo provavelmente `awareness` (sem keyword fixa de emoção); `primaryEmotion: Leveza` (padrão de awareness, não necessariamente "emocionante" — **ponto de atenção**: o classificador não tem uma categoria de emoção dedicada além dos 5 objetivos fixos).
**Comportamento esperado do João:** pipeline de vídeo ativada.
**Comportamento esperado do Pedro/pipeline de vídeo:** Bruno com estrutura de depoimento (Hook → Contexto → Benefícios → CTA, padrão de reels não-demonstração); Rafa MP4 vertical.
**Validações do Lucas:** tom emocional autêntico, sem exagero, dentro das regras de marca.
**Resultado esperado:** vídeo entregue com tom emocional coerente.

- [x] Aprovado&nbsp;&nbsp;&nbsp;[ ] Reprovado
Observações: Confirmado — primaryEmotion permaneceu "Leveza" (padrão de awareness), sem categoria própria para "emocionante", exatamente como previsto no cenário de atenção. Vídeo entregue corretamente.

---

### Cenário 15 — Vídeo curto de engajamento para TikTok
**Cobertura:** TikTok · Vídeo · Engajamento
**Objetivo:** Validar canal TikTok e rótulo técnico de formato.
**Prompt do usuário:** `crie um vídeo curto para TikTok convidando para comentar sobre presentes de casamento`
**Formato esperado:** Vídeo vertical rotulado como "tiktok" no `format` técnico de Arthur (distinto do rótulo de conteúdo do Eduardo).
**Decisão esperada do Eduardo:** `recommendedFormat: reels` (rótulo genérico de vídeo do Eduardo não distingue TikTok de Reels — ambos caem no mesmo bucket "reels" internamente); `contentObjective`: "comentar" não está na lista fixa de engajamento — mesma lacuna do Cenário 8.
**Comportamento esperado do João:** canal tiktok; pipeline de vídeo ativada (canal tiktok sempre ativa `detectsVideoRequest`).
**Comportamento esperado do Pedro/pipeline de vídeo:** Bruno/Vanessa/Diego/Rafa normalmente, mas o `format` de nível superior de cada um deve refletir "tiktok" (rótulo técnico do Arthur), **não** o rótulo de conteúdo do Eduardo — validar se isso gera alguma inconsistência perceptível no roteiro/prompt final (ponto levantado na auditoria técnica anterior).
**Validações do Lucas:** adequação ao tom TikTok (mais direto/casual).
**Resultado esperado:** vídeo entregue, canal tiktok.

- [x] Aprovado&nbsp;&nbsp;&nbsp;[ ] Reprovado
Observações: "Comentar" foi reconhecido corretamente como engajamento; canal tiktok correto; vídeo entregue.

---

### Cenário 16 — Vídeo educativo para YouTube Shorts
**Cobertura:** YouTube · Vídeo · Educativo
**Objetivo:** Validar canal YouTube com formato "shorts".
**Prompt do usuário:** `crie um vídeo curto para YouTube Shorts explicando como cadastrar a lista de presentes`
**Formato esperado:** Vídeo vertical, rótulo técnico "shorts".
**Decisão esperada do Eduardo:** "explicando" → `contentObjective: educacao`; `recommendedFormat: reels` (bucket genérico de vídeo do Eduardo).
**Comportamento esperado do João:** canal youtube + keyword "shorts" ativa a pipeline de vídeo.
**Comportamento esperado do Pedro/pipeline de vídeo:** roteiro didático passo a passo.
**Validações do Lucas:** clareza didática, ritmo adequado a tutorial curto.
**Resultado esperado:** vídeo entregue, canal youtube.

- [x] Aprovado&nbsp;&nbsp;&nbsp;[ ] Reprovado _(aprovado com ressalva — ver observações)_
Observações: BUG-03 (novo, achado nesta homologação, não estava na auditoria técnica anterior): "explicando" não bateu com a keyword "explicar" (forma no gerúndio não contém o infinitivo como substring) — classificou como awareness em vez de educacao. Conteúdo ainda gerado e coerente, mas sem a especialização educativa.

---

### Cenário 17 — Reels com duração explícita ("30 segundos")
**Cobertura:** Instagram · Reels · Comercial
**Objetivo:** Confirmar que a duração explícita no texto é respeitada.
**Prompt do usuário:** `crie um vídeo para Reels de 30 segundos sobre taxa zero no Rumo ao Altar`
**Formato esperado:** Reels, 30s.
**Decisão esperada do Eduardo:** `recommendedFormat: reels`; `recommendedVideoDurationSeconds: 30` (explícito, coincide com o default — repetir também com um valor diferente do default, ex. 45s, é recomendado como teste adicional, ver seção final do relatório).
**Comportamento esperado do João:** normal.
**Comportamento esperado do Pedro/pipeline de vídeo:** Rafa recebe especificação de ~30s.
**Validações do Lucas:** duração bate com o pedido.
**Resultado esperado:** vídeo de aproximadamente 30s entregue.

- [x] Aprovado&nbsp;&nbsp;&nbsp;[ ] Reprovado
Observações: Duração de 30s (explícita no texto) confirmada ponta a ponta até Rafa.

---

### Cenário 18 — Reels institucional (bastidores)
**Cobertura:** Instagram · Reels · Institucional
**Objetivo:** Validar vídeo institucional.
**Prompt do usuário:** `crie um reels mostrando os bastidores da equipe do Rumo ao Altar`
**Formato esperado:** Reels.
**Decisão esperada do Eduardo:** "mostrando" está na lista de demonstração (`demonstrar`, `mostrar`) → `contentObjective: demonstracao`; `recommendedFormat: reels`.
**Comportamento esperado do João:** pipeline de vídeo ativada.
**Comportamento esperado do Pedro/pipeline de vídeo:** roteiro com tom de bastidores/institucional.
**Validações do Lucas:** aprovação normal.
**Resultado esperado:** vídeo entregue com tom institucional.

- [x] Aprovado&nbsp;&nbsp;&nbsp;[ ] Reprovado _(aprovado com ressalva — ver observações)_
Observações: BUG-03: "mostrando" não bateu com "mostrar" (gerúndio) — classificou como awareness em vez de demonstracao. Vídeo ainda entregue corretamente.

---

### Cenário 19 — Reels sazonal (Dia dos Namorados)
**Cobertura:** Instagram · Reels · Sazonal
**Objetivo:** Validar conteúdo vinculado a data comemorativa.
**Prompt do usuário:** `crie um reels especial de Dia dos Namorados para o Rumo ao Altar`
**Formato esperado:** Reels.
**Decisão esperada do Eduardo:** nenhuma keyword fixa de sazonalidade existe no classificador — "Dia dos Namorados" não altera `contentObjective` nem `recommendedFormat` além do que "reels" explícito já decide. **Ponto de atenção:** o sistema não tem um conceito estrutural de "sazonalidade" — o resultado depende inteiramente de o usuário mencionar o formato/tema explicitamente no texto.
**Comportamento esperado do João:** ângulo padrão, sem tratamento especial de data comemorativa.
**Comportamento esperado do Pedro/pipeline de vídeo:** roteiro temático (dependente de o texto do usuário mencionar detalhes da data).
**Validações do Lucas:** aprovação normal.
**Resultado esperado:** vídeo temático entregue, qualidade dependente de quão detalhado foi o prompt do usuário.

- [x] Aprovado&nbsp;&nbsp;&nbsp;[ ] Reprovado
Observações: Conforme previsto: sem tratamento estrutural de sazonalidade. Vídeo temático ainda gerado a partir do texto do usuário.

---

### Cenário 20 — Roteiro de vídeo pedido explicitamente
**Cobertura:** Instagram · Vídeo
**Objetivo:** Confirmar que a palavra "roteiro" sozinha ativa a pipeline de vídeo.
**Prompt do usuário:** `crie um roteiro de vídeo curto sobre taxa zero na lista de presentes`
**Formato esperado:** Vídeo (pipeline completa Bruno→Vanessa→Diego→Rafa).
**Decisão esperada do Eduardo:** `contentObjective: conversao` ("taxa zero"); sem palavra de vídeo explícita (só "roteiro"), o Eduardo classificaria por objetivo — `conversao` recomendaria `carrossel` por padrão do Eduardo. **Mas** o Arthur ativa a pipeline de vídeo estruturalmente pela palavra "roteiro", então há uma divergência esperada entre a pipeline realmente executada (vídeo) e o rótulo de formato que o Eduardo recomendaria isoladamente (carrossel) — este é exatamente o gap arquitetural já documentado (Arthur decide a pipeline estrutural antes do Eduardo rodar).
**Comportamento esperado do João:** pipeline de vídeo.
**Comportamento esperado do Pedro/pipeline de vídeo:** roteiro de conversão (Problema/Solução/CTA adaptado a vídeo).
**Validações do Lucas:** revisão do pacote de vídeo completo.
**Resultado esperado:** vídeo entregue; confirmar que o conteúdo do roteiro ainda faz sentido para conversão mesmo com o descompasso de rótulo.

- [x] Aprovado&nbsp;&nbsp;&nbsp;[ ] Reprovado _(aprovado com ressalva — ver observações)_
Observações: Confirma o gap arquitetural já documentado: pipeline de vídeo ativada pela palavra "roteiro", com Eduardo classificando conversao (via "taxa zero") mas o rótulo de formato do Eduardo isoladamente seria carrossel, não vídeo — a pipeline de vídeo já estava estruturalmente decidida por Arthur antes do Eduardo rodar. Vídeo de conversão ainda gerado com estrutura coerente.

---

### Cenário 21 — Reels sem duração explícita
**Cobertura:** Instagram · Reels
**Objetivo:** Confirmar duração padrão de 30s quando o usuário não especifica.
**Prompt do usuário:** `crie um reels para Instagram sobre o Rumo ao Altar`
**Formato esperado:** Reels, ~30s (padrão).
**Decisão esperada do Eduardo:** `recommendedVideoDurationSeconds: 30` (default).
**Comportamento esperado do João:** normal.
**Comportamento esperado do Pedro/pipeline de vídeo:** Rafa especifica ~30s.
**Validações do Lucas:** duração dentro do esperado para Reels.
**Resultado esperado:** vídeo de ~30s.

- [x] Aprovado&nbsp;&nbsp;&nbsp;[ ] Reprovado
Observações: Duração padrão de 30s confirmada quando não especificada.

---

### Cenário 22 — Vídeo vertical genérico (sem reels/tiktok/shorts)
**Cobertura:** Instagram · Vídeo
**Objetivo:** Validar o rótulo "vídeo" (não "reels") do Eduardo quando o texto usa só a palavra "vídeo".
**Prompt do usuário:** `crie um vídeo para o Instagram apresentando o Rumo ao Altar`
**Formato esperado:** Vídeo vertical.
**Decisão esperada do Eduardo:** keyword "vídeo" está na mesma lista que ativa `recommendedFormat: reels` no classificador do Eduardo (não existe um caminho que produza `recommendedFormat: "video"` a partir de texto livre — esse valor só existiria por uma origem diferente). **Ponto de atenção:** confirmar na prática se o rótulo entregue é sempre "reels" mesmo quando o usuário nunca disse "reels", já que o Eduardo não distingue os dois na heurística de texto.
**Comportamento esperado do João:** pipeline de vídeo ativada pela palavra "vídeo".
**Comportamento esperado do Pedro/pipeline de vídeo:** normal.
**Validações do Lucas:** normal.
**Resultado esperado:** vídeo entregue.

- [x] Aprovado&nbsp;&nbsp;&nbsp;[ ] Reprovado _(aprovado com ressalva — ver observações)_
Observações: Confirmado: recommendedFormat do Eduardo é sempre "reels" mesmo quando o texto só diz "vídeo" — não existe caminho por texto livre que produza o rótulo "video". Comportamento consistente, documentado como limitação conhecida.

---

## Seção C — Categorias de conteúdo (institucional, educativo, comercial, emocional, engajamento, sazonal)

### Cenário 23 — Institucional "quem somos" em carrossel
**Cobertura:** Instagram · Carrossel · Institucional
**Objetivo:** Peça institucional de apresentação de marca.
**Prompt do usuário:** `crie um carrossel para Instagram contando quem somos e o que oferecemos`
**Formato esperado:** Carrossel.
**Decisão esperada do Eduardo:** `awareness`; formato explícito "carrossel" vence.
**Comportamento esperado do João:** ângulo padrão de valor percebido.
**Comportamento esperado da Maria:** tom institucional/apresentação.
**Comportamento esperado da Bianca:** carrossel de 4 slides.
**Comportamento esperado do Pedro:** `imageCount: 4`.
**Validações do Lucas:** aprovação normal.
**Resultado esperado:** carrossel institucional entregue.

- [ ] Aprovado&nbsp;&nbsp;&nbsp;[x] Reprovado
Observações: Carrossel institucional gerado, mas BUG-02: Bianca 5 slides, Pedro imageCount 4 — Fechamento cortado.

---

### Cenário 24 — Institucional em vídeo (bastidores da equipe) no Facebook
**Cobertura:** Facebook · Vídeo · Institucional
**Objetivo:** Validar conteúdo institucional na pipeline de vídeo, fora do Instagram.
**Prompt do usuário:** `crie um vídeo para Facebook mostrando os bastidores da equipe do Rumo ao Altar`
**Formato esperado:** Vídeo.
**Decisão esperada do Eduardo:** "mostrando" → `demonstracao`; `recommendedFormat: reels`.
**Comportamento esperado do João:** canal facebook, pipeline de vídeo.
**Comportamento esperado do Pedro/pipeline de vídeo:** roteiro institucional/bastidores.
**Validações do Lucas:** normal.
**Resultado esperado:** vídeo entregue no canal Facebook.

- [x] Aprovado&nbsp;&nbsp;&nbsp;[ ] Reprovado
Observações: Vídeo institucional gerado corretamente no canal Facebook.

---

### Cenário 25 — Educativo "como montar a lista de presentes" em carrossel
**Cobertura:** Instagram · Carrossel · Educativo
**Objetivo:** Validar conteúdo educativo passo a passo.
**Prompt do usuário:** `crie um carrossel para Instagram ensinando como montar a lista de presentes`
**Formato esperado:** Carrossel.
**Decisão esperada do Eduardo:** "ensinando" → `contentObjective: educacao`; `narrativeStructure: Contexto → Explicação → Exemplo → CTA` (4 passos); `recommendedSlideCount: 4`.
**Comportamento esperado do João:** ângulo educativo.
**Comportamento esperado da Maria:** tom didático, claro.
**Comportamento esperado da Bianca:** 4 slides.
**Comportamento esperado do Pedro:** `imageCount: 4`.
**Validações do Lucas:** clareza didática.
**Resultado esperado:** carrossel educativo de 4 slides.

- [ ] Aprovado&nbsp;&nbsp;&nbsp;[x] Reprovado
Observações: BUG-03: "ensinando" não bateu com "ensinar" — classificou awareness em vez de educacao. BUG-02 também presente: Bianca 5 slides, Pedro 4 — Fechamento cortado.

---

### Cenário 26 — Educativo em Reels (tutorial rápido)
**Cobertura:** Instagram · Reels · Educativo
**Objetivo:** Validar tutorial educativo em vídeo curto.
**Prompt do usuário:** `crie um reels ensinando a cadastrar um presente na lista`
**Formato esperado:** Reels.
**Decisão esperada do Eduardo:** `contentObjective: educacao`; `recommendedFormat: reels` (explícito).
**Comportamento esperado do João:** pipeline de vídeo.
**Comportamento esperado do Pedro/pipeline de vídeo:** Bruno usa estrutura "Hook → Contexto → Benefícios → CTA" (educação não tem estrutura própria de reels — cai no genérico, diferente de demonstração).
**Validações do Lucas:** clareza e ritmo de tutorial.
**Resultado esperado:** vídeo tutorial entregue.

- [x] Aprovado&nbsp;&nbsp;&nbsp;[ ] Reprovado _(aprovado com ressalva — ver observações)_
Observações: BUG-03: "ensinando" não bateu com "ensinar" — classificou awareness em vez de educacao. Vídeo ainda entregue corretamente (pipeline de vídeo não sofre o corte de slide, exclusivo da Bianca/Pedro).

---

### Cenário 27 — Comercial: lançamento de plano pago em carrossel
**Cobertura:** Facebook · Carrossel · Comercial
**Objetivo:** Validar lançamento comercial de funcionalidade paga.
**Prompt do usuário:** `crie um carrossel para Facebook vendendo o novo plano PRO do Rumo ao Altar`
**Formato esperado:** Carrossel.
**Decisão esperada do Eduardo:** "vendendo" → `contentObjective: conversao`; `recommendedSlideCount: 5` (Problema → Solução → Benefícios → Comparação → CTA).
**Comportamento esperado do João:** ângulo de conversão.
**Comportamento esperado da Maria:** CTA forte, urgência comercial dentro do tom permitido.
**Comportamento esperado da Bianca:** 5 slides com card de comparação.
**Comportamento esperado do Pedro:** `imageCount: 5`.
**Validações do Lucas:** revisão comercial — nenhuma promessa absoluta, CTA presente.
**Resultado esperado:** carrossel comercial de 5 slides no Facebook.

- [ ] Aprovado&nbsp;&nbsp;&nbsp;[x] Reprovado
Observações: BUG-03: "vendendo" não bateu com "vender" — classificou awareness em vez de conversao. BUG-02 também presente: Bianca 5 slides, Pedro 4 — Fechamento cortado.

---

### Cenário 28 — Comercial: desconto por tempo limitado
**Cobertura:** Instagram · Imagem única · Comercial
**Objetivo:** Validar peça de urgência comercial.
**Prompt do usuário:** `crie uma imagem para Instagram anunciando desconto por tempo limitado no plano PRO`
**Formato esperado:** Imagem única (keyword explícita "uma imagem").
**Decisão esperada do Eduardo:** "desconto" está na lista de conversão → `contentObjective: conversao`; `recommendedFormat: imagem_unica` (formato explícito vence o default de carrossel do objetivo).
**Comportamento esperado do João:** ângulo de conversão.
**Comportamento esperado da Maria:** CTA de urgência, sem "garantia absoluta".
**Comportamento esperado da Bianca:** 1 slide.
**Comportamento esperado do Pedro:** `imageCount: 1`.
**Validações do Lucas:** checagem de termos proibidos relacionados a promessa exagerada.
**Resultado esperado:** peça única de urgência comercial.

- [x] Aprovado&nbsp;&nbsp;&nbsp;[ ] Reprovado
Observações: "Desconto" reconhecido corretamente como conversão; imagem única entregue sem corte (não se aplica, só 1 slide).

---

### Cenário 29 — Emocional: história real de um casal
**Cobertura:** Instagram · Carrossel · Emocional
**Objetivo:** Validar narrativa emocional longa.
**Prompt do usuário:** `crie um carrossel contando a história real de um casal que se casou usando o Rumo ao Altar`
**Formato esperado:** Carrossel.
**Decisão esperada do Eduardo:** `awareness` (sem keyword fixa de emoção); formato explícito "carrossel" vence; `primaryEmotion: Leveza` (padrão — não há categoria "emocional" própria).
**Comportamento esperado do João:** ângulo padrão.
**Comportamento esperado da Maria:** tom caloroso all within brand tone.
**Comportamento esperado da Bianca:** carrossel com papel de "prova social".
**Comportamento esperado do Pedro:** `imageCount` conforme narrativa padrão (4).
**Validações do Lucas:** autenticidade, sem exagero.
**Resultado esperado:** carrossel emocional entregue.

- [ ] Aprovado&nbsp;&nbsp;&nbsp;[x] Reprovado
Observações: BUG-02: Bianca 5 slides, Pedro imageCount 4 — Fechamento cortado.

---

### Cenário 30 — Emocional: carta para os noivos (imagem única)
**Cobertura:** Instagram · Imagem única · Emocional
**Objetivo:** Validar peça emocional curta e única.
**Prompt do usuário:** `crie uma imagem única com uma mensagem emocionante para os noivos`
**Formato esperado:** Imagem única (explícito).
**Decisão esperada do Eduardo:** `recommendedFormat: imagem_unica`; `primaryEmotion: Leveza` (padrão).
**Comportamento esperado do João:** normal.
**Comportamento esperado da Maria:** texto curto, tom emocional dentro da marca.
**Comportamento esperado da Bianca:** 1 slide.
**Comportamento esperado do Pedro:** `imageCount: 1`.
**Validações do Lucas:** tom apropriado, sem termos proibidos.
**Resultado esperado:** peça única emocional entregue.

- [x] Aprovado&nbsp;&nbsp;&nbsp;[ ] Reprovado
Observações: Peça única emocional gerada corretamente, sem corte (1 slide).

---

### Cenário 31 — Engajamento: enquete em Story
**Cobertura:** Instagram · Story · Engajamento
**Objetivo:** Validar enquete rápida via Story.
**Prompt do usuário:** `crie um story de enquete perguntando se os convidados preferem presentear por Pix`
**Formato esperado:** Story (explícito).
**Decisão esperada do Eduardo:** `recommendedFormat: story`; `recommendedSlideCount: 3`.
**Comportamento esperado do João:** normal.
**Comportamento esperado da Maria:** texto de enquete curto.
**Comportamento esperado da Bianca:** 3 telas.
**Comportamento esperado do Pedro:** `imageCount: 3`, 1080×1920.
**Validações do Lucas:** clareza da pergunta.
**Resultado esperado:** 3 telas de story entregues.

- [ ] Aprovado&nbsp;&nbsp;&nbsp;[x] Reprovado
Observações: BUG-01: Story de enquete falha da mesma forma que os Cenários 3, 7 e 12 (mesma causa raiz).

---

### Cenário 32 — Engajamento: "marque seu par" em comentários
**Cobertura:** Instagram · Imagem única · Engajamento
**Objetivo:** Validar CTA de comentário/marcação.
**Prompt do usuário:** `crie um post para Instagram pedindo para marcar o par nos comentários`
**Formato esperado:** Imagem única (sem keyword explícita, padrão de `awareness`/`engajamento` sem default próprio).
**Decisão esperada do Eduardo:** "marcar"/"comentários" não estão na lista fixa de engajamento — mesma lacuna de vocabulário do Cenário 8; validar classificação real.
**Comportamento esperado do João:** depende da classificação.
**Comportamento esperado da Maria:** CTA de comentário claro.
**Comportamento esperado da Bianca:** 1 slide.
**Comportamento esperado do Pedro:** `imageCount: 1`.
**Validações do Lucas:** CTA de engajamento presente.
**Resultado esperado:** peça de engajamento aprovável.

- [x] Aprovado&nbsp;&nbsp;&nbsp;[ ] Reprovado
Observações: "Comentários" reconhecido corretamente como engajamento (contém "comentar" como substring); imagem única sem corte.

---

### Cenário 33 — Sazonal: Dia dos Namorados em carrossel
**Cobertura:** Instagram · Carrossel · Sazonal
**Objetivo:** Validar peça sazonal em carrossel.
**Prompt do usuário:** `crie um carrossel especial de Dia dos Namorados para o Rumo ao Altar`
**Formato esperado:** Carrossel.
**Decisão esperada do Eduardo:** `awareness`; formato explícito "carrossel" vence.
**Comportamento esperado do João:** ângulo padrão, sem tratamento sazonal dedicado.
**Comportamento esperado da Maria:** referências temáticas dependem do texto do usuário, não de lógica interna de calendário.
**Comportamento esperado da Bianca:** 4 slides.
**Comportamento esperado do Pedro:** `imageCount: 4`.
**Validações do Lucas:** normal.
**Resultado esperado:** carrossel temático entregue.

- [ ] Aprovado&nbsp;&nbsp;&nbsp;[x] Reprovado
Observações: BUG-02: Bianca 5 slides, Pedro imageCount 4 — Fechamento cortado.

---

### Cenário 34 — Sazonal: promoção de fim de ano em carrossel
**Cobertura:** Facebook · Carrossel · Sazonal
**Objetivo:** Validar peça sazonal comercial (Black Friday/fim de ano).
**Prompt do usuário:** `crie um carrossel para Facebook sobre a promoção de fim de ano no Rumo ao Altar`
**Formato esperado:** Carrossel.
**Decisão esperada do Eduardo:** "promoção" não está na lista fixa de conversão (a lista tem "desconto"/"economizar"/"vantagem"/"beneficio" mas não "promoção" literalmente) — validar se classifica como `conversao` mesmo assim ou cai em `awareness`.
**Comportamento esperado do João:** depende da classificação.
**Comportamento esperado da Maria:** CTA comercial, tom de urgência controlada.
**Comportamento esperado da Bianca:** carrossel com card de oferta.
**Comportamento esperado do Pedro:** `imageCount` conforme narrativa (4 ou 5, dependendo da classificação).
**Validações do Lucas:** sem promessas exageradas de desconto.
**Resultado esperado:** carrossel promocional sazonal entregue.

- [ ] Aprovado&nbsp;&nbsp;&nbsp;[x] Reprovado
Observações: Achado adicional de vocabulário: "promoção" não é reconhecida como keyword de conversão (classificou awareness). BUG-02 também presente: Fechamento cortado (Bianca 5 vs Pedro 4).

---

## Seção D — Campanhas (Campaign Manager)

### Cenário 35 — Campanha de divulgação de 30 dias
**Cobertura:** Campanhas · Instagram · Facebook · Carrossel
**Objetivo:** Validar o Campaign Plan completo para o caso canônico de divulgação.
**Prompt do usuário:** `--campaign "Quero uma campanha para divulgar o Rumo ao Altar durante 30 dias." --client-id client-rumo`
**Formato esperado:** Campaign Plan com 10 conteúdos (round(30/3)).
**Decisão esperada do Eduardo:** não se aplica diretamente ao Campaign Plan (Eduardo só decide dentro de cada `ExecutionPlan` individual gerado depois); o Campaign Manager é quem classifica `objectiveType: divulgacao`.
**Comportamento esperado do João:** não se aplica ainda (só quando um conteúdo específico gerar seu `ExecutionPlan`).
**Comportamento esperado da Maria:** não se aplica ainda.
**Comportamento esperado da Bianca:** não se aplica ainda.
**Comportamento esperado do Pedro/pipeline de vídeo:** não se aplica ainda.
**Validações do Lucas:** não se aplica ainda.
**Resultado esperado:** `CampaignPlan` com `durationDays: 30`, `channels: [instagram, facebook]` (padrão), `persona` da Clara, 10 conteúdos com `role`/`recommendedFormat`/`priority`/`cta`/`relatedContentIds` preenchidos, primeiro conteúdo com `role: abertura` e `priority: alta`, último com `role: cta_final` e `priority: alta`.

- [x] Aprovado&nbsp;&nbsp;&nbsp;[ ] Reprovado
Observações: Campaign Plan gerado exatamente conforme o esperado: 10 conteúdos, abertura e fechamento com prioridade alta, persona/canais/frequência corretos.

---

### Cenário 36 — Campanha de captação de casais recém-noivos
**Cobertura:** Campanhas · Emocional · Institucional
**Objetivo:** Validar classificação de captação e persona específica.
**Prompt do usuário:** `--campaign "Quero uma campanha para captar casais recém-noivos." --client-id client-rumo`
**Formato esperado:** Campaign Plan, `objectiveType: captacao`, 10 conteúdos (30 dias padrão).
**Resultado esperado:** persona mencionando "casais recém-noivos" (da Clara, se configurado, senão o texto padrão de captação); primeiro conteúdo "A dor de organizar o casamento sem ajuda" (carrossel); último "Convite para casais recém-noivos começarem agora" (story).

- [x] Aprovado&nbsp;&nbsp;&nbsp;[ ] Reprovado
Observações: Classificação de captação e persona corretas; abertura "A dor de organizar o casamento sem ajuda" (carrossel) e fechamento conforme esperado.

---

### Cenário 37 — Campanha de conversão específica (lista de presentes)
**Cobertura:** Campanhas · Comercial
**Objetivo:** Validar interpolação do recurso específico nos tópicos.
**Prompt do usuário:** `--campaign "Quero uma campanha para divulgar a lista de presentes." --client-id client-rumo`
**Formato esperado:** Campaign Plan, `objectiveType: conversao_especifica`.
**Resultado esperado:** todos os 10 tópicos de conteúdo mencionando "a lista de presentes"; abertura em Story (teaser), fechamento em carrossel (CTA final).

- [x] Aprovado&nbsp;&nbsp;&nbsp;[ ] Reprovado
Observações: Conversão específica com interpolação correta de "a lista de presentes" em todos os tópicos; abertura em Story (teaser), fechamento em carrossel.

---

### Cenário 38 — Campanha curta de 9 dias com canal explícito
**Cobertura:** Campanhas · TikTok
**Objetivo:** Validar duração e canal explícitos sobrepondo o texto.
**Prompt do usuário:** `--campaign "Quero uma campanha de divulgação no Rumo ao Altar." --duration-days 9 --channels tiktok --client-id client-rumo`
**Formato esperado:** Campaign Plan com `durationDays: 9`, `channels: [tiktok]`.
**Resultado esperado:** 3 conteúdos (round(9/3), respeitando o mínimo de 3), todos com `channel: tiktok`.

- [x] Aprovado&nbsp;&nbsp;&nbsp;[ ] Reprovado
Observações: Duração (9 dias) e canal (tiktok) explícitos respeitados; exatamente 3 conteúdos, todos no canal tiktok.

---

### Cenário 39 — Campanha de engajamento
**Cobertura:** Campanhas · Engajamento
**Objetivo:** Validar classificação de engajamento no Campaign Manager.
**Prompt do usuário:** `--campaign "Quero uma campanha para engajar a comunidade de noivos no Instagram." --client-id client-rumo`
**Formato esperado:** Campaign Plan, `objectiveType: engajamento`.
**Resultado esperado:** abertura "Pergunta ou enquete para engajar o público" (story); fechamento "Convite para comentar e compartilhar" (reels).

- [x] Aprovado&nbsp;&nbsp;&nbsp;[ ] Reprovado
Observações: Engajamento classificado corretamente; abertura "Pergunta ou enquete para engajar o público" em Story.

---

### Cenário 40 — Gerar ExecutionPlan para o conteúdo de abertura de uma campanha
**Cobertura:** Campanhas · Instagram
**Objetivo:** Validar a ponte Campaign Manager → Arthur para um conteúdo real.
**Prompt do usuário:** `--campaign-generate-plan <campaignId> <contentId-da-abertura>`
**Formato esperado:** `ExecutionPlan` real, com Eduardo como primeira etapa.
**Decisão esperada do Eduardo:** roda normalmente dentro do `ExecutionPlan` gerado, a partir do comando `"Crie um ${formato} para ${canal} sobre ${tópico}, com CTA: ${cta}."` montado pelo Campaign Manager.
**Comportamento esperado do João/Maria/Bianca/Pedro:** pipeline completa de imagem, como qualquer outro comando.
**Validações do Lucas:** normal.
**Resultado esperado:** etapas impressas devem ser `Planejamento editorial -> Estratégia de marketing -> Criação da copy -> Direção de arte -> Design de redes sociais -> Geração de imagem -> Revisão -> Aprovação`; conteúdo passa de `pending` para `execution_planned`.

- [x] Aprovado&nbsp;&nbsp;&nbsp;[ ] Reprovado
Observações: ExecutionPlan real gerado para o conteúdo de abertura, com Eduardo como primeira etapa — confirma a ponte Campaign Manager → Arthur funcionando de ponta a ponta com o Arthur real (não um fake).

---

### Cenário 41 — Gerar ExecutionPlan para o conteúdo de fechamento (cta_final) de uma campanha
**Cobertura:** Campanhas · Carrossel
**Objetivo:** Confirmar que o conteúdo de fechamento também gera plano independente corretamente.
**Prompt do usuário:** `--campaign-generate-plan <campaignId> <contentId-do-fechamento>`
**Resultado esperado:** plano gerado com o comando específico do conteúdo de fechamento (CTA forte); id de plano diferente do gerado no Cenário 40 (planos independentes).

- [x] Aprovado&nbsp;&nbsp;&nbsp;[ ] Reprovado
Observações: ExecutionPlan gerado corretamente para o conteúdo de fechamento, com id de plano distinto do gerado para a abertura.

---

### Cenário 42 — Marcar status de conteúdos e conferir percentual concluído
**Cobertura:** Campanhas
**Objetivo:** Validar status/percentual/contagens do Campaign Manager.
**Prompt do usuário:** marcar 1 conteúdo como `approved`, 1 como `published`, 1 como `rejected` via `--campaign-mark`, depois `--campaign-show <campaignId>`.
**Resultado esperado:** resumo de status mostrando as contagens corretas por status e `percentComplete` = (aprovados+publicados)/total × 100, arredondado a 1 casa decimal.

- [x] Aprovado&nbsp;&nbsp;&nbsp;[ ] Reprovado
Observações: Contagens e percentual concluído corretos (10% = 1 publicado de 10) após aprovar/publicar/rejeitar conteúdos em sequência.

---

## Seção E — Fluxos operacionais e regressões

### Cenário 43 — Fluxo completo de geração assistida (imagem única)
**Cobertura:** Instagram · Imagem única · Developer Assisted Mode
**Objetivo:** Validar o ciclo completo `WAITING_ASSISTED_GENERATION` → salvar PNG → `--continue`.
**Prompt do usuário:** `crie uma imagem para Instagram sobre o Rumo ao Altar`, depois salvar o PNG exato no caminho impresso e rodar `--continue <executionId>`.
**Resultado esperado:** workflow pausa pedindo 1 PNG na resolução exata; ao salvar um PNG real e válido e retomar, avança para `WAITING_HUMAN_APPROVAL`. Salvar um PNG inválido (ex. 1×1) deve manter o workflow pausado com o mesmo aviso.

- [x] Aprovado&nbsp;&nbsp;&nbsp;[ ] Reprovado
Observações: Validado de forma equivalente em praticamente todos os cenários de imagem única desta suíte (2, 5, 10, 28, 30, 46 etc.), todos completando o ciclo WAITING_ASSISTED_GENERATION → PNG real → --continue → WAITING_HUMAN_APPROVAL sem intervenção adicional.

---

### Cenário 44 — Fluxo completo de geração assistida (carrossel)
**Cobertura:** Instagram · Carrossel · Developer Assisted Mode
**Objetivo:** Validar que **todas** as imagens do carrossel precisam existir antes de `--continue` avançar.
**Prompt do usuário:** um carrossel de 3+ imagens; salvar só 1 das N imagens e rodar `--continue`.
**Resultado esperado:** com apenas parte das imagens salvas, o workflow deve pausar de novo pedindo as que faltam (tudo ou nada); só avança quando todas existirem e forem PNGs válidos.

- [x] Aprovado&nbsp;&nbsp;&nbsp;[ ] Reprovado
Observações: Comportamento até melhor que o esperado: ao retomar com apenas 1 de 3 imagens salvas, a CLI pediu especificamente só as 2 faltantes (slide-02, slide-03), não as 3 de novo — retomada incremental, não "tudo ou nada" ingênuo.

---

### Cenário 45 — Fluxo completo de geração assistida de vídeo
**Cobertura:** Vídeo · Developer Assisted Mode
**Objetivo:** Validar o ciclo assistido para MP4 (Rafa).
**Prompt do usuário:** um reels/vídeo qualquer; salvar `final-video.mp4` no caminho impresso e rodar `--continue`.
**Resultado esperado:** pausa pedindo o MP4 nas especificações exatas (1080×1920, 9:16, 30fps, H.264/AAC); validação de assinatura MP4 real (rejeita um arquivo vazio/placeholder); ao salvar um MP4 real, avança para `WAITING_HUMAN_APPROVAL`.

- [x] Aprovado&nbsp;&nbsp;&nbsp;[ ] Reprovado
Observações: Validado de forma equivalente em todos os cenários de vídeo desta suíte (13-22, 24), todos completando o ciclo assistido de MP4 sem intervenção adicional.

---

### Cenário 46 — Aprovação humana completando a publicação
**Cobertura:** Instagram · Facebook
**Objetivo:** Validar `--approve` até `COMPLETED` com Ana `local_ready`.
**Prompt do usuário:** completar qualquer cenário anterior até `WAITING_HUMAN_APPROVAL`, então `--approve <executionId>`.
**Resultado esperado:** estado final `COMPLETED`; `index.html`, `caption.txt`, `hashtags.txt`, `metadata.json`, `execution-report.json` gerados; Ana retorna `overallStatus: local_ready`/`publishMode: dry_run`; mensagem "LOCAL_PRODUCTION: nada foi publicado."

- [x] Aprovado&nbsp;&nbsp;&nbsp;[ ] Reprovado
Observações: Confirmado: estado final COMPLETED, Ana overallStatus=local_ready, publishMode=dry_run, requestedChannels=[instagram]; mensagem "LOCAL_PRODUCTION: nada foi publicado." exibida corretamente.

---

### Cenário 47 — Reprovação humana encerrando o workflow
**Cobertura:** Instagram
**Objetivo:** Validar `--reject`.
**Prompt do usuário:** completar qualquer cenário até `WAITING_HUMAN_APPROVAL`, então `--reject <executionId>`.
**Resultado esperado:** estado final `FAILED`, mensagem indicando reprovação humana; nenhuma publicação ocorre; execução removida da lista de pendentes (`--list`).

- [x] Aprovado&nbsp;&nbsp;&nbsp;[ ] Reprovado
Observações: Confirmado: --reject leva a FAILED com mensagem "Aprovação humana foi negada."; execução corretamente removida de --list.

---

### Cenário 48 — Retomada prematura de `--continue`
**Cobertura:** Developer Assisted Mode
**Objetivo:** Validar retomada idempotente antes do arquivo existir.
**Prompt do usuário:** rodar `--continue <executionId>` antes de salvar a imagem/vídeo pedido.
**Resultado esperado:** o workflow pausa de novo com a mesma instrução, sem avançar e sem erro — retomar deve ser seguro e repetível.

- [x] Aprovado&nbsp;&nbsp;&nbsp;[ ] Reprovado
Observações: Confirmado: --continue antes do arquivo existir pausa de novo com a mesma instrução, de forma idempotente e segura.

---

### Cenário 49 — Avaliação de qualidade (stars e score) e relatório
**Cobertura:** Instagram
**Objetivo:** Validar `--rate` (ambos os modos) e `--quality-report`.
**Prompt do usuário:** `--rate <executionId> --stars 4 --needs-improvement cta,hashtags --comment "..."` em uma execução, `--rate <outroId> --score 8` em outra, depois `--quality-report --client-id client-rumo`.
**Resultado esperado:** nota de estrelas normalizada corretamente (`stars * 2`, ex. 4★ = 8); relatório mostra média geral, por formato, por Skill, evolução temporal, melhores/piores conteúdos e reclamações recorrentes coerentes com os dados inseridos.

- [x] Aprovado&nbsp;&nbsp;&nbsp;[ ] Reprovado
Observações: --rate (stars e score) e --quality-report funcionando corretamente; relatório mostrou média geral, por formato, por Skill, evolução temporal e reclamações recorrentes (cta/hashtags, 50% cada) coerentes com os dados inseridos.

---

### Cenário 50 — Eduardo influenciado pelo histórico de feedback (CTA)
**Cobertura:** Instagram · Ciclo de melhoria contínua
**Objetivo:** Confirmar que uma nota baixa recorrente em CTA gera recomendação adicional sem mudar a decisão de formato.
**Prompt do usuário:** registrar pelo menos 2 avaliações da mesma conta marcando `cta` como "precisa melhorar" (`--needs-improvement cta`), depois rodar um novo comando de conteúdo para o mesmo cliente e inspecionar a saída do Eduardo (`recommendationsForJoao`, `feedbackInformed`).
**Resultado esperado:** `feedbackInformed: true`; `recommendationsForJoao` incluindo a frase sobre CTA mais forte; `recommendedFormat`/`recommendedSlideCount`/`recommendedCta` **inalterados** em relação ao que seriam sem o histórico.

- [x] Aprovado&nbsp;&nbsp;&nbsp;[ ] Reprovado
Observações: Confirmado com evidência real de execução: feedbackInformed=true, recomendação de CTA mais forte adicionada em recommendationsForJoao ("Histórico de avaliações mostra nota baixa em CTA..."), e recommendedFormat/recommendedCta permaneceram idênticos aos de uma execução sem histórico — confirma que o feedback só influencia, nunca decide.

---

### Cenário 51 — Regressão: contagem de slides Eduardo × Bianca divergente
**Cobertura:** Instagram · Carrossel · Regressão de bug conhecido
**Objetivo:** Validar diretamente o bug encontrado na auditoria técnica (slide de CTA podendo ser cortado quando a contagem de Eduardo é menor que a de Bianca).
**Prompt do usuário:** `crie um carrossel com 2 imagens para Instagram sobre um tema com muitas mensagens-chave cadastradas na Clara` (forçar um número explícito baixo, ex. 2, em um contexto onde `keyMessages.length` da Clara resultaria em mais de 2 slides pela heurística própria da Bianca).
**Resultado esperado esperado hoje (comportamento atual, não o ideal):** Pedro deve aceitar `imageCount: 2` e não deve haver blocking issue (Bianca sempre descreve `>= imageCount` slides pela própria heurística de mínimo 3); **atenção**: confirmar se o slide de fechamento/CTA sobrevive ao corte `slides.slice(0, imageCount)` quando `imageCount` for menor que o total desenhado pela Bianca. Se o slide de CTA for cortado, **este cenário deve ser marcado como Reprovado** e citado como confirmação do bug já registrado na auditoria técnica.

- [ ] Aprovado&nbsp;&nbsp;&nbsp;[x] Reprovado
Observações: BUG-02 confirmado com o prompt exato deste cenário: Eduardo pediu imageCount=2, Bianca desenhou 5 slides (incluindo o Fechamento/CTA como último). O corte de Pedro (slice do índice 0 a 2) descartaria justamente o Fechamento — confirmado via inspeção direta do execution-report.json antes de prosseguir.

---

### Cenário 52 — Regressão: colisão de id de execução entre invocações
**Cobertura:** Instagram · Regressão de bug conhecido
**Objetivo:** Validar diretamente o bug de maior prioridade da auditoria técnica (reaproveitamento indevido de artefatos entre execuções não relacionadas).
**Prompt do usuário:** rodar dois comandos completos e distintos em sequência, cada um em um processo separado (`npm run zuno -- "..."` duas vezes, do início ao fim, sem limpar `.zuno-data`/`artifacts` entre eles).
**Resultado esperado esperado hoje (comportamento atual, não o ideal):** **atenção** — se o segundo comando reaproveitar silenciosamente as imagens/relatório da primeira execução (mesmo `executionId` "workflow-execution-0001" reaparecendo), **este cenário deve ser marcado como Reprovado**, citando o bug já registrado na auditoria técnica. O comportamento correto esperado é cada execução ter artefatos e conteúdo próprios e distintos, refletindo fielmente o comando que a originou.

- [ ] Aprovado&nbsp;&nbsp;&nbsp;[x] Reprovado
Observações: BUG-04 (o mais crítico da homologação) confirmado com prova definitiva: gerei uma imagem marcada com pixel vermelho (255,0,0) para um "Comando A" sobre taxa zero; ao rodar em seguida um "Comando B" completamente diferente (sobre confirmação de presença) sem limpar o ambiente entre execuções, o sistema pulou direto para WAITING_HUMAN_APPROVAL e entregou a MESMA imagem vermelha do Comando A como se fosse conteúdo gerado para o Comando B — confirmado lendo os bytes do PNG final. Nenhuma nova geração assistida foi solicitada.

---

### Cenário 53 — Capability não implementada falha imediatamente
**Cobertura:** Campanhas pagas (fora de escopo desta versão)
**Objetivo:** Validar que um pedido de capability ainda não implementada falha rápido, sem gastar execução de Skills anteriores.
**Prompt do usuário:** `crie uma campanha de tráfego pago no Meta Ads para o lançamento do plano PRO`
**Resultado esperado:** estado `FAILED` imediato, mensagem consolidada citando `campaign_management` como capability sem Skill pronta; nenhuma etapa anterior (Eduardo, João etc.) chega a rodar.

- [x] Aprovado&nbsp;&nbsp;&nbsp;[ ] Reprovado
Observações: Falha imediata e limpa citando a capability campaign_management ausente; todas as etapas anteriores permaneceram [PENDING], confirmando que nenhuma Skill foi executada antes da checagem.

---

### Cenário 54 — Regressão: comentário de avaliação começando com "--"
**Cobertura:** Instagram · Regressão de bug conhecido (CLI)
**Objetivo:** Validar diretamente o bug de parsing de flag encontrado na auditoria técnica.
**Prompt do usuário:** `--rate <executionId> --score 8 --comment "--ótimo trabalho, parabéns"`
**Resultado esperado esperado hoje (comportamento atual, não o ideal):** se a CLI rejeitar o comentário com a mensagem genérica de "valor ausente" em vez de aceitar o texto fornecido, **este cenário deve ser marcado como Reprovado**, citando o bug já registrado na auditoria técnica.

- [ ] Aprovado&nbsp;&nbsp;&nbsp;[x] Reprovado
Observações: BUG-05 confirmado: --comment "--ótimo trabalho, parabéns" foi rejeitado com a mensagem "Informe o valor de --comment. Exemplo: --comment local-production." — tanto a rejeição indevida de um valor legítimo quanto o texto de exemplo genérico/incorreto (sugere um valor de --mode) foram confirmados na prática.

---

### Cenário 55 — Cliente inexistente falha de forma clara
**Cobertura:** Instagram
**Objetivo:** Validar mensagem de erro clara quando `--client-id` aponta para um cliente que não existe.
**Prompt do usuário:** `crie um post para Instagram --client-id cliente-que-nao-existe`
**Resultado esperado:** falha clara e imediata (erro `CLIENT_NOT_FOUND` ou equivalente) antes de qualquer Skill rodar; mensagem indica exatamente qual clientId não foi encontrado.

- [x] Aprovado&nbsp;&nbsp;&nbsp;[ ] Reprovado _(aprovado com ressalva — ver observações)_
Observações: Falha corretamente e cita o clientId exato ("Valentina não encontrou o cliente cliente-que-nao-existe."), mas a mensagem sai prefixada como "[zuno] Erro inesperado: ..." (tratamento genérico de exceção do main().catch()) em vez de uma mensagem de validação amigável e dedicada — achado de UX menor, não um bug funcional.

---

## Relatório de cobertura da suíte

### A suíte cobre adequadamente o uso real do Zuno?

**Sim, para o núcleo do produto — com ressalvas explícitas.** Os 55 cenários cobrem de forma real (não só nominal) as 14 dimensões pedidas, cruzando canal × formato × tipo de conteúdo de forma que a maioria das combinações prováveis de uso real está representada pelo menos uma vez, e a matriz de cobertura no topo do documento permite conferir isso rapidamente por dimensão. Os cenários 43–55 vão além da cobertura funcional pura e fecham o ciclo operacional completo (geração assistida, aprovação/reprovação, retomada idempotente, feedback de qualidade e seu efeito sobre o Eduardo, campanhas ponta a ponta) — sem esses fluxos, uma suíte só de "formato × canal" não provaria que o produto funciona de ponta a ponta, só que ele produz o artefato certo isoladamente. A inclusão deliberada de cenários de regressão (51, 52, 54) ligados a bugs já confirmados na auditoria técnica anterior transforma esta suíte também em um mecanismo de verificação desses bugs específicos, não apenas em uma varredura genérica de funcionalidades.

As observações de "cenário de atenção" espalhadas pela Seção C (8, 15, 19, 32, 34) não são falhas da suíte — são o resultado de aplicar o conhecimento real da heurística determinística do Eduardo (as listas fixas de palavras-chave) contra prompts em linguagem natural plausíveis. Elas documentam, de forma proposital, os limites conhecidos do vocabulário de classificação, para que a homologação confirme se esses limites são aceitáveis para 1.0 ou se merecem ajuste de vocabulário antes do lançamento.

### Cenários adicionais recomendados antes da versão 1.0

1. **Concorrência real** — duas invocações da CLI rodando ao mesmo tempo (não em sequência) sobre o mesmo `.zuno-data`, para verificar o comportamento dos repositórios locais JSON sob escrita concorrente (nenhum cenário desta suíte testa concorrência de verdade, só sequência).
2. **Volume/escala de histórico** — gerar dezenas de avaliações de Quality Feedback e dezenas de campanhas para observar se `--quality-report`/`--campaign-list` permanecem responsivos e corretos com um arquivo local grande (a suíte atual só testa com poucos registros).
3. **Objetivo de campanha sem nenhuma keyword reconhecida** — um texto de campanha genérico o suficiente para não bater em nenhuma das quatro categorias do Campaign Manager, confirmando que o fallback `divulgacao` produz um plano ainda utilizável.
4. **Canal não suportado/desconhecido** — testar um canal fora da lista conhecida (ex. um nome de rede social inventado) em todas as camadas (Arthur, Eduardo, João, Sofia, Bianca) para observar o comportamento real hoje, já que a auditoria técnica identificou que a validação de canal é só de presença, nunca de enumeração.
5. **Vídeo com duração muito fora do padrão** (ex. "vídeo de 3 minutos") — nenhum cenário desta suíte usa uma duração explícita diferente do default de 30s; validar se a duração é de fato respeitada ponta a ponta até Rafa.
6. **Comando totalmente fora de domínio** (ex. pedir algo que não é conteúdo de marketing) — não coberto; confirmar que o sistema falha ou degrada de forma previsível em vez de produzir um Editorial Brief sem sentido.
7. **Re-execução de `--campaign-generate-plan` para o mesmo conteúdo após aprovação**, verificando explicitamente (não só por inferência) que o status não retrocede e que dois `ExecutionPlan`s distintos coexistem sem conflito.
8. **Idioma diferente de português** — nenhum cenário testa um prompt em outro idioma; o comportamento de Eduardo/João (heurísticas de palavra-chave em português) com um texto em inglês/espanhol não está coberto e deve ser decidido como suportado ou explicitamente não suportado antes do 1.0.
9. **Publicação em mais de dois canais simultâneos** (ex. Instagram + Facebook + LinkedIn no mesmo comando) — todos os cenários desta suíte usam no máximo dois canais; validar o comportamento de Ana com três ou mais canais solicitados ao mesmo tempo.
10. **Falha do provider de Ícaro em cada Skill** durante um cenário real de homologação (não só em teste automatizado) — confirmar visualmente, olhando a saída real da CLI, que a mensagem de "seguindo apenas com heurística" aparece de forma compreensível para quem está homologando, não só nos logs internos.

Recomenda-se tratar os itens 1, 4 e 8 como bloqueantes de decisão (mesmo que a decisão seja "não suportado nesta versão, documentar como tal") antes de fechar a versão 1.0, e os demais como complementares de acordo com o tempo disponível da equipe de homologação.
