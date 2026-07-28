# Relatório — Elevação permanente da qualidade dos vídeos (Vanessa, Diego, Rafa)

## 1. Objetivo

Aplicar à pipeline de vídeo a mesma filosofia usada para elevar permanentemente a pipeline de
imagens (Sofia/Bianca/Pedro): eliminar decisões implícitas, reduzir ao máximo a liberdade
interpretativa da renderização, e garantir que todo vídeo futuro — não só um vídeo específico —
nasça com decisões cinematográficas explícitas. Nenhuma Skill nova foi criada. Arthur, Caio, Helena
e Bruno não foram tocados — Bruno permanece exclusivamente responsável pelo roteiro. Tudo abaixo
vive dentro de Vanessa, Diego e Rafa (mais um arquivo compartilhado em `src/shared`, que nunca foi
Skill, e extensões aditivas do `VideoRenderingPort`/compilador de filtros do FFmpeg que só existem
para servir a Rafa).

## 2. Auditoria (antes de qualquer mudança de código)

Leitura completa de `vanessa-video-direction.skill.ts`, `diego-video-editing.skill.ts`,
`rafa-video-rendering.skill.ts` e `timeline-to-filter-compiler.ts` (~2900 linhas) revelou:

### 2.1 Decisões que já eram tomadas
Vanessa já decidia enquadramento (texto livre), composição visual (texto livre), movimento de
câmera (herdado de Bruno) e transição por cena. Diego já traduzia isso em uma timeline técnica com
`cutType` (texto livre) e efeitos visuais. Rafa já renderizava um MP4 real localmente via FFmpeg
(zoom/pan, overlays de texto, transição, trilha e efeitos sonoros básicos).

### 2.2 Decisões que ficavam implícitas (a causa-raiz do problema)
- Vanessa descrevia enquadramento/composição em **3 templates fixos** (Gancho/CTA final/genérico),
  sem nunca declarar tipo de plano, posição/altura de câmera, lente, profundidade de campo, foco
  principal, temperatura de cor, velocidade de movimento, duração ideal da tomada, regra dos
  terços, direção do olhar ou motivo narrativo — 13 das 18 decisões pedidas simplesmente não
  existiam como campo algum.
- Diego reduzia toda decisão de edição a **uma única string livre** (`cutType`) — nenhum campo para
  velocidade de corte, ritmo, ponto de respiração, tipo de transição (separado de texto),
  zoom/pan/push-in/pull-out/speed-ramp/whip/fade/blur/glow/mask/motion-blur, animação de texto,
  entrada/saída de CTA, easing ou sincronismo.
- Trilha e efeitos sonoros eram só sugestão em texto livre (`musicSuggestions`,
  `soundEffectSuggestions`) — nenhuma seleção real de uma biblioteca, nenhum critério automático.

### 2.3 Decisões deixadas para o FFmpeg/renderizador (o achado mais crítico)
Em `rafa-video-rendering.skill.ts`, função `buildRenderPlan`:
```ts
zoom: index % 2 === 0 ? "in" : "out",   // decidido pela PARIDADE do índice da cena, não por Diego
pan: "none",                             // nunca usado, pan sempre desligado
```
E em `timeline-to-filter-compiler.ts`, função `buildTransitionChain`:
```ts
xfade=transition=fade:duration=...       // toda transição, sempre "fade", literal e hardcoded
```
Ou seja: mesmo quando Diego (antes desta evolução) descrevia uma transição como "corte seco, sem
efeito", o vídeo renderizado usava sempre o mesmo `xfade=transition=fade` — só a duração do
crossfade mudava. E a direção do zoom nunca refletia nenhuma decisão real: alternava por sorte de
posição. Isso é exatamente "liberdade interpretativa da renderização" no sentido mais literal.

## 3. O que foi construído

