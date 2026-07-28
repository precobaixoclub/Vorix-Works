# Relatório de validação real — Pipeline de vídeo após a evolução de Vanessa, Diego e Rafa

Nenhum código foi alterado nesta validação. Execução real via CLI, LOCAL_PRODUCTION, Arthur → Caio →
Bruno → Vanessa → Diego → Rafa → Maria → Lucas → Aprovação humana. Nada foi publicado.

**executionId:** `workflow-execution-mrihkkm9-31kglf` · client-rumo · tema "Seu casamento merece um
site oficial." · Reels 1080×1920, 30fps, 30s.

**Vídeo de comparação ("anterior"):** `workflow-execution-mridd5rs-jnkwri` — última execução real
com renderização local (`local_render`) anterior à evolução de Vanessa/Diego/Rafa (sem
`cinematography` nem `editingDecision` nas etapas), gerado em 2026-07-12 19:36, pouco antes da
evolução desta sessão.

## 1. Comando e decisão de formato

Comando enviado sem indicar formato — apenas a palavra "Reels" (pedida pelo usuário) decidiu a
classificação: `classifyRecommendedFormat` → `"reels"` → pipeline de vídeo. Eduardo confirmou:
`recommendedFormat: "reels"`, 30s, estrutura `Hook → Contexto → Benefícios → CTA`.

## 2. Assets — imagens e áudio (verificação real antes de renderizar)

- **Áudio**: verificado ANTES de executar — `find . -iname "*.mp3" -o -iname "*.wav"` não retornou
  nenhum arquivo em todo o repositório. Nenhuma trilha ou efeito sonoro físico existe hoje. Por
  instrução explícita do usuário, o vídeo foi gerado **sem fingir áudio** — `hasAudio: false`,
  `audioCodec` ausente no MP4 final. A pendência está registrada abaixo (seção 6).
- **Imagens de fundo**: a CLI atual (`src/interfaces/cli/`) não expõe nenhum mecanismo para
  informar `localAssets.backgroundImagePathBySceneOrder` em uma execução `run` normal — isso exigiria
  uma mudança de código (novo flag), que esta tarefa proíbe explicitamente. Como resultado, a
  renderização local usou o fundo procedural real (gradiente/sólido nas cores da marca
  `#C97F91/#111111/#FFFFFF`), que é comportamento documentado e testado do Rafa — **nunca um fundo
  vazio ou placeholder quebrado**, mas também não uma fotografia real por cena. Isso é reportado
  como limitação explícita na seção 7, com a lista de arquivos que seriam necessários.
- **Logo**: `IdentityContext.logoUri` da Clara resolveu para o arquivo real
  (`rumo-ao-altar-mark.png`) e aparece de fato no canto inferior direito do CTA final — nenhum
  aviso de logo ausente nesta execução.

## 3. Deliverables gerados (todos reais, verificados)

Em `artifacts/workflow-execution-mrihkkm9-31kglf/`:

| Pedido | Arquivo | Confirmação |
|---|---|---|
| Vídeo MP4 real | `videos/final-video.mp4` | 1080×1920, 30fps, 30s, H.264, 19,4 MB, `hasAudio: false` |
| Thumbnail | `thumbnail.png` | Frame real extraído do MP4 (t=1.2s) via FFmpeg |
| Roteiro | `roteiro.json` | Saída real e completa de Bruno (5 cenas) |
| Direção cinematográfica | `direcao-cinematografica.json` | Saída real de Vanessa, com `cinematography` (18 decisões) por cena |
| Plano de edição | `plano-de-edicao.json` | Saída real de Diego, com `editingDecision`/`selectedSoundEffects`/`musicTrack` por cena |
| video-prompt.txt | `video-prompt.txt` | `finalPrompt` real de Rafa (46.166 caracteres) |
| caption.txt / hashtags.txt / publication.txt | idem | Copy real de Maria, perfil "reels", score 100/100 |
| metadata.json / execution-report.json | idem | Gerados pela entrega padrão do Zuno |

