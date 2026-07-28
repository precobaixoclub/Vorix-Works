# Renderização automática local de vídeo (VideoRenderingPort + FFmpeg)

Decisão técnica documentada em `docs/video-rendering-tooling-analysis.md`: FFmpeg local, chamado via `node:child_process.spawn` (nunca shell), atrás de uma porta de aplicação — nunca dentro de uma Skill. Esta página documenta como isso foi implementado.

## Objetivo e escopo

Transformar o plano técnico de edição que Diego já produz (`editingTimeline`: texto, tempo, transições, cortes) em um MP4 real e reproduzível, automaticamente, sem intervenção humana quando os assets necessários existem. Cobre **motion graphics com imagem real por cena**: fundo de imagem resolvido automaticamente pelo `VisualAssetResolverPort`, texto animado, legendas, CTA, logo, transições simples (corte/fade), zoom e pan suaves, trilha e efeitos sonoros locais opcionais. **Não** cobre filmagem real nem geração de vídeo por IA; quando uma cena exige uma fotografia/imagem real e nenhum asset adequado existe, o workflow pausa em Developer Assisted Mode para criação daquele asset, nunca usa placeholder silencioso.

## Arquitetura

```
Rafa (Skill, pura)
  → VideoRenderingPort (interface, src/application/ports/video-rendering.port.ts)
    → FfmpegVideoRenderingAdapter (src/infrastructure/video-rendering/)
      → FFmpeg local (binário do pacote ffmpeg-static, spawn sem shell)
      → arquivo MP4 real em artifacts/<executionId>/videos/final-video.mp4
```

Rafa **nunca** importa `src/infrastructure/`, `node:child_process`, `ffmpeg-static` ou qualquer detalhe de FFmpeg — só conhece a interface `VideoRenderingPort`. Isso é verificado automaticamente por testes de isolamento (`tests/rafa-video-rendering.test.mjs`), no mesmo padrão que já protegia Rafa contra acoplamento com providers de IA.

### `VideoRenderingPort`

Duas operações, `src/application/ports/video-rendering.port.ts`:

- `resolveAssets(candidates)`: verifica quais assets locais (logo, imagens de fundo, trilha, efeitos sonoros) **realmente existem e são válidos** no disco — nunca busca, baixa ou infere um arquivo, apenas valida caminhos já fornecidos explicitamente.
- `render(request)`: recebe um `VideoRenderRequest` já totalmente resolvido (cenas, overlays de texto, assets com caminho absoluto validado, trilhas de áudio) e devolve um `VideoRenderResult` com caminho do arquivo, duração, resolução, proporção, fps, codec de vídeo/áudio, se há áudio, tamanho, tempo de renderização, logs resumidos e warnings.

### `FfmpegVideoRenderingAdapter` (`src/infrastructure/video-rendering/`)

| Arquivo | Responsabilidade |
|---|---|
| `ffmpeg-binary.ts` | Resolve o caminho do binário do FFmpeg **sem nunca ler variável de ambiente** (ver seção de segurança abaixo). |
| `ffmpeg-process-runner.ts` | Executa o FFmpeg via `spawn` (nunca `exec`/`execSync`), `shell: false` explícito, argumentos em array, timeout, captura e trunca stderr. |
| `asset-resolver.ts` | Valida candidatos a asset: caminho absoluto obrigatório, sem `..`, `fs.realpath` (neutraliza symlink), extensão numa allowlist fechada por tipo, tamanho máximo plausível. |
| `timeline-to-filter-compiler.ts` | Função pura: `VideoRenderRequest` → array de argumentos do FFmpeg (grafo de filtros `filter_complex`). Testável sem nunca executar nada. |
| `ffmpeg-capabilities.ts` | Detecta, uma vez por processo, se o binário suporta o filtro `gradients` (fallback para fundo sólido quando não suporta) e resolve fontes TrueType reais no disco para o `drawtext`. |
| `ffmpeg-video-rendering-adapter.ts` | Implementa `VideoRenderingPort`: orquestra os módulos acima, escreve arquivos temporários de texto (um `.txt` por overlay, evitando qualquer escaping de caracteres especiais do FFmpeg), roda o FFmpeg, lê o tamanho do arquivo final e monta o `VideoRenderResult`. |

## Como o FFmpeg é invocado com segurança