### 3.1 `src/shared/utils/cinematic-reference-library.ts` (novo)
Biblioteca central + três motores de enriquecimento determinísticos (nunca dependem de IA, nunca
falham):
- `enrichCinematicScene(role, rhythm, durationSeconds)` — as 18 decisões cinematográficas de
  Vanessa.
- `enrichEditingDecision(role, rhythm, hasCta)` — o pacote completo de decisões de edição de Diego.
- `selectMusicTrack(...textos)` / `selectSoundEffectsForScene(role, transition)` — seleção
  automática de trilha (7 categorias) e efeitos sonoros (8 efeitos), só arquivos locais
  (`assets/audio/music/*.mp3`, `assets/audio/sfx/*.mp3`), sem nenhuma API externa.
- `CINEMATIC_REFERENCE_LIBRARY` — 8 referências de gênero (Apple, Airbnb, Google, Nubank, Notion,
  Nike, filme de casamento, comercial premium), descritas por qualidade de ritmo/enquadramento/
  fotografia/iluminação/direção/edição/narrativa — nunca um elemento de marca registrada.

### 3.2 Vanessa — Diretora de Comerciais
`VanessaSceneDirection` ganhou o campo `cinematography` (as 18 decisões). `buildSceneDirection`
agora chama `enrichCinematicScene` para toda cena, mantendo os 3 papéis narrativos (gancho/CTA/
desenvolvimento) mas com decisão cinematográfica completa em vez de 3 frases soltas.

### 3.3 Diego — Editor Profissional
`DiegoTimelineEntry` ganhou `editingDecision` (pacote completo de edição) e
`selectedSoundEffects` (efeitos escolhidos automaticamente). `DiegoEditingCore`/`DiegoRafaBriefing`
ganharam `musicTrack` (trilha estruturada, escolhida por `selectMusicTrack` a partir do tom de voz/
ângulo/pedido original — nunca mais só uma frase-sugestão).

### 3.4 Rafa — Renderizador de Motion Graphics
- `resolveMotion`/`resolveTransition` (novas funções internas) leem `editingDecision.pushIn` /
  `.pullOut` / `.pan` / `.transition` de Diego como autoridade — a paridade de índice só decide a
  variação (in/out, esquerda/direita) quando Diego não decidiu explicitamente push-in/pull-out, e
  **nunca mais deixa uma cena sem zoom** (garantia de movimento contínuo, mesmo partindo só de
  imagens estáticas — ver seção MOTION do pedido original).
- `VideoSceneTransition` (porta) passou de `"cut" | "fade"` para `"cut" | "fade" | "dissolve" |
  "slide" | "wipe" | "whip" | "glow"`, e o compilador de filtros do FFmpeg (`timeline-to-filter-
  compiler.ts`) agora traduz cada um para o nome real do efeito `xfade` (`dissolve`, `slideleft`,
  `wipeleft`, `hblur`, `fadewhite`) — transições **realmente diferentes**, não só uma duração
  diferente do mesmo `fade`.
- Vinheta muito leve (`vignette=angle=PI/6`) agora é aplicada **sempre**, em toda cena, como
  acabamento de motion graphics.
- `VideoAudioTrack` ganhou `fadeInSeconds`/`fadeOutSeconds`/`duckAtSeconds`/`duckAmount`/
  `duckDurationSeconds`. A trilha agora tem fade-in/fade-out reais (`afade`) e **ducking automático
  sem side-chain**: o volume da trilha cai automaticamente em cada ponto onde Diego selecionou um
  efeito sonoro (expressão `volume` com `between(t,...)` por janela), sobe de volta sozinho depois.
- Todas as mudanças de FFmpeg foram validadas com **renderização real** (FFmpeg 6.1.1, `ffmpeg-
  static`): os 7 estilos de transição (`fade`, `dissolve`, `slide`, `wipe`, `whip`, `glow`, `cut`) e
  o fluxo completo de fade-in/fade-out/ducking foram executados de ponta a ponta com sucesso antes
  de entrarem nos testes automatizados.