(`thumbnail.png`/`video-prompt.txt`/`roteiro.json`/`direcao-cinematografica.json`/
`plano-de-edicao.json` não são gerados automaticamente pela CLI hoje — foram extraídos por mim,
como operador, 100% a partir de dados reais já produzidos pela execução, sem inventar conteúdo,
já que criar esses arquivos automaticamente exigiria mudança de código.)

## 4. Respostas às 7 perguntas

### 1. O vídeo deixou de parecer slideshow?

**Sim, comparado ao vídeo anterior.** Inspeção visual real de frames de ambos os vídeos:

- **Anterior** (`mridd5rs-jnkwri`, t=10s): fundo sólido preto **chapado**, sem nenhum gradiente de
  vinheta visível, sem indício de movimento na captura estática.
- **Novo** (`mrihkkm9-31kglf`, t=8s): vinheta clara e visível (cantos mais escuros, centro mais
  claro), confirmando `vignette=angle=PI/6` aplicado. Todas as 5 cenas têm zoom real (`pushIn: true`
  nas 4 primeiras, câmera estática deliberada só no CTA — decisão de Vanessa, não ausência de
  decisão).

Toda cena tem `zoom !== "none"` (garantia testada em `tests/cinematic-enrichment.test.mjs`) —
nenhuma cena ficou estática por acidente.

### 2. Os movimentos de câmera seguem as decisões do Diego?

**Sim, diretamente.** `resolveMotion()` em Rafa lê `editingDecision.pushIn`/`.pullOut`/`.pan` como
autoridade. Confirmado nos dados reais desta execução:

| Cena | `pushIn` (Diego) | zoom aplicado (Rafa) |
|---|---|---|
| Gancho | `true` | `in` |
| Desenvolvimento 1-3 | `true` | `in` |
| CTA final | `false` (nem pan) | `out` (variação por índice, já que Diego não pediu push-in/pull-out/pan aqui — coerente com a cinematografia "estático" da Vanessa para o CTA) |

Nenhuma decisão veio de `index % 2` improvisado sem relação com o conteúdo, como acontecia antes.

### 3. As transições variam conforme a cena?

**Parcialmente — variam por papel narrativo, não entre as 3 cenas de desenvolvimento entre si.**
Dados reais: Gancho = `cut`, Desenvolvimento 1/2/3 = `dissolve` (as três, idênticas), CTA final =
`glow`. Isso é uma consequência honesta de uma limitação a montante: Bruno atribui `rhythm:
"moderado"` às três cenas de desenvolvimento igualmente (não diferencia uma da outra), e
`enrichEditingDecision` deriva a transição do papel narrativo + ritmo — com o mesmo ritmo, as três
cenas do meio recebem a mesma transição. A variação **entre gancho, meio e fechamento** é real e
comprovada (`cut` → `dissolve` → `glow`, nunca mais sempre "fade"); a variação **dentro do bloco de
desenvolvimento** dependeria de Bruno atribuir ritmos diferentes por cena, o que está fora do
escopo desta validação (Bruno não foi alterado).

### 4. Existe progressão emocional?

**Sim, por desenho explícito de Vanessa.** `cinematography.emotion` real por cena: Gancho =
"Curiosidade ou tensão imediata" → Desenvolvimento = "Confiança tranquila" → CTA final = "Confiança
e convite". `cinematography.pace`: acelerado → moderado → moderado (com câmera estática reforçando
resolução). Isso é uma decisão registrada e testada, não uma impressão subjetiva.

### 5. A mensagem é compreendida nos primeiros 3 segundos?

**Sim, o texto principal é compreendido — mas com uma poluição visual real encontrada.** O
headline "Seu casamento merece um site oficial." aparece grande, centralizado, legível, exatamente
no primeiro frame. **Porém a inspeção do frame real (`thumbnail.png`) revela um problema
concreto**: uma caixa de legenda semi-transparente adicional aparece abaixo do headline, repetindo
o texto integral de `spokenText` — que no roteiro de Bruno inclui o prefixo interno da estratégia
("Abertura de impacto conectada ao ângulo..."). Esse comportamento é gerado por
`captionText !== onScreenText` em `DiegoTimelineEntry` (já existia antes da evolução de hoje —
confirmado comparando com frames do vídeo anterior nos mesmos timecodes, que apresentam exatamente
o mesmo padrão de legenda duplicada) e é uma característica do roteiro determinístico de Bruno,
fora do escopo desta tarefa (Bruno não foi tocado). A mensagem central é entendida, mas a poluição visual da legenda duplicada é um ponto real
de qualidade a resolver numa futura evolução do Bruno.