1. **Nunca `shell: true`.** `child_process.spawn(binaryPath, args, { shell: false, windowsHide: true })` — `shell: false` é o padrão do Node, mas fica explícito no código e é verificado por teste dedicado (`tests/ffmpeg-video-rendering-adapter.test.mjs`).
2. **Argumentos sempre em array**, nunca concatenados numa string de comando — elimina qualquer classe de injeção de shell, mesmo que um valor inesperado chegasse a um argumento (o pior caso vira "um argumento estranho para o FFmpeg", nunca "um comando extra executado pelo sistema").
3. **O binário nunca vem de variável de ambiente.** Achado de segurança real desta implementação: o pacote `ffmpeg-static` lê `process.env.FFMPEG_BIN` no seu próprio `index.js` e devolve essa variável, se definida, como o caminho do binário — ou seja, um simples `import ffmpegPath from "ffmpeg-static"` permitiria que qualquer variável de ambiente substituísse o binário real por um executável arbitrário. `ffmpeg-binary.ts` evita isso completamente: nunca importa o módulo principal do pacote, só resolve a pasta onde ele foi instalado (via `require.resolve("ffmpeg-static/package.json")`, insensível a `FFMPEG_BIN`) e monta o nome do executável a partir de `os.platform()` real (não de `process.env.npm_config_platform`, que o pacote também usa e que também poderia ser adulterada).
4. **Nenhum comando ou argumento vem de variável de ambiente.** A única variável de ambiente relacionada a este recurso é `ZUNO_VIDEO_RENDER_MODE`, validada contra uma allowlist estrita de dois valores fixos (`local_render`/`developer_assisted` — nunca um caminho, comando ou argumento) e usada só para permitir que os testes automatizados validem os dois modos de ponta a ponta; qualquer valor fora da allowlist é ignorado.
5. **Caminhos de saída** (`artifacts/<executionId>/videos/final-video.mp4`) são resolvidos com a mesma defesa contra path traversal que `LocalArtifactDelivery` já usa (`resolveArtifactPath`, reaproveitada, não duplicada): segmento de execução sanitizado, `..` e caminho absoluto rejeitados, resultado obrigatoriamente contido dentro da raiz de artefatos.
6. **Caminhos de asset de entrada** (logo, imagens locais, trilha, efeitos sonoros) exigem caminho absoluto, são resolvidos via `fs.realpath` (neutraliza truques de symlink), validados contra uma allowlist de extensão por tipo (`.png/.jpg/.jpeg` para imagem; `.mp3/.wav/.m4a/.aac` para áudio) e um tamanho máximo plausível — nunca aceitos sem essa validação prévia.
7. **Timeout de renderização** (padrão 120s, configurável) mata o processo (`SIGKILL`) se o FFmpeg não terminar a tempo, evitando que uma renderização travada prenda o workflow indefinidamente.

## Como a timeline vira filtros/comandos

Cada cena de `editingTimeline` (Diego) vira um trecho independente do grafo de filtros do FFmpeg, depois encadeado com os vizinhos via `xfade` (mesmo para "corte seco" — um crossfade de ~1ms, indistinguível de um corte, unifica o código em um único caminho em vez de dois):