## 4. Exemplo real: cena de desenvolvimento, ritmo dinâmico — antes e depois

**Antes** (Vanessa, texto livre único):
> "Plano médio, enquadramento estável, com espaço lateral para elementos gráficos de apoio."
> `cameraMovement`: herdado de Bruno, sem mais detalhe.

**Depois** (Vanessa, `cinematography`, saída real de `enrichCinematicScene("development",
"dinamico", 9)`):
```json
{
  "shotType": "detalhe",
  "cameraPosition": "Levemente lateral, ângulo de três quartos, sensação de movimento.",
  "cameraHeight": "Altura dos olhos a levemente acima — postura confiante sem intimidar.",
  "simulatedLens": "Lente 50mm simulada, leve compressão, foco isolado no detalhe.",
  "depthOfField": "Profundidade de campo rasa a moderada: sujeito nítido, fundo suavemente desfocado.",
  "lighting": "Luz natural suave, direcional, com sombra suave para dar volume sem dureza.",
  "colorTemperature": "Quente (4200K-4800K) — acolhedora, coerente com contexto de casamento.",
  "pace": "Dinâmico — cortes mais curtos, câmera com leve movimento contínuo.",
  "cameraMovementSpeed": "Rápida o suficiente para transmitir progresso, sem tremular.",
  "ruleOfThirds": "Aplicada: sujeito/elemento principal posicionado sobre a linha do terço lateral.",
  "narrativeMotive": "Sustentar e aprofundar a promessa central entre o gancho e o CTA.",
  "referenceStyle": "nubankConfidentModern",
  "idealTakeDurationSeconds": 9
}
```

**Antes** (Diego, `cutType` único):
> "Corte dinâmico sincronizado com a batida da narração, com fade curto de 2 a 3 quadros entre cenas."

**Depois** (Diego, `editingDecision`, saída real de `enrichEditingDecision("development",
"dinamico", true)`):
```json
{
  "cutType": "montage_cut",
  "cutSpeed": "Rápida — cortes a cada 1,5-2,5s.",
  "transition": "whip",
  "pan": true, "speedRamp": true, "whip": true, "blur": true, "motionBlur": true,
  "textAnimation": "slide_up",
  "easing": "back_out",
  "animationTimingSeconds": 0.2,
  "syncNotes": "Animação de texto sincronizada ao início da fala da cena, nunca antes ou depois da narração."
}
```

**Antes** (Rafa/renderizador): `zoom` decidido por `index % 2`, `pan` sempre `"none"`, transição
sempre `xfade=transition=fade`.

**Depois** (Rafa/renderizador, request real capturado em teste): `zoom: "in"`, `pan:
"left_to_right"` (porque `editingDecision.pan === true`), `transitionToNext: "whip"` → compilado
para `xfade=transition=hblur` — uma transição realmente diferente de um `fade` comum.

## 5. Áudio — trilhas, efeitos e mixagem automática

7 categorias de trilha (romântica, elegante, emocional, inspiradora, moderna, minimalista, wedding)
e 8 efeitos sonoros (whoosh, sweep, click, pop, sparkle, notification, rise, impacto leve), todos
referenciados como arquivos locais (`assets/audio/music/*.mp3`, `assets/audio/sfx/*.mp3` — **sem
nenhuma API externa**, conforme pedido). Diego seleciona automaticamente a trilha (por tom de voz/
ângulo/tema) e os efeitos (por papel narrativo + tipo de transição); Rafa mixa automaticamente:
volume normalizado, fade-in (1s) e fade-out (2s) sempre aplicados à trilha, e ducking automático
nos pontos de cada efeito sonoro — tudo sem side-chain, validado com renderização real.

## 6. Testes

