# Suporte a música local manual — relatório técnico

Adiciona suporte simples para fornecer manualmente uma música local à pipeline de vídeo do Zuno,
via `--music`. Nenhuma Skill nova, nenhuma mudança de arquitetura, nenhuma API externa — apenas
uma pasta padrão, um validador, e o encanamento até Rafa (que já sabia inserir áudio real via
FFmpeg desde a evolução cinematográfica anterior).

## Como fornecer a música

1. Coloque o arquivo em `assets/audio/music/` (formatos aceitos: `.mp3`, `.wav`, `.m4a`, `.aac`).
2. Informe o caminho na CLI:

```
npm run zuno -- --music "assets/audio/music/minha-musica.mp3" "Crie um Reels..."
```

Também funciona ao retomar uma execução já em andamento, desde que a etapa de renderização de
vídeo (Rafa) ainda não tenha sido concluída:

```
npm run zuno -- --continue <executionId> --music "assets/audio/music/minha-musica.mp3"
```

Se nenhuma música for informada, o comportamento é exatamente o de antes: vídeo renderizado sem
áudio, com um aviso explícito registrado (`"Nenhuma música local informada..."`).

## Arquivos alterados/criados

- `src/shared/utils/local-music-asset.ts` **(novo)** — `validateLocalMusicPath`: existência,
  extensão (`.mp3/.wav/.m4a/.aac`), bloqueio de path traversal (`..`) e de URL (`file://`,
  `http://` etc.). Validação antecipada na CLI; o resolver de assets em
  `src/infrastructure/video-rendering/asset-resolver.ts` (já existente) continua sendo a validação
  final e autoritativa antes da renderização.
- `assets/audio/music/README.md` **(novo)** — pasta padrão pedida, com instruções de uso.
- `src/interfaces/cli/index.ts` — parsing de `--music` (early, junto de `--mode`), validação,
  mensagens de uso, e passagem para `runZunoCommand`/`continueZunoExecution`.
- `src/interfaces/cli/run-command.ts` — `RunZunoCommandOptions.musicFilePath` (repassado a
  `arthur.planFromText`); `ContinueZunoExecutionOptions.musicFilePath` (repassado a
  `caio.applyLocalMusicAsset`, com aviso no console quando não pôde ser aplicado).
- `src/application/orchestration/arthur.types.ts` / `arthur.contract.ts` / `arthur.orchestrator.ts`
  — `musicFilePath` flui de `planFromText` até a etapa "Renderização de vídeo", onde é embutido
  como `input.localAssets.musicTrackPath` (o mesmo campo que Rafa já sabia consumir).
- `src/application/workflows/caio.contract.ts` / `caio.executor.ts` — novo método
  `applyLocalMusicAsset(executionId, musicTrackPath)`: injeta a música na etapa de renderização de
  vídeo ainda pendente de uma execução já criada (caso de `--continue --music`); recusa
  (`applied: false`, com motivo) se a etapa já foi concluída ou não existe no plano.
- `src/infrastructure/video-rendering/timeline-to-filter-compiler.ts` — `-stream_loop -1` aplicado
  somente à trilha (`role: "music"`, nunca a efeitos sonoros pontuais) antes do seu `-i`; combinado
  com o `-t <duração total>` já existente no output, isso cobre loop (música mais curta) e corte
  (música mais longa) sem precisar sondar a duração real do arquivo antecipadamente.
- `src/skills/rafa-video-rendering/rafa-video-rendering.types.ts` — `RafaVideoRenderingOutput`
  ganhou `audioApplied` (sempre presente), `musicSource`, `musicFilename`, `audioCodec`,
  `audioDuration` (opcionais, só preenchidos quando aplicados).
- `src/skills/rafa-video-rendering/rafa-video-rendering.skill.ts` — `buildRenderPlan` agora também
  devolve um resumo de áudio; `attemptLocalRendering` registra o aviso claro quando nenhuma música
  foi informada; `finalizeRendering` preenche os novos campos do output.
- `src/interfaces/cli/final-delivery-page.ts` — `extractAudioSummary` lê os campos acima do output
  de Rafa (por nome, sem importar tipo de Skill) e adiciona um bloco `audio` opcional tanto em
  `metadata.json` quanto em `execution-report.json`.
- `package.json` — `assets/audio/music/` documentada; dois novos arquivos de teste adicionados ao
  script `test`.

## Validações executadas

