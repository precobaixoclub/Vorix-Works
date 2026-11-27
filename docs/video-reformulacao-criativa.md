# Reformulação da direção criativa do motor de vídeo

Data: 27/11/2026. Fase local, com commits locais. Não houve push nem deploy, e o timer de vídeo continua desligado.

## 1. Diagnóstico das versões anteriores

O diagnóstico usou o mesmo medidor que agora analisa os vídeos de referência (`reference-profile.ts`), aplicado às três provas finais da fase anterior (A-cmkv, B-vorix, C-fala). Os quadros foram lidos visualmente e os números vêm de `scripts/video/diagnose-videos.mjs`.

| Origem | O que foi medido ou observado | Efeito |
|---|---|---|
| **Material** | CMKV: 3 fotos de estúdio por modelo, mesmo enquadramento, torso recortado, estampa ocupando cerca de 35% da largura e nenhuma filmagem. | Não existe movimento real. Todo movimento é 2,5D sobre a foto. |
| **Direção criativa** | O diretor escolhia num cardápio de 6 templates e na série "zoom do FFmpeg". As três provas têm o mesmo esqueleto (gancho de texto, produto, variantes, cartão). | A decisão era "qual template", e não "qual ideia". As peças convergiam. |
| **Composição** | Foto em **cartão** sobre fundo escuro desfocado, com o assunto **centralizado em 78–95% dos quadros** e ocupando cerca de 40% do quadro (A e B). Em A, o título sobrepunha a foto. Na vertical, cerca de metade do quadro era gradiente vazio. | Cara de slideshow ou PowerPoint. |
| **Motion** | Cada cena era um clipe Remotion **isolado**, colado pelo FFmpeg. Não havia camadas persistentes nem transições coordenadas. **6% de quadros vazios** (A), incluindo a abertura do `product_hero` ainda sem conteúdo. Planos de **4–8 s** (C: plano mediano de 7,8 s, com gancho de 8,5 s). | Ritmo arrastado e cenas paradas. |
| **Tipografia** | Barlow (caixa alta) e serifa alternando por cena. O cartão final (círculo, linha e pílula) era idêntico para todas as marcas. | Identidade inconsistente. |
| **Áudio** | A trilha de produção era **soma de senoides** (`aevalsrc`: pad, arpejo e bumbo sintético) num laço fixo. A edição era "encaixada" nessa batida. | Som de demonstração, não de anúncio. |
| **Renderização** | Tecnicamente íntegra (CRF 17, 30 q/s, −14 LUFS). Não é a causa. | — |
| **Avaliação editorial** | O QG aprovava (`ready_for_review`) peças medianas: só contava animações e transições e marcava o subjetivo como "revisão". Não havia referência, feedback humano por marca nem registro de reprovações. | "Aprovado" sem padrão comercial. |

Referências medidas (os dois vídeos enviados pelo usuário):

| | Vídeo 1 (estrutura) | Vídeo 2 (estética) | A-cmkv anterior |
|---|---|---|---|
| Plano mediano | **1,33 s** | 1,92 s | 4,0 s |
| Cortes a cada 10 s | 5,2 | 3,6 | 1,9 |
| Cortes na batida | 64% | 89% | 50% |
| Fechamento | 5,8 s (logo, título, botão, URL) | 3,7 s (logo nascendo de uma linha) | 4 s (cartão genérico) |

## 2. Vídeos de referência no Bolsão

- Cada pauta aceita **até 3 vídeos de referência** (`referenceVideos`), cada um com um **papel** (`structure`, `aesthetic` ou `both`) e uma nota livre. A estrutura de imagens de referência foi mantida.
  - Migração: `0211_editorial_idea_reference_videos.sql`.
  - Os vídeos só podem vir do storage do próprio workspace, enviados pelo botão da ideia. O motor nunca baixa link de terceiros.
  - Tela: `ReferenceVideosField` no editor de ideias de vídeo.
- O medidor (`analyzeReferenceVideo`) calcula sobre quadros reduzidos:
  - cortes e plano mediano;
  - ritmo por terço;
  - gancho e fechamento;
  - energia de movimento e câmera (deslocamento global);
  - luz, contraste, saturação, temperatura e paleta (k-means);
  - ocupação e centralização do assunto;
  - quadros vazios;
  - loudness e batida.
- **Tipografia e direção de arte não são medidas.** O diretor as lê nas miniaturas, e o prompt diz isso.
- O papel filtra o que vai ao diretor: estrutura leva ritmo e movimento; estética leva cor, composição e movimento.
- **Direitos:** a referência orienta uma criação **original**. O perfil guarda números e uma paleta, nenhum quadro da referência entra na peça, e o prompt proíbe copiar textos, layouts ou cenas.

## 3. Storyboard antes da renderização

