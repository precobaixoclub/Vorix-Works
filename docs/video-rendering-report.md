# Relatório técnico — Renderização automática local de vídeo (FFmpeg + VideoRenderingPort)

Este relatório documenta a implementação da renderização automática local de vídeo no Zuno v1.1: uma nova porta de aplicação (`VideoRenderingPort`) e um adaptador de infraestrutura (`FfmpegVideoRenderingAdapter`) que transformam o plano técnico de edição de Diego em um MP4 real, usando FFmpeg local via `child_process.spawn` — nunca uma API externa, nunca dentro da Skill Rafa. A decisão de usar FFmpeg (em vez de Remotion, MoviePy ou OpenCV) já estava documentada em `docs/video-rendering-tooling-analysis.md`; este relatório cobre a implementação em si.

## Arquitetura adotada

```
Rafa (Skill, pura — só conhece a interface)
  → VideoRenderingPort            src/application/ports/video-rendering.port.ts
    → FfmpegVideoRenderingAdapter src/infrastructure/video-rendering/
      → FFmpeg local (spawn, sem shell)
      → artifacts/<executionId>/videos/final-video.mp4
```

Rafa nunca importa `src/infrastructure/`, `node:child_process`, `ffmpeg-static` ou qualquer detalhe de FFmpeg. Isso é verificado automaticamente por testes de isolamento (novos e antigos, todos passando).

## Arquivos criados

| Arquivo | Responsabilidade |
|---|---|
| `src/application/ports/video-rendering.port.ts` | Interface `VideoRenderingPort` (`resolveAssets`, `render`) e todos os tipos de domínio da porta (`VideoRenderRequest`, `VideoRenderScene`, `VideoRenderResult`, `VideoAssetCandidate`, `VideoAssetResolution` etc.). |
| `src/infrastructure/video-rendering/ffmpeg-binary.ts` | Resolve o caminho do binário do FFmpeg **sem nunca ler variável de ambiente** — achado de segurança real (ver seção dedicada abaixo). |
| `src/infrastructure/video-rendering/ffmpeg-process-runner.ts` | Executa o FFmpeg via `spawn` (`shell: false` explícito), array de argumentos, timeout, captura/trunca stderr. |
| `src/infrastructure/video-rendering/ffmpeg-capabilities.ts` | Probe único por processo do suporte ao filtro `gradients`; resolução de fontes TrueType reais no disco. |
| `src/infrastructure/video-rendering/asset-resolver.ts` | Valida candidatos a asset local: caminho absoluto, sem `..`, `fs.realpath`, extensão numa allowlist por tipo, tamanho máximo plausível. |
| `src/infrastructure/video-rendering/timeline-to-filter-compiler.ts` | Função pura: `VideoRenderRequest` → array de argumentos do FFmpeg (grafo `filter_complex`). Inclui `wrapOverlayText` (quebra de linha) e `escapeFfmpegPath`. |
| `src/infrastructure/video-rendering/ffmpeg-video-rendering-adapter.ts` | Implementa `VideoRenderingPort`, orquestra os módulos acima. |
| `src/infrastructure/video-rendering/index.ts` | Barrel export. |
| `tests/ffmpeg-video-rendering-adapter.test.mjs` | 15 testes — adapter, segurança, compilador (ver seção de testes). |
| `docs/video-rendering.md` | Documentação de arquitetura/uso/segurança/limitações da renderização local. |
| `docs/video-rendering-tooling-analysis.md` | Análise técnica que fundamentou a escolha do FFmpeg (produzida antes da implementação, nesta mesma sessão). |
| `docs/video-rendering-report.md` | Este relatório. |

## Arquivos alterados

