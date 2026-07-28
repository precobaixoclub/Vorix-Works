# Teste de estresse da pipeline de vídeo — Relatório final

**Execução:** `workflow-execution-mriilpin-epwijn` | **Modo:** LOCAL_PRODUCTION | **Nada foi publicado.**
**Nenhum código, Skill ou arquitetura foi alterado nesta tarefa** — apenas conteúdo/dados reais foram fornecidos via Developer Assisted Mode, exatamente como a pipeline funciona hoje.

Tema: "Seu casamento merece um site oficial." | Produto: Rumo ao Altar (rumoaoaltar.com.br) | Formato: Reels, 1080x1920, 30fps, 30s.

Este é um teste de estresse deliberadamente mais exigente que a [validação anterior](video-pipeline-real-validation-report.md): brief de agência publicitária, história em vez de lista de recursos, exigência explícita de uso total das capacidades novas de Vanessa/Diego/Rafa.

---

## 1. O que foi executado de verdade

- Fluxo real Eduardo → João → Bruno → Vanessa → Diego → Rafa → Maria → Lucas → Aprovação, sem atalhos.
- Rafa renderizou localmente com FFmpeg real em **22,6s**, produzindo um MP4 real de **20.655.364 bytes** (900 frames, 30,00s, H.264 High profile, 5504 kb/s) — não um placeholder.
- `generationMode: "local_render"` confirmado no `execution-report.json` (não caiu para modo assistido).
- Todos os 10 entregáveis pedidos foram gerados: `videos/final-video.mp4`, `thumbnail.png`, `roteiro.json`, `direcao-cinematografica.json`, `plano-de-edicao.json`, `caption.txt`, `hashtags.txt`, `publication.txt`, `metadata.json`, `execution-report.json`, `video-prompt.txt`.

## 2. Direção (Vanessa) — uso das 18 decisões cinematográficas

Cada uma das 5 cenas recebeu as 18 decisões completas (`cinematography`): `shotType`, `cameraPosition`, `cameraHeight`, `simulatedLens`, `depthOfField`, `mainFocus`, `lighting`, `colorTemperature`, `emotion`, `pace`, `cameraMovement`, `cameraMovementSpeed`, `composition`, `ruleOfThirds`, `gazeDirection`, `feeling`, `narrativeMotive`, `idealTakeDurationSeconds` — mais `referenceStyle`.

Variação real observada entre os 3 papéis narrativos:

| Papel | shotType | lente sim. | referenceStyle | regra dos terços |
|---|---|---|---|---|
| Gancho | close | 35mm | nikeEnergyMomentum | ignorada de propósito (centralização) |
| Desenvolvimento (×3, idênticas) | medio | 50mm | airbnbCinematicWarmth | aplicada |
| CTA final | close | 35mm | appleMinimalCommercial | ignorada de propósito |

As 3 cenas de desenvolvimento saem com `cinematography` **byte-idêntico** entre si — confirmado no `execution-report.json`. Causa raiz confirmada por leitura de código: Bruno atribui `rhythm = "moderado"` fixo a todas as cenas de desenvolvimento (`buildScenes()`), e `enrichCinematicScene(role, rhythm, duration)` é pura — mesmo (role, rhythm) sempre produz a mesma decisão. Não é falha de Vanessa; é um limite de Bruno, fora do escopo desta validação.

## 3. Edição (Diego) — uso dos novos recursos

`editingDecision` por cena, real:

| Cena | cutType | transition | zoom/push-in | textAnimation | easing |
|---|---|---|---|---|---|
| Gancho | hard_cut | cut | sim/sim | pop | ease_out |
| Dev 1/2/3 (idênticas) | match_cut | dissolve | sim/sim | slide_up | ease_in_out |
| CTA final | hard_cut | **glow** | não/não | fade_in | ease_out |