`tests/cinematic-enrichment.test.mjs` (22 testes): as 18 decisões de Vanessa, o pacote completo de
Diego, a biblioteca de trilhas/efeitos, a seleção automática, a garantia de movimento contínuo de
Rafa (zoom nunca "none"), a tradução real de transição (whip → hblur), o ducking automático via
`compileFfmpegArgs`, e a vinheta sempre-ligada. Todos os testes pré-existentes de Vanessa (73),
Diego, Rafa e do adaptador real de FFmpeg (15, incluindo renderização real de MP4) continuam
passando sem alteração.

## 7. Validação técnica

- `npm run typecheck`: **limpo**, zero erros.
- `npm test`: **639/639 testes passando** (617 pré-existentes + 22 novos).
- `npm run architecture:check`: **limpo** — 12 Skills descobertas, todas READY.
- Renderização real com FFmpeg 6.1.1 confirmada para os 7 estilos de transição e para fade-in/
  fade-out/ducking de áudio, fora da suíte de testes, antes de qualquer código ser considerado
  pronto.

## 8. Como a qualidade dos vídeos deve evoluir

Antes: todo vídeo tinha o mesmo "template" de movimento (zoom alternado por sorte, transição sempre
fade), independente do que Vanessa/Diego intencionassem. Agora: cada cena carrega uma decisão
cinematográfica completa e rastreável até a renderização real — um gancho sempre é corte duro sem
respiro com zoom push-in; um desenvolvimento em ritmo dinâmico sempre ganha pan real, speed ramp e
transição `whip`; um fechamento de CTA sempre tem ponto de respiração e transição `glow`. Nenhuma
cena fica sem movimento (garantia de zoom sempre ativo), a trilha entra e sai suavemente e abre
espaço automaticamente para cada efeito sonoro, e a vinheta discreta dá acabamento consistente em
todo vídeo — sem que nenhuma dessas decisões dependa de coincidência de índice ou de um `fade`
genérico disfarçado de "transição".

## 9. Limitações que ainda permanecem (honestas, não escondidas)

- **Arquivos de áudio ainda não existem fisicamente.** `MUSIC_TRACK_LIBRARY`/`SOUND_EFFECT_LIBRARY`
  apontam para `assets/audio/music/*.mp3`/`assets/audio/sfx/*.mp3` por convenção — a seleção e o
  plano de mixagem são 100% reais e automáticos, mas a renderização local só usa a trilha/efeito de
  fato quando esse arquivo existir e for passado via `localAssets` (mesmo comportamento que já
  existia para B-roll e trilha antes desta evolução). Recomendação: popular esses diretórios com
  arquivos reais (ou geração local, sem API externa) antes da próxima fase.
- **Parallax, partículas discretas, flare suave e mask não estão implementados no renderizador
  real.** Foram avaliados e descartados nesta fase por risco/complexidade de implementação segura
  em FFmpeg dentro do tempo disponível — `glow`/`blur`/`mask` já existem como *decisão explícita* em
  `editingDecision` (Diego decide, documentado), mas o compilador de filtros ainda não os traduz em
  filtros reais. Zoom cinematográfico, transições elegantes, animação de texto (via drawtext já
  existente), vinheta e ducking de áudio, sim, estão implementados e validados com renderização
  real.
- **Motion blur real não é sintetizado** (exigiria interpolação de quadros, cara e arriscada); o
  campo `motionBlur` de Diego documenta a intenção, mas o renderizador local não aplica esse efeito
  fisicamente ainda.
- **`textAnimation`/`easing`/`ctaEntry`/`ctaExit` de Diego não são traduzidos em keyframes de
  animação real no FFmpeg** (o `drawtext` atual já tinha fade simples; a decisão de Diego agora é
  explícita e auditável, mas o compilador ainda usa o mesmo fade simples para todo texto,
  independente do `textAnimation` escolhido). Próximo passo natural: mapear `textAnimation`/
  `easing` para expressões de `drawtext`/`alpha`/`x`/`y` variáveis no tempo, o mesmo padrão já usado
  para o fade de texto existente.