| Arquivo | Mudança |
|---|---|
| `src/infrastructure/artifacts/local-artifact-delivery.ts` | `normalizeRelativePath`/`sanitizePathSegment` exportadas e extraída `resolveArtifactPath(rootDir, executionId, relativePath)` — reaproveitada pelo novo adaptador para resolver `artifacts/<executionId>/videos/final-video.mp4` com a mesma defesa contra path traversal, sem duplicar a lógica. Comportamento da classe `LocalArtifactDelivery` inalterado. |
| `src/skills/rafa-video-rendering/rafa-video-rendering.types.ts` | Novo `RafaLocalAssetsInput` (`backgroundImagePathBySceneOrder`, `musicTrackPath`, `soundEffectPathBySceneOrder`); `RafaVideoRenderingRequestInput.localAssets?`; `RafaVideoSpecs.audioCodec`/`hasAudio` opcionais; `RafaVideoRenderingOutput.generationMode` ampliado para `"developer_assisted" \| "local_render"`; novos `renderTimeMs?`/`renderLogsSummary?`. |
| `src/skills/rafa-video-rendering/rafa-video-rendering.skill.ts` | `videoRendering?: VideoRenderingPort` como dependência opcional (mesmo padrão de `artifactDelivery?`); `buildVideoSpecs` passou a usar `resolveAspectRatio`/`resolutionForAspectRatio` (9:16/4:5/1:1, em vez de 1080x1920 fixo); novo método `attemptLocalRendering` (resolve assets, monta cenas a partir da `editingTimeline` real de Diego, chama a porta, valida o resultado, finaliza ou cai para o modo assistido); `finalizeRendering` generalizado para aceitar `generationMode`/`renderTimeMs`/`renderLogsSummary`; novas funções puras `buildAssetCandidates`, `buildRenderPlan`, `buildProceduralBackground`, `classifyTransition`. Nenhuma linha do caminho `runAssistedGeneration`/`finalizeRendering` (chamada original) foi removida — só passou a receber `generationMode: "developer_assisted"` explicitamente. |
| `src/skills/rafa-video-rendering/rafa-log.contract.ts` | Três novas ações de log: `LocalRenderingSkipped`, `LocalRenderingFailed`, `LocalRenderingCompleted`. |
| `src/interfaces/cli/run-command.ts` | `FfmpegVideoRenderingAdapter` wired em `runtimeDependencies.videoRendering`, condicionado a `resolveVideoRenderingMode()` (nova função — allowlist estrita de `ZUNO_VIDEO_RENDER_MODE`, padrão `local_render`). |
| `package.json` | `"ffmpeg-static": "^5.3.0"` em `dependencies`; `tests/ffmpeg-video-rendering-adapter.test.mjs` adicionado ao script `test`. |
| `tests/rafa-video-rendering.test.mjs` | +8 testes novos (local render, fallback, logo, formatos); `FakeVideoRendering` test double; `createRafa` aceita `videoRendering`. Nenhum teste existente alterado além do necessário para os novos parâmetros de `buildVideoSpecs`. |
| `tests/cli.smoke.test.mjs` | Teste de vídeo original passou a forçar `ZUNO_VIDEO_RENDER_MODE=developer_assisted` (preserva a cobertura do fluxo assistido); novo teste cobre o caminho padrão (renderização local automática, incluindo publicação via Ana). |
| `docs/rafa-video-rendering.md`, `docs/diego-video-editing.md`, `docs/architecture.md`, `README.md`, `src/interfaces/cli/README.md` | Atualizados para refletir os dois modos de Rafa (ver `docs/video-rendering.md` para os detalhes completos). |
| `.zuno-data/knowledge.json` (local, gitignored) | `logoUri` real adicionado ao `IdentityContext` do cliente de demonstração, para a validação real desta sessão exercitar o caminho completo (logo real composta no vídeo). Não é código versionado. |

## Como o FFmpeg é invocado com segurança