1. **Fundo**: `color` (sólido) ou `gradients` (gradiente, se o binário suportar — testado uma vez por processo, com fallback automático para sólido) via fonte `lavfi`, ou uma imagem local (`-loop 1 -i <path>`) escalada/cortada para preencher exatamente a resolução alvo.
2. **Zoom/Pan**: filtro `zoompan`, com uma pegadinha real de FFmpeg verificada empiricamente durante esta implementação — `zoompan` encadeado direto sobre uma fonte `color`/`gradients` (que já produz muitos frames) funciona corretamente sem nenhum truque adicional nesta versão do FFmpeg (`ffmpeg-static` 6.1.1); isso foi confirmado extraindo frames reais do início/fim de clipes de teste antes de considerar a implementação concluída, não apenas assumido.
3. **Texto**: `drawtext`, lendo de um arquivo `.txt` temporário (não de uma string inline) — evita qualquer escaping de caracteres especiais do texto do usuário. Achado real desta implementação: sem `expansion=none`, o FFmpeg tenta interpretar `%` no texto como início de uma sequência de variável (`"100% dos noivos"` quebrava o parser e o texto inteiro desaparecia silenciosamente, sem erro fatal) — `expansion=none` trata `%`/`\` sempre como caracteres literais.
4. **Logo**: `overlay`, com a imagem redimensionada uma única vez (reaproveitada por todas as cenas que a usam) e alfa preservado (`format=rgba`).
5. **Transições**: `xfade` encadeado, com o `offset` de cada crossfade calculado a partir da duração acumulada da cadeia (fórmula padrão da comunidade FFmpeg para múltiplas cenas).
6. **Áudio**: cada trilha/efeito vira um input adicional, com `volume`/`adelay` aplicados e, quando há mais de uma trilha, misturados via `amix`. Sem nenhuma trilha resolvida, a saída é `-an` (explicitamente sem áudio) — nunca um `-c:a aac` vazio ou quebrado.

## Como assets são resolvidos

`brollSuggestions`, `musicSuggestions` e `requiredAssets` do plano de Bruno/Diego são **sempre texto livre** ("Imagens de apoio que ilustrem: ...", "Arquivo de trilha sonora definida no plano..."), nunca caminho de arquivo. Rafa não trata texto livre como path. O que mudou é que Vanessa agora descreve um `visualAssetRequirement` por cena e Diego preserva esse requisito na timeline. Rafa transforma esses requisitos em consultas para `VisualAssetResolverPort`, que procura assets reais por tags/tema/emoção/proporção, registra origem/licença e devolve a imagem escolhida ou um pacote de criação assistida.

Assets reais possíveis:

- **Logo**: `IdentityContext.logoUri` da Clara (já consultada por Rafa para outros fins) — sempre **opcional**; ausente ou não resolvida, a renderização segue sem logo, só com um aviso (mesmo padrão que Bianca já usa para imagens estáticas).
- **Imagem por cena resolvida automaticamente**: `VisualAssetResolverPort` consulta `assets/visual/library`, `assets/visual/free/manifest.json` e, quando necessário, Developer Assisted Mode (`artifacts/<executionId>/visual-assets/scene-XX.png`). Nenhuma imagem é usada sem origem/licença no relatório de assets.
- **Imagem de fundo por cena / trilha / efeito sonoro por cena explícitos**: `RafaVideoRenderingRequestInput.localAssets` (`backgroundImagePathBySceneOrder`, `musicTrackPath`, `soundEffectPathBySceneOrder`) ainda existe para override/manual. Diferente da logo, cada entrada aqui é tratada como **obrigatória**: se referenciada e não resolver para um arquivo real, a renderização local é cancelada.
- **Música local**: `--music "assets/audio/music/minha-musica.mp3"` preenche `localAssets.musicTrackPath`, aplica fade-in/fade-out, ajusta volume, corta/repete conforme a duração e exporta AAC no MP4.

Detalhes do resolver, pontuação, manifesto e relatório em `docs/visual-asset-resolver.md`.

## Como funciona o fallback assistido

`videoRendering` é uma dependência **opcional** de Rafa, no mesmo padrão que `artifactDelivery` já é — quando ausente, Rafa se comporta exatamente como antes desta mudança (100% Developer Assisted Mode, nenhuma linha de código antiga alterada nesse caminho). Quando presente:

1. Rafa monta consultas visuais por cena a partir da timeline de Diego e do briefing de Vanessa, então chama `VisualAssetResolverPort`.
2. Se algum asset visual estiver pendente, Rafa devolve `needs_assisted_generation` com `pendingVisualAssets`, sem chamar FFmpeg e sem usar placeholder.
3. Rafa monta a lista de candidatos explícitos (logo da Clara + qualquer `localAssets`) e chama `VideoRenderingPort.resolveAssets`.
4. Se algum asset **explicitamente pedido** (`localAssets`) não resolver, a renderização local é cancelada **antes** de chamar o FFmpeg, com um log (`LocalRenderingSkipped`) e um aviso citando exatamente qual arquivo faltou — e o workflow cai para `runAssistedGeneration`, o mesmo método já existente e testado, inalterado.
5. Caso contrário, Rafa monta o `VideoRenderRequest` a partir da `editingTimeline` real (nunca inventa cena) e chama `render`. Se a chamada falhar por qualquer motivo (erro do FFmpeg, timeout, etc.), o erro é capturado, logado (`LocalRenderingFailed`) e o workflow também cai para o modo assistido — nunca propaga uma falha dura para o usuário quando ainda há um caminho manual disponível.
6. Em caso de sucesso, o arquivo é **relido** pela mesma `ArtifactDeliveryPort` e validado pela mesma função `validateMp4Bytes` que o modo assistido já usa (nunca confia cegamente no retorno do adaptador) — só então o artefato é registrado, com `generationMode: "local_render"`.

## Formatos suportados

A resolução/proporção vem da autoridade única já usada por Sofia/Pedro/Bianca para imagens (`resolveAspectRatio`/`resolutionForAspectRatio`, `src/shared/utils/aspect-ratio.ts`) — Rafa deixou de ter 1080x1920 fixo:

| Formato | Proporção | Resolução |
|---|---|---|
| Reels / Stories / TikTok / Shorts | 9:16 | 1080x1920 |
| Feed vertical (post único, sem palavra-chave de formato) | 4:5 | 1080x1350 |
| Feed quadrado | 1:1 | 1080x1080 |

## Limitações atuais

- Cobre motion graphics com imagens estáticas reais por cena — nenhuma filmagem real, nenhuma geração de vídeo por IA.
- A busca externa real (Pexels/Pixabay/Unsplash) ainda não existe; o provedor gratuito atual é por manifesto local.
- `localAssets` continua sem flag genérica `--asset`; a única entrada manual suportada pela CLI é `--music`.
- Sem transcrição/geração de fala (narração) — só texto na tela e legendas visuais.
- `zoompan`/`xfade` cobrem um vocabulário fechado e pequeno de efeitos (zoom in/out, pan esquerda/direita, corte/fade) — não um editor de vídeo genérico.
- O relatório de renderização (`renderLogsSummary`) traz só as últimas linhas de log do FFmpeg, não o log completo.

## Próximos passos recomendados

1. Integrar um provider real por porta para Pexels/Pixabay/Unsplash, mantendo registro de licença.
2. Adicionar uma flag na CLI (`--asset logo=...`, `--asset bg:2=...` ou similar) para overrides manuais sem editar código.
3. Se algum dia fizer sentido narração/fala, isso exigiria um pipeline de texto-para-fala — deliberadamente fora do escopo desta versão.
4. Ampliar o vocabulário de transições/zoom conforme feedback real de uso, mantendo sempre um vocabulário fechado (nunca aceitar uma expressão de filtro arbitrária vinda de texto livre).