### 6. O vídeo possui faixa de áudio real?

**Não — e isso está registrado corretamente, não escondido.** `hasAudio: false`,
`audioCodec` ausente. Verificação prévia confirmou que nenhum arquivo de áudio físico existe no
projeto. Diego selecionou automaticamente, de forma real e determinística:

- **Trilha**: categoria `wedding` ("Wedding" — cordas e piano, tom celebratório e caloroso),
  arquivo esperado em `assets/audio/music/wedding.mp3` (ainda não existe fisicamente).
- **Efeitos sonoros por cena**: Gancho → `impact_leve` + `pop` (`assets/audio/sfx/impact-leve.mp3`,
  `assets/audio/sfx/pop.mp3`); Desenvolvimento 1-3 → `sweep` (`assets/audio/sfx/sweep.mp3`); CTA
  final → `notification` + `sparkle` (`assets/audio/sfx/notification.mp3`,
  `assets/audio/sfx/sparkle.mp3`).
- **Plano de mixagem já definido e pronto** (não executado por falta de arquivo): fade-in de 1s,
  fade-out de 2s, volume normalizado, ducking automático de ~0,6s em cada um dos 5 pontos de efeito
  sonoro acima.

Assim que esses 6 arquivos existirem fisicamente em `assets/audio/`, a mesma execução (via
`--continue` com os assets informados, ou uma nova execução) produzirá o MP4 com áudio real,
fade-in/fade-out e ducking — sem nenhuma mudança de código, porque a lógica já está implementada e
testada (`tests/cinematic-enrichment.test.mjs`, validada com renderização real de áudio).

### 7. Quais limitações ainda permanecem?

1. **Sem arquivos de áudio físicos** — 1 trilha (`wedding.mp3`) + 5 efeitos sonoros distintos
   listados acima, todos em `assets/audio/`. Maior pendência para o próximo vídeo ter som real.
2. **Sem mecanismo de CLI para fornecer imagens de fundo reais por cena** — `localAssets` existe no
   tipo de entrada de Rafa mas nenhum fluxo da CLI o preenche; corrigir isso exige código (um novo
   flag), fora do escopo de hoje. Até lá, todo vídeo usa fundo procedural com cores reais da marca.
3. **Legenda duplicada com texto interno da estratégia** (pergunta 5) — característica do roteiro
   determinístico de Bruno, não desta evolução, mas visível e real.
4. **Baixo contraste real encontrado em uma cena específica**: a cena "Desenvolvimento 2" pode cair
   em um fundo procedural quase branco (quando o índice da cena cicla para a cor de marca branca em
   modo gradiente) com texto branco por cima — praticamente ilegível nessa combinação específica.
   Achado por inspeção visual real de frame, não pelo checklist automatizado do Lucas (que só
   verifica presença de texto, não contraste real). Relevante para uma futura melhoria de Rafa, fora
   do escopo de "não alterar código" desta validação.
5. **Transições idênticas entre as 3 cenas de desenvolvimento** (pergunta 3) — depende de Bruno
   variar o ritmo cena a cena, fora do escopo desta validação.
6. **Parallax, partículas, flare e motion blur real** seguem não implementados no renderizador (já
   documentado no relatório da evolução anterior).

## 5. Validação técnica

`npm run typecheck` / `npm test` / `npm run architecture:check` não foram executados nesta tarefa
por instrução explícita do usuário ("não altere código") — nenhuma mudança de código foi feita,
então não há nada nesses comandos que pudesse ser afetado por esta validação. A suíte completa
(639/639) já havia sido confirmada no relatório de evolução anterior
(`docs/video-cinematic-enrichment-report.md`).