1. **`shell: false` explícito** em `child_process.spawn` — nunca `exec`/`execSync`. Verificado por teste dedicado que lê o código-fonte do runner.
2. **Argumentos sempre em array**, nunca concatenados — elimina injeção de shell mesmo no pior caso.
3. **O binário nunca vem de variável de ambiente — achado de segurança real desta implementação.** O pacote `ffmpeg-static` lê `process.env.FFMPEG_BIN` no próprio `index.js` e devolve essa variável, se definida, como o caminho do binário. Um `import ffmpegPath from "ffmpeg-static"` ingênuo teria permitido que qualquer variável de ambiente substituísse o binário real por um executável arbitrário — exatamente o risco que o pedido pediu para nunca aceitar. `ffmpeg-binary.ts` resolve o binário sem nunca importar o módulo principal do pacote: usa `require.resolve("ffmpeg-static/package.json")` (insensível a `FFMPEG_BIN`) para achar a pasta de instalação, e `os.platform()` real (não `process.env.npm_config_platform`, que o pacote também usa) para montar o nome do executável.
4. **A única variável de ambiente do recurso, `ZUNO_VIDEO_RENDER_MODE`, é uma allowlist estrita de dois valores fixos** (`local_render`/`developer_assisted`) — nunca um caminho, comando ou argumento; qualquer valor fora da lista é ignorado. Existe só para permitir que os testes automatizados validem os dois modos de ponta a ponta pela CLI.
5. **Caminhos de saída** reaproveitam a defesa contra path traversal que `LocalArtifactDelivery` já tinha (`resolveArtifactPath`, extraída e reutilizada, não duplicada).
6. **Caminhos de asset de entrada** (logo, imagens, trilha, efeitos sonoros) exigem caminho absoluto, passam por `fs.realpath` (neutraliza symlink), allowlist de extensão por tipo e tamanho máximo — nunca aceitos sem essa validação.
7. **Timeout de renderização** (120s padrão) mata o processo (`SIGKILL`) se travar.

## Como a timeline vira filtros/comandos

Cada cena de `editingTimeline` (Diego) vira um trecho de `filter_complex`: fundo (`color`/`gradients`/imagem local) → zoom/pan (`zoompan`, com correção de comportamento verificada empiricamente — ver "Achados durante a implementação") → texto (`drawtext`, lendo de arquivo `.txt` temporário, nunca inline) → logo (`overlay`, redimensionada uma vez e reaproveitada). As cenas são encadeadas com `xfade` (mesmo "corte seco" — crossfade de ~1ms, unificando o código em um único caminho), com `offset` calculado pela duração acumulada da cadeia. Áudio (quando há trilha/efeito resolvido) é misturado via `amix`/`adelay`/`volume`; sem nenhum resolvido, a saída é `-an` explícito.

## Como assets são resolvidos

`brollSuggestions`/`musicSuggestions`/`requiredAssets` de Bruno/Diego são **sempre texto livre** — nunca tratados como caminho de arquivo. Os únicos assets reais possíveis: **logo** (`IdentityContext.logoUri` da Clara, sempre opcional — ausência só gera aviso) e, via o novo campo explícito `RafaVideoRenderingRequestInput.localAssets`, imagem de fundo/trilha/efeito sonoro por cena (sempre obrigatórios quando referenciados — ausência cancela a renderização local e cai para o modo assistido, citando exatamente o arquivo que faltou). Nenhum fluxo de busca, download ou inferência automática de asset foi implementado — condição explícita do pedido.

## Como funciona o fallback assistido

`videoRendering` é dependência **opcional** de Rafa (mesmo padrão de `artifactDelivery`). Ausente, Rafa se comporta exatamente como antes (Developer Assisted Mode puro, código antigo intocado — os 19 testes originais de `rafa-video-rendering.test.mjs` continuam passando sem nenhuma alteração de comportamento). Presente, Rafa tenta renderizar localmente primeiro; cai para o modo assistido (reusando `runAssistedGeneration`, sem duplicar lógica) quando: (a) um asset explicitamente pedido não resolve, ou (b) a chamada a `render()` falha por qualquer motivo. Em ambos os casos de queda, o motivo exato vira log (`LocalRenderingSkipped`/`LocalRenderingFailed`) e é anexado aos `warnings` da resposta.

## Achados durante a implementação (não óbvios, verificados empiricamente)