- `npm run typecheck` — sem erros.
- `npm run test` — **661/661 testes passando** (0 falhas), incluindo:
  - `tests/local-music-asset.test.mjs` **(novo, 16 testes)** — validador (mp3 válido, wav válido,
    caminho relativo, arquivo inexistente, extensão inválida, path traversal, URL/`file://`,
    caminho vazio) + Arthur (embute/não embute `localAssets.musicTrackPath`) + Caio real
    (`applyLocalMusicAsset`: aplica em etapa pendente, faz merge sem sobrescrever outros campos de
    `localAssets`, recusa quando já concluída, recusa quando não há etapa de vídeo, lança erro para
    execução inexistente).
  - `tests/ffmpeg-video-rendering-adapter.test.mjs` **(6 testes novos)** — stream H.264+AAC
    confirmado por inspeção independente do arquivo real (não só pelo valor devolvido pelo próprio
    adaptador); música mais curta que o vídeo cobre a duração inteira via loop; música mais longa é
    cortada sem estender a duração final; `-stream_loop -1` presente só para `role: "music"`, nunca
    para `sound_effect`; `afade=t=in`/`afade=t=out` presentes no filtro quando configurados.
  - `tests/rafa-video-rendering.test.mjs` **(2 testes novos)** — `audioApplied`/`musicSource`/
    `musicFilename`/`audioCodec`/`audioDuration` preenchidos quando a música resolve; aviso claro e
    `audioApplied: false` quando nenhuma música é informada.
- `npm run architecture:check` — 12 Skills descobertas, todas READY, nenhuma capability órfã.

## Validação real (não simulada)

Gerado um arquivo de áudio real (tom senoidal de 20s, WAV válido e reproduzível — não silêncio, não
placeholder) em `assets/audio/music/validation-track.wav`, deliberadamente mais curto que o vídeo
de 30s para também validar o loop.

```
npm run zuno -- --mode local-production --music "assets/audio/music/validation-track.wav" "Crie um Reels de 30 segundos sobre confirmação de presença RSVP para o Rumo ao Altar."
npm run zuno -- --approve workflow-execution-mrinp61o-klsiiw
```

Vídeo final: `artifacts/workflow-execution-mrinp61o-klsiiw/videos/final-video.mp4` (21.058.136
bytes). Inspecionado com o próprio binário do FFmpeg (`ffmpeg -hide_banner -i <arquivo>`, já que o
projeto não empacota `ffprobe`):

```
Duration: 00:00:30.00
Stream #0:0: Video: h264 (High), yuv420p, 1080x1920 [SAR 1:1 DAR 9:16], 30 fps
Stream #0:1: Audio: aac (LC), 44100 Hz, stereo, 126 kb/s
```

H.264 + AAC confirmados de forma independente (não apenas pelo valor que o próprio código
devolve). Duração do container: exatamente 30s — a música de 20s foi repetida em loop até cobrir
o vídeo inteiro, sem cortar o vídeo nem deixar silêncio no final.

`metadata.json` e `execution-report.json` (bloco `audio`, idêntico em ambos):

```json
{
  "audioApplied": true,
  "musicSource": "C:\\Users\\Cleverton\\Desktop\\Zuno\\assets\\audio\\music\\validation-track.wav",
  "musicFilename": "validation-track.wav",
  "audioCodec": "AAC",
  "audioDuration": 30
}
```

Repetido sem `--music` (`workflow-execution-mrinr2pf-u552qz`): vídeo final sem stream de áudio
algum (confirmado pela mesma inspeção), `audioApplied: false`, e o aviso registrado literalmente:

> "Nenhuma música local informada (use --music "\<caminho\>" para incluir uma trilha sonora);
> vídeo renderizado sem áudio."

## Limitações restantes

- **`--continue --music` foi validado com testes reais contra a classe `CaioWorkflowExecutor`
  (não mockada)**, cobrindo aplicação, merge e as duas recusas — mas não com uma execução completa
  via subprocesso da CLI passando por uma pausa real de `WAITING_ASSISTED_GENERATION`/
  `WAITING_DEVELOPER_AI` antes de Rafa. O mecanismo é idêntico em ambos os casos (mutação do mesmo
  `planSnapshot.steps[].input` antes da etapa reexecutar), mas uma demonstração ponta-a-ponta por
  subprocesso não foi feita nesta rodada, por custo de tempo.
- Só a **trilha principal** (`role: "music"`) entra em loop automático; efeitos sonoros pontuais
  (`sound_effect`, já existentes desde a evolução cinematográfica anterior) continuam exigindo um
  caminho próprio (`localAssets.soundEffectPathBySceneOrder`) — `--music` cobre exclusivamente a
  trilha, como pedido.
- Nenhuma biblioteca/seleção automática de música foi criada (fora do escopo desta tarefa,
  deliberadamente) — o usuário sempre aponta o arquivo explicitamente.
- `mixagem` continua simples (`volume` + `afade` + ducking automático já existente) — sem
  normalização de loudness (LUFS) nem equalização.