1. **Três propostas** (`scripts/editorial/storyboard-director.mjs`, schema estrito). Cada uma traz:
   - conceito, roteiro, planos e storyboard;
   - materiais e recursos técnicos;
   - linguagem de animação e direção de arte;
   - tratamento de áudio (clima e BPM);
   - o que vem de cada referência;
   - limitações previstas.
2. **Validação** (`validateProposal`):
   - o gancho tem no máximo 2,2 s e no máximo 5 palavras;
   - o tempo de leitura é respeitado;
   - nenhum plano parado passa de 4,2 s;
   - os materiais existem;
   - há variantes suficientes para comparação ou troca de cor;
   - o recorte da estampa é confiável;
   - o CTA está no último plano;
   - **spoiler**: em pauta com revelação, o gancho não pode mostrar o produto inteiro.
3. **Distinção** (`proposalDistance`): mede linguagem, abertura, sequência de planos (Jaccard), ênfase e alinhamento, e BPM. Exige 3 ou mais diferenças entre cada par.
4. **Seleção com critérios explícitos e medidos** (`scoreProposal`). O Codex **não** dá nota. Cada critério mostra a sua evidência.

   | Critério | Peso |
   |---|---|
   | Gancho | 0,18 |
   | Produto em cena | 0,16 |
   | Ritmo da referência de estrutura | 0,14 |
   | Movimento com intenção | 0,12 |
   | Linguagem da referência de estética | 0,12 |
   | Leitura e lógica da revelação | 0,10 |
   | CTA | 0,08 |
   | Viabilidade com os materiais | 0,06 |
   | Gosto da marca | 0,04 |

   Penalidades: −0,15 por padrão reprovado pela marca e −0,3 por pendência de material, CTA ou recorte.
5. **Refação direcionada:** a escolhida volta ao Codex com as pendências medidas, as regras da marca e o storyboard renderizado como imagem. Se as duas primeiras ficam a menos de 0,03 uma da outra (**empate técnico**), as duas são refeitas e pontuadas de novo.
6. **Storyboard visual de baixo custo:** `renderStills` gera 2 quadros parados por plano, sem codificar vídeo (cerca de 11–15 s por proposta no PC).
7. **Prévia** (metade da resolução, CRF 23), revisão e depois o **final**.

## 4. Motion design: Spot

`motion-graphics/src/templates/spot.tsx` gera a peça inteira **numa única linha do tempo**:
- os planos se sobrepõem nas transições, e a entrada de um conversa com a saída do anterior;
- a identidade é persistente (índice editorial e granulação).

**Câmera virtual** (`lib/camera.ts`):
- trabalha em coordenadas da foto original, com enquadramentos nomeados a partir da estampa (`full`, `chest`, `print`, `macro`, `detail` e a faixa);
- o zoom é logarítmico e a ampliação é limitada para não perder nitidez;
- nunca mostra borda vazia (`clampRect`).

**Planos:**

| Plano | O que faz |
|---|---|
| `hook_type` | Frase gigante no 1º quadro, chegando com desfoque, sempre fora do traço. |
| `trace_draw` | A estampa real se desenha ao longo da linha, com ponta de luz, e **pousa** onde está no plano seguinte. |
| `print_assemble` | Elementos da estampa entram um por batida. |
| `fullbleed` / `macro` | Foto em tela cheia com câmera; colchetes de foco opcionais. |
| `bands` | Comparação empilhada, com a estampa inteira em cada faixa e rótulos A/B em bloco. |
| `countdown` | 3-2-1 sobre a comparação. |
| `variant_cycle` | Troca de cor com a estampa **travada** no mesmo ponto da tela. |
| `type_card` | Cartela tipográfica em campo de cor da marca. |
| `logo_resolve` | Logo oficial nascendo de uma linha de luz, título, botão com brilho e aproximação lenta. |

**Tipografia:**
- display da marca, Geist (OFL) para rótulos e legendas, e ênfase por `*palavra*` (cor ou bloco);
- a legenda em pílula acende palavra a palavra;
- a tinta do texto é escolhida pela luz real da foto sob ele (`lumaGrid`).

**Material** (`print-extraction.ts`, `product-material-analysis.ts`):
- a estampa é separada do tecido **sem repintar**: o RGB original é mantido, só o tecido fica transparente, e a franja é desmisturada;
- a região cresce quando o traço sai pela borda;
- a caixa vem do consenso entre variantes da mesma sessão de fotos (base do match-cut);
- fragmentos isolados ficam de fora.

## 5. Áudio