1. **`zoompan` funciona corretamente sobre fontes `lavfi` multi-frame nesta versão do FFmpeg** (`ffmpeg-static` 6.1.1) — investiguei uma pegadinha clássica da comunidade FFmpeg (zoompan "preso" no primeiro frame quando encadeado sobre uma fonte com múltiplos frames) e, após extrair frames reais via `-ss` em pontos diferentes de um clipe de teste, confirmei que o zoom progride normalmente sem precisar do truque `trim=start_frame=0:end_frame=1` frequentemente recomendado — evitei adicionar complexidade desnecessária.
2. **`drawtext` quebra silenciosamente com `%` no texto sem `expansion=none`.** `"100% dos noivos"` fazia o FFmpeg interpretar `%` como início de expansão de variável — o texto inteiro desaparecia da tela, sem erro fatal (só um aviso "Stray %" no log). Descoberto extraindo e inspecionando visualmente um frame real do primeiro protótipo, não apenas confiando no código de saída do processo.
3. **`ffmpeg-static` lê `FFMPEG_BIN` do ambiente e devolve esse valor como o caminho do binário** — risco de segurança real que só apareceu ao ler o código-fonte do pacote (não está documentado de forma destacada no README dele). Motivou o desenho de `ffmpeg-binary.ts` (ver seção de segurança).
4. **Texto longo (comum em `onScreenText`/`captionText` gerados por Bruno/Diego) ultrapassava a borda do quadro dos dois lados** — bug real encontrado durante a validação final desta sessão (não em teste unitário isolado, só visível inspecionando um frame do vídeo final gerado por um comando real). Corrigido com `wrapOverlayText` (quebra de linha heurística por largura estimada de glifo) + `text_align=center` no `drawtext`.

## Testes criados

`tests/ffmpeg-video-rendering-adapter.test.mjs` (15 testes, todos contra o binário real do FFmpeg, não mockado):
implementa `VideoRenderingPort`; MP4 real 1080x1920/30fps com assinatura `ftyp`; duração respeitada (soma das cenas); H.264+AAC com trilha resolvida e `-an` sem trilha; imagem local real usada como fundo; múltiplas cenas com transição sem erro; `resolveAssets` rejeita arquivo inexistente; bloqueia path traversal (relativo e `..`); rejeita extensão fora da allowlist; runner nunca usa `shell: true`; binário nunca lê `FFMPEG_BIN`/variáveis relacionadas (comportamental, com a env var setada de propósito no teste); `compileFfmpegArgs` só produz array de strings; `escapeFfmpegPath`; `wrapOverlayText` quebra texto longo e não quebra texto curto.

`tests/rafa-video-rendering.test.mjs` (+8 testes, 26 no total): Rafa não importa `infrastructure/video-rendering`; prefere renderização local sem pausar; traduz `onScreenText`/`captionText` em overlays `headline`/`cta` corretos; cai para modo assistido quando falta asset obrigatório de `localAssets`; cai para modo assistido quando a renderização falha; usa a logo da Clara quando resolvida; `buildVideoSpecs` resolve 9:16/4:5/1:1 via a autoridade de aspect ratio.

`tests/cli.smoke.test.mjs`: teste original do fluxo assistido preservado (agora com `ZUNO_VIDEO_RENDER_MODE=developer_assisted` explícito); novo teste cobre o caminho padrão — comando de vídeo vai direto para aprovação humana (sem `WAITING_ASSISTED_GENERATION`), o MP4 final é real (ftyp, tamanho > placeholder), `generationMode: "local_render"` no relatório, e — pedindo publicação explícita — Ana recebe o artefato de vídeo local-rendered e devolve `local_ready`, confirmando que a pipeline de imagem não sofreu regressão nenhuma (os outros testes de imagem no mesmo arquivo continuam passando) e que a pipeline de vídeo completa até Lucas/Ana.

## Resultado de typecheck, test e architecture:check

```
npm run typecheck        → limpo, sem erros
npm test                 → 525/525 (0 falhas), incluindo os 23 novos testes desta sessão
npm run architecture:check → 12 Skills descobertas, video_rendering → rafa-video-rendering OK
```

## Resultado da validação real pela CLI

Comando executado (client-rumo, com `logoUri` real configurado na Clara para esta validação):