Recursos do brief efetivamente usados: cortes (`hard_cut`/`match_cut`), dissolve, glow, push-in, zoom, easing (`ease_out`/`ease_in_out`), animação de texto (`pop`/`slide_up`/`fade_in`), entrada/saída de CTA com escala 96%→100%. **Não usados nesta execução:** `whip`, `blur`, `pullOut`, `pan`, `speedRamp`, `mask`, `motionBlur` — porque `enrichEditingDecision` os associa a combinações de `(role, rhythm)` diferentes das que este roteiro específico gerou (gancho=acelerado, todas as demais=moderado). O recurso existe no código e foi validado em `tests/cinematic-enrichment.test.mjs`, mas este roteiro específico não acionou essas variações.

Vinheta leve confirmada aplicada nas 5 cenas (visível nos frames extraídos, ver seção 5).

## 4. Áudio — verificação honesta

- **Biblioteca local verificada antes de qualquer decisão**: `assets/audio/music/` e `assets/audio/sfx/` não continham os arquivos físicos necessários nesta execução.
- Diego selecionou corretamente a trilha "Wedding" (categoria `wedding`, resolvida deterministicamente por `selectMusicTrack` a partir da palavra "casamento" recorrente na solicitação) e os efeitos sonoros por cena — mas **nenhum arquivo físico existia**, então nada foi simulado.
- Músicas procuradas: `assets/audio/music/wedding.mp3`.
- Efeitos que fariam parte do vídeo: `impact-leve.mp3` e `pop.mp3` (gancho), `sweep.mp3` (as 3 transições de desenvolvimento), `notification.mp3` e `sparkle.mp3` (CTA final) — todos em `assets/audio/sfx/`.
- Resultado real: `specs.hasAudio: false` no `execution-report.json`. O vídeo final é mudo. Isso é reportado de forma transparente, não escondido.

## 5. Renderização (Rafa) e inspeção visual real de frames

Frames reais extraídos com FFmpeg em 10 timecodes (`artifacts/workflow-execution-mriilpin-epwijn/qa-frames/`) e inspecionados visualmente:

- **Gancho (t=0.3s):** gradiente rosé da marca, headline limpa e legível, boa hierarquia. **Bug confirmado:** uma segunda caixa de legenda abaixo mostra o texto interno bruto de Bruno ("Abertura de impacto conectada ao ângulo 'Jornada emocional...'"), não apenas a headline limpa.
- **Desenvolvimento 1 (t=6.3s, t=9s):** fundo sólido preto, bom contraste, mesmo bug de legenda duplicada presente ("Desenvolver a mensagem-chave: ...").
- **Desenvolvimento 2 (t=12.3s, t=15s):** **bug de contraste confirmado e reproduzido** — fundo em gradiente quase branco (`buildProceduralBackground` caiu no índice que usa a cor branca da marca, #FFFFFF, em modo gradiente) deixando o texto branco quase ilegível. Mesmo bug de legenda duplicada também presente.
- **Desenvolvimento 3 (t=18.3s):** fundo em gradiente rosé, bom contraste, texto legível, mesmo bug de legenda duplicada presente.
- **CTA final (t=24.3s):** a cena mais limpa — fundo preto, texto branco de alto contraste, logo real do Rumo ao Altar visível no canto inferior, glow sutil ao fundo, **sem** legenda duplicada (porque aqui `captionText === onScreenText`, ambos "Conheça o Rumo ao Altar").

Ambos os bugs (legenda duplicada e contraste branco-sobre-branco) já haviam sido identificados na validação anterior e são reproduzidos de forma idêntica aqui — confirmando que são características estruturais da pipeline atual, não acasos desta execução.

## 6. Autocrítica extremamente crítica

| Dimensão | Nota (0-10) | Justificativa |
|---|---|---|
| Roteiro | 7 | Estrutura de jornada emocional bem construída (chegada → alívio → união → CTA), sem listar funcionalidades como rótulos. Perde pontos porque o `spokenText` interno de Bruno (não editável neste modo) vaza para a tela como legenda duplicada, quebrando a limpeza do próprio roteiro que foi escrito para ser limpo. |
| Direção (Vanessa) | 8 | As 18 decisões cinematográficas estão todas presentes e bem fundamentadas (lente, luz, profundidade, emoção, motivo narrativo). Perde pontos apenas pela repetição forçada entre as 3 cenas de desenvolvimento — limite de Bruno, não de Vanessa. |
| Cinematografia (resultado visual real) | 6 | Quando o fundo funciona (gancho, dev1, dev3, CTA), o resultado é limpo e editorial. A cena de contraste branco-sobre-branco (dev2) derruba a média — em qualquer revisão humana real, essa cena seria reprovada isoladamente. |
| Edição (Diego) | 7 | Variedade real entre gancho/desenvolvimento/CTA (cut→dissolve→glow, pop→slide_up→fade_in). Não usa a amplitude total do vocabulário pedido pelo usuário (whip, blur, pan, pull-out, speed-ramp não aparecem nesta execução específica) — presentes no código, mas não acionados por este roteiro. |
| Renderização (Rafa) | 6 | Render real, técnica e tecnicamente correta (H.264, 9:16, 30fps, 30s exatos, vinheta aplicada, logo real no CTA). Penalizada pela ausência total de áudio e pelo fundo 100% procedural (nenhuma imagem/vídeo real do casal, do site ou de convidados) — o brief pediu explicitamente "pareça um anúncio profissional produzido por uma agência", e um anúncio profissional real nunca é só texto sobre gradiente. |
| Ritmo | 7 | Progressão de ritmo (acelerado → moderado ×3 → moderado com peso) é coerente com a curva emocional pedida. As 3 cenas centrais idênticas fazem o meio do vídeo "descansar" ritmicamente mais do que o ideal para 30s de Reels. |
| Retenção | 5 | O gancho prende (headline forte, close-up, alto contraste). O meio do vídeo (especialmente dev2, ilegível) é o ponto onde um espectador real provavelmente perderia o vídeo — justamente o oposto do que se quer em um Reels. |
| Emoção | 7 | O roteiro e a direção comunicam a emoção pretendida (pertencimento, alívio, união) através de linguagem e enquadramento. A ausência de imagens reais de pessoas/casal limita o quanto a emoção realmente "aparece" na tela — hoje ela existe só no texto e na composição, não em rostos ou momentos reais. |
| Clareza | 6 | A mensagem central é clara nas cenas que funcionam. A legenda duplicada em 4 das 5 cenas (todas exceto CTA) é um ruído visual real que compete com a clareza pretendida pelo próprio roteiro. |
| Impacto visual | 5 | Alto no gancho e no CTA, baixo no miolo — sobretudo na cena de contraste quebrado. Nenhuma imagem real, nenhum movimento de câmera genuíno (é motion graphics sobre fundo estático/gradiente), o que limita o teto de impacto possível hoje. |
| CTA | 8 | O CTA final é a cena mais forte da peça: alto contraste, logo real, glow, sem legenda duplicada, frase curta e direta. É a evidência mais clara de que o sistema, quando os textos internos e finais coincidem, produz uma cena de qualidade publicável. |
| Potencial de conversão | 6 | Um espectador real que resistir à cena 3 (dev2) até o CTA teria um bom motivo para clicar. O problema é que a mesma cena que compromete a retenção também compromete a chance de o espectador chegar até lá. |

**Nota geral honesta: 6,5/10** — evolução real e mensurável frente à pipeline anterior (mais decisões, mais variedade estrutural, CTA de qualidade publicável), mas ainda não é uma peça pronta para publicação de agência.

### Respostas objetivas

1. **O vídeo realmente parece um anúncio profissional?** Parcialmente. O gancho e o CTA sozinhos poderiam passar por um anúncio institucional minimalista real. O miolo (as 3 cenas de desenvolvimento) ainda parece uma peça de motion graphics de texto sobre gradiente, não uma peça filmada ou com imagens reais — o que é a assinatura visual de uma pipeline sem assets, não de uma agência.

2. **Ainda parece um slideshow em algum momento?** Sim, nas 3 cenas de desenvolvimento. Elas têm zoom/push-in e transição (não são estáticas), mas por serem idênticas entre si em enquadramento, luz, cor e movimento, o efeito percebido é o de 3 slides muito parecidos em sequência, não de uma câmera se movendo por uma cena viva.

3. **Qual é a cena mais fraca?** Desenvolvimento 2 (t≈12-18s): fundo quase branco sobre texto branco, quase ilegível — seria reprovada em qualquer revisão humana de agência isoladamente.

4. **Qual é a cena mais forte?** CTA final: alto contraste, logo real da marca, glow sutil, sem o bug de legenda duplicada, frase curta e direta — a única cena onde tudo (roteiro, direção, edição, renderização) se alinha sem ruído.

5. **O que ainda impediria esse vídeo de ser publicado por uma empresa profissional?** (a) legenda duplicada em 4 de 5 cenas; (b) contraste ilegível na cena de desenvolvimento 2; (c) ausência total de áudio; (d) ausência de qualquer imagem/vídeo real (casal, convidados, site) — hoje é 100% tipografia sobre fundo procedural.

6. **Quais melhorias restantes dependem apenas de código?** Corrigir `buildProceduralBackground` para nunca gerar gradiente com a cor branca da marca (índice cíclico que hoje produz branco-sobre-branco); eliminar ou reformular a legenda duplicada em `buildRenderPlan` quando `captionText !== onScreenText`; opcionalmente permitir que Bruno varie `rhythm` entre as 3 cenas de desenvolvimento para destravar mais variedade em Vanessa/Diego; adicionar um mecanismo de CLI (`--local-assets`) para permitir fornecer imagens/vídeo/áudio reais a Rafa.

7. **Quais melhorias restantes dependem apenas da existência de assets?** A trilha `wedding.mp3` e os 5 efeitos sonoros listados na seção 4 (nenhuma mudança de código necessária, a lógica de seleção/mixagem/ducking já existe e foi validada); imagens ou vídeos reais do casal, do site rumoaoaltar.com.br, de convidados confirmando presença e do álbum de fotos, para substituir os fundos procedurais — o mecanismo de fallback já existe e funciona corretamente na ausência deles, mas o teto de qualidade visual real depende inteiramente de esses arquivos existirem.

## 7. Conclusão honesta

**A pipeline não está pronta para produção profissional publicável hoje**, mas evoluiu de forma real e verificável em relação à versão anterior: mais decisões estruturadas, variedade real entre papéis narrativos, uma cena (CTA) de qualidade genuinamente publicável, e transparência total sobre o que falta.

Bloqueadores restantes, em ordem de prioridade:

1. **[Código, prioridade máxima]** Bug de contraste branco-sobre-branco em `buildProceduralBackground` — torna uma cena inteira ilegível; corrigível com uma mudança pequena e isolada em Rafa.
2. **[Código, alta prioridade]** Legenda duplicada quando `captionText` (texto interno de Bruno) difere de `onScreenText` — presente em 4 das 5 cenas nesta execução; afeta diretamente a clareza e a percepção de profissionalismo.
3. **[Assets, alta prioridade]** Arquivo de trilha `wedding.mp3` e os 5 efeitos sonoros — sem eles, nenhum anúncio de agência real seria aceito mudo.
4. **[Assets, prioridade média]** Imagens/vídeo reais do casal, do site e de convidados — sem eles, o teto de impacto visual permanece limitado a tipografia sobre fundo procedural, mesmo com toda a direção e edição corretas.
5. **[Código, prioridade menor/opcional]** Permitir que Bruno varie o ritmo entre as 3 cenas de desenvolvimento, para que a variedade cinematográfica e de edição já implementada em Vanessa/Diego seja usada em toda sua amplitude (whip, blur, pan, pull-out, speed-ramp ainda não observados em execução real).

Nenhuma dessas correções exige nova Skill, mudança de arquitetura ou mudança de fluxo — são ajustes pontuais em código existente (itens 1, 2, 5) ou apenas a existência física de arquivos (itens 3, 4).