`score-composer.ts`: trilha **composta para o corte**. É obra própria, sem amostras e sem licença envolvida.
- **Instrumentos:** bumbo com pitch e clique, clap, chimbal, baixo serrilhado filtrado, piano elétrico FM, pluck Karplus-Strong, pad, sino FM, riser, impacto e whoosh.
- **Master:** reverb, sidechain e limitador suave.
- **Arranjo:** segue a energia de cada plano.
- **Eventos sonoros nos mesmos quadros dos visuais:** entrada de elemento, pouso, troca de cor, linha da logo e botão.
- Os cortes caem na batida **por construção**, porque o storyboard é compilado na grade.
- Mixagem final: `loudnorm` −14 LUFS, pico −1,5 dBTP.

## 6. Qualidade orientada pelo usuário

- O **QG técnico** continua igual: decodificação, quadros pretos, silêncio, loudness e pico.
- O **padrão comercial só é declarado por pessoa** (`editorialVerdict`):
  - `blocked_technical`;
  - `awaiting_human`, que inclui o caso em que o Codex só observa;
  - `approved_commercial`;
  - `rejected`.
- **Gosto da marca** (`brand-video-taste.ts`, migração `0212_video_brand_feedback.sql`):
  - cada avaliação aprova (o que agradou) ou reprova (o que estava errado), com padrões de um vocabulário de 18 itens e uma nota;
  - reprovar exige motivo;
  - `deriveBrandTaste` transforma o histórico em preferidos e proibidos, que vão ao diretor e à seleção;
  - **as regras da marca valem na compilação**: por exemplo, uma marca que reprova cartões de foto não recebe a faixa de fotos.
- **API:**
  - `POST /v1/video-versions/:id/feedback`: aprovar também aprova a versão no fluxo de sempre (publicação vinculada ao hash e WhatsApp, sem mudança);
  - `GET /v1/video-brand-taste`.

## 7. Prova da CMKV

**Pauta:** a pauta **real** do Bolsão, `CMKV-QUIZ-RECORTE`, "De qual camiseta é esse traço?" (vídeo, `available`).

**Materiais:** fotos oficiais do catálogo:
- 000037 em preto, branco e bege (estampa "♡fé" em traço);
- 000043 em preto (Limonada);
- logo oficial.

**Comparação justa:** o **motor atual** (diretor antigo com Codex real, construtor e executor) rodou na mesma pauta e com as mesmas fotos.

**Propostas do Codex (real, 117 s):**
- P1 "Margem de revista" (editorial);
- P2 "O desenho por partes" (gráfica);
- P3 "Da curva à camiseta" (cinematográfica).

São distintas (3–4 diferenças por par), mas o Codex ignorou a regra da marca contra cartões de foto e, em P2 e P3, mostrou a estampa inteira no gancho do quiz.

**Refação (43 s cada):** as pendências foram corrigidas. Notas finais: P3 0,904, P1 0,730 (gancho com 2,22 s) e P2 0,650 (spoiler).

**Medido no MP4 final:**
- 17,1 s;
- plano mediano de 1,67 s;
- 5,3 cortes a cada 10 s (referências: 5,2 e 3,6);
- assunto centralizado em 64% dos quadros (antes, 95%);
- −13,8 LUFS e −1,7 dBTP;
- QG técnico OK.

| Etapa | Tempo (PC local) |
|---|---|
| Storyboard (14 quadros) | 11–15 s por proposta |
| Prévia (540×960) | 163 s |
| Final (1080×1920) | 187 s |
| Trilha | < 1 s |

**Custo:** US$ 0. Usou o Codex da assinatura existente, sem serviço pago e sem vídeo por IA.

## 8. Limitações (dependem de filmagem real ou de IA generativa)

- **Movimento:** todo movimento é 2,5D sobre fotos estáticas. Tecido em movimento, modelo andando, mãos e luz reagindo à textura exigem filmagem.
- **Resolução:** o macro do traço chega a 3× sobre a foto de 1440 px, então a textura fica macia. Uma foto de detalhe oficial resolveria.
- **Poses:** as fotos têm poses e dobras diferentes, e o match-cut alinha pela estampa, não pelo corpo.
- **Trilha:** é sintetizada. Tem estrutura de arranjo, mas não substitui uma trilha produzida ou licenciada. **O timbre precisa de aprovação por ouvido humano.**
- **Medidor:** o detector de batida erra em trilha cinematográfica (marcou 68 BPM). Os cortes ficam na batida pela grade, não pelo detector.
- **Tipografia das referências:** é lida pelo diretor nas miniaturas, não medida.
- **Integração:** os novos módulos estão no código, mas o piloto automático e o worker **ainda usam o caminho antigo**: o diretor de cenas, a trilha `procedural-music` e os templates por cena. Ligar o Spot e a trilha nova no worker é a próxima etapa e depende de deploy autorizado.

## 9. Rollback

- Todos os commits são locais e separados por frente. Basta reverter o commit da frente.
- As migrações `0211` e `0212` só **adicionam** coluna ou tabela. Pautas e vídeos antigos continuam iguais.
- O Spot é um template novo. Os templates antigos e o caminho do worker não mudaram.