```
npm run zuno -- --mode local-production "crie e publique um reels de 24 segundos para o Rumo ao Altar mostrando que os noivos recebem 100% do presente via Pix, sem taxas, com o site tudo em um único lugar" --client-id client-rumo
npm run zuno -- --mode local-production --approve <executionId>
```

- **Sem pausa assistida**: foi direto de `RUNNING` para `WAITING_HUMAN_APPROVAL` — a renderização local aconteceu automaticamente, sem nenhuma intervenção manual.
- **Vídeo real**: `videos/final-video.mp4`, 459KB, assinatura `ftyp` confirmada, 1080x1920 (9:16), 30fps, H.264 (libx264), sem áudio (nenhuma trilha real disponível — comportamento esperado e documentado).
- `generationMode: "local_render"`, `renderTimeMs: 14697`.
- Duração final: 30s — dentro da faixa pedida (15–30s), embora o texto do comando tenha pedido "24 segundos"; confirmado como limitação pré-existente e documentada (Bruno sempre fixa 30s internamente, campo não é encaminhado por um `inputBinding` que não existe — fora do escopo desta sessão corrigir).
- **Cores da marca**: fundo alterna gradiente branco→rosé (`#FFFFFF`→`#C97F91`) e cores sólidas (`#111111`, `#FFFFFF`) na ordem cadastrada na Clara — confirmado extraindo e inspecionando frames reais em 6 pontos diferentes do vídeo.
- **Textos animados**: `onScreenText`/`captionText` de cada cena aparecem com fade-in e, após a correção desta sessão, quebrados em múltiplas linhas centralizadas, nunca ultrapassando a borda do quadro.
- **Logo**: a logo real da marca (`rumo-ao-altar-mark.png`, PNG com transparência) aparece composta na cena final, canto inferior direito, cor preservada.
- **CTA**: cena final com "Conheça o Rumo ao Altar" em destaque.
- **Transições**: `xfade` entre as 5 cenas do roteiro, sem erro.
- **Sem provider externo**: nenhuma chamada de rede — só o binário local do FFmpeg.
- **Ana**: com publicação pedida explicitamente, recebeu o artefato de vídeo local-rendered e devolveu `overallStatus: "local_ready"`, confirmando que a integração com a etapa de publicação não sofreu regressão.

## Limitações atuais

- Cobre exclusivamente motion graphics — nenhuma filmagem real, nenhuma geração de vídeo por IA (por decisão explícita).
- Nenhum fluxo da CLI hoje preenche `localAssets` — o campo existe e é usado pelos testes/arquitetura, mas falta uma flag/UI para um operador humano indicar um asset real sem editar código (ver "Próximos passos").
- A duração explícita pedida em texto livre ("X segundos") não chega ao roteiro de Bruno — limitação pré-existente, documentada em `docs/video-rendering-tooling-analysis.md`, fora do escopo corrigir aqui (exigiria um `inputBinding` novo entre Eduardo e Bruno).
- Sem narração/fala — só texto na tela e legendas visuais.
- Vocabulário de transição/zoom/pan fechado e pequeno — não um editor de vídeo genérico.
- `renderLogsSummary` traz só as últimas ~40 linhas de log do FFmpeg, não o log completo.

## Próximos passos recomendados

1. Flag na CLI (`--asset logo=<path>`, `--asset bg:2=<path>` ou similar) para permitir que um operador humano informe `localAssets` reais sem editar código — hoje o mecanismo existe e é testado, mas nada na CLI o preenche.
2. Encaminhar `recommendedVideoDurationSeconds` do Eduardo para Bruno via `inputBinding` (bug pré-existente, não desta sessão) — resolveria a duração explícita em texto livre não ter efeito hoje.
3. Ampliar o vocabulário de transições/zoom conforme feedback real de uso, sempre mantendo um vocabulário fechado.
4. Considerar registrar no `CHANGELOG.md` a mudança de comportamento padrão (`LOCAL_PRODUCTION` agora prefere renderização local automática de vídeo) — não incluído nesta sessão por não estar na lista de documentação pedida.
