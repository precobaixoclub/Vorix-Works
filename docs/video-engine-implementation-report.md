# Motor de vídeo B (IA + FFmpeg) — relatório de implementação

Data: 2026-11-26. Tudo local, em commits separados por etapa; nada foi publicado em produção.
Detalhes da prova do executor em `docs/video-engine-b0-report.md`.

## 1. Funcionalidades implementadas

**Etapa 1 — executor FFmpeg (prova B0).** Plano de edição → MP4 nos formatos 9:16, 1:1 e 16:9:
cortes por trecho da fonte, transições (dissolve, push, zoom, dip), movimento de câmera suave,
enquadramento por formato (preencher com foco ou produto inteiro sobre fundo desfocado), títulos e
legendas com a fonte real (palavra falada destacada), logo, cartões de cor/gradiente, fala original,
narração, trilha com ducking e loudness −14 LUFS. Pasta isolada por job, limites, disco, timeout,
cancelamento, progresso real, cache de intermediários por workspace (com retenção).

**Etapa 2 — planejamento por IA.** Operação `video_edit_planning` no AI Gateway existente (créditos,
limites, circuit breaker, validação estrutural e semântica). A IA decide ordem, ritmo, movimento,
transições, textos, legendas, trilha e logo; trechos de fala são escolhidos por id de frase da
transcrição. Um construtor determinístico monta o plano (duração pedida, fala→fala em corte, estilo
da marca, legendas da transcrição com glossário). Correção automática (no máximo 2 chamadas) e
revisão por conversa com escopo (só muda o que o pedido permite).

**Etapa 3 — integração ao Marketing.**
- Banco: `video_projects` e `video_versions` (migration `0209`), fila nas próprias versões
  (lease, heartbeat, retentativa, recuperação de worker morto, um render por vez no ambiente).
- API (`/v1/video-projects`, `/v1/video-versions`), protegida pela solução Marketing, RBAC
  (`asset:read/update`, `publication:create` para aprovar), workspace do tenant, materiais só do
  próprio workspace, limites por cliente (2 ativos, 20/dia, 12 materiais, 4 vídeos).
- Feature flag por workspace: `VIDEO_ENGINE_WORKSPACES` (rollback = apagar a variável).
- Worker `video-worker` (processo separado, imagem própria com FFmpeg vetado de produção e o mesmo
  faster-whisper do Meetings), serviço no compose com perfil `video` (não sobe sem ativação),
  2 vCPU / 2 GiB / prioridade baixa. Transcrição em cache no projeto; marca do Perfil da Marca.
- Tela: Marketing › Criar conteúdo › **Criar vídeo com IA** (só aparece com a flag): editar vídeo
  ou criar com imagens, upload e Biblioteca, pedido, formato, duração, estilo, transições,
  legendas; acompanhamento com progresso real e cancelamento; player; resultado do Quality Gate;
  alteração por conversa; histórico de versões; aprovar; baixar MP4; **Publicar ou agendar** abre o
  compositor existente — a regra de aprovação pelo WhatsApp da marca vale antes de qualquer post.
- Controles sem implementação real não aparecem: trilha só com biblioteca licenciada instalada;
  narração (voz sintética) não é oferecida.

## 2. MP4s reais (locais, fora do git: `artifacts/video-b0/`)

| Arquivo | O que prova |
|---|---|
| `out/cmkv-9x16.mp4`, `out/cmkv-1x1.mp4`, `out/cmkv-16x9.mp4` | anúncio com fotos reais da CMKV nos 3 formatos |
| `out/reels-raa-9x16.mp4` | gravação bruta de 82 s → Reels de 31 s com legendas da fala |
| `out/demo-raa-16x9.mp4` | demo com capturas reais + narração e legendas |
| `b2/cmkv-manual.mp4`, `b2/reels-manual.mp4` | pedido em linguagem natural → plano pelo construtor → MP4 (20 s e 30 s pedidos → 19,9 s e 29,7 s) |

Cada um tem plano, relatório e folha de contato ao lado. Todos aprovados no Quality Gate e
revisados visualmente (defeitos encontrados e corrigidos listados no relatório da B0).

## 3. Testes

| Suíte | Resultado |
|---|---|
| `tests/video-ffmpeg-engine.test.mjs` (contrato, texto/ASS, compilador, transcrição, executor com render real, cache, cancelamento, limites) | 15/15 |
| `tests/video-planning.test.mjs` (operação no gateway, validação semântica, construtor, reparo, revisão com escopo) | 10/10 |
| `tests/video-projects.test.mjs` (fila no Postgres via PGlite, serviço da API, worker ponta a ponta com FFmpeg real, prefixos de Marketing) | 7/7 |
| `tests/video-edit-plan.test.mjs`, `davinci-*.test.mjs` (integração DaVinci estacionada continua íntegra) | 33/33 |
| Web: `tests/marketing-create.test.ts`, `tests/video-create-routes.test.ts` | 13/13 |
| Suíte completa do backend | ver §8 |

Não testado ao vivo: a tela no navegador (ver pendências) e a IA real (sem chave autorizada).

## 4. Tempo de render e recursos

- Local (Ryzen 7 5700G, 2 threads, preset medium): 25–43 s para 15–31 s de vídeo; FFmpeg ~0,6–0,9 GB.
- VPS (container 2 vCPU / 2 GiB, FFmpeg 7.0.2 de produção): 51–150 s por vídeo de 15–31 s;
  `veryfast` reduz a montagem com fala pela metade. Capacidade estimada: 25–40 vídeos/hora por worker.
- Transcrição local (faster-whisper `small`, 4 threads, com carregamento do modelo): 4 min de áudio em 37 s nesta máquina. No VPS, com 2 threads, espera-se algo mais lento; não foi medido lá.

## 5. Qualidade observada e limitações

Observado: produto, estampa e cores preservados; textos legíveis dentro das áreas seguras; ritmo e
transições coerentes; legenda sincronizada com a palavra falada; encerramento com marca e CTA.

Limitações registradas:
- Sem visão da imagem no planejamento (o provedor do gateway não envia imagens): a IA decide por
  fatos dos materiais (dimensões, papel, rótulo, cores) e frases da transcrição; posição do texto
  usa áreas seguras fixas, sem detectar onde o produto está.
- Sem biblioteca de trilhas licenciadas; sem narração sintética.
- Sem correção de cor, estabilização, redução de ruído, velocidade variável, vídeo generativo.
- Upload limitado a 100 MB por arquivo (`MEDIA_UPLOAD_MAX_BYTES`).
- Reprovação pelo WhatsApp não gera nova versão do vídeo automaticamente (a pessoa pede pela
  conversa na tela; a regra de escopo da outra frente já é reaproveitada no serviço).

## 6. Custos estimados de IA (a medir com a IA real)

| Item | Estimativa por vídeo |
|---|---|
| Planejamento (Sonnet 5: US$ 3/M entrada, US$ 15/M saída; ~4–8 mil tokens de entrada, 1–2,5 mil de saída) | US$ 0,03–0,06 |
| Correção automática, quando necessária (1 chamada a mais) | até 2× |
| Cada alteração por conversa | US$ 0,03–0,06 |
| Com Haiku 4.5 (`VIDEO_AI_MODEL`) | ~1/3 do valor, qualidade a comparar |
| Transcrição (local) | US$ 0 |
| Render (CPU do VPS atual) | sem custo adicional |

Cobrança: o crédito de IA do tenant é debitado pelo `CreditGatedAiGateway` (mesmo do Meetings).

## 7. Commits e arquivos

Commits locais desta frente (nenhum push): `d804af17` (executor + B0), `589333c5` (VPS + FFmpeg 7),
`b1e0f1d5` (planejamento por IA), e o commit da etapa 3 (fila, API, worker, tela). Principais arquivos:
- `src/domain/video-editing/video-edit-plan.ts`
- `src/infrastructure/video-editing/` (compilador, executor, ASS, métricas de fonte, análise, transcrição)
- `src/application/video-editing/` (construtor, planejamento, processamento, estilo da marca, serviço da API, transcrição)
- `src/application/ai-gateway/{prompts/video-edit-plan.v1.ts,schemas/video-edit-draft.v1.ts}` + ligações no gateway
- `src/application/ports/video-project-repository.port.ts`, `src/infrastructure/storage/{in-memory,postgres/postgres}-video-project-repository.ts`
- `db/migrations/0209_video_projects.sql`, `src/interfaces/api/routes/v1/video-projects.route.ts`, `src/interfaces/worker/video-worker.ts`
- `docker/video-worker.Dockerfile`, `docker-compose.zuno.yml` (serviço com perfil `video`)
- `web/features/video-editing/`, `web/app/workspaces/[workspaceId]/create/page.tsx`, `web/features/marketing/create-routes.ts`
- `scripts/video/` (materiais, prova B0, prova b2, medição no VPS)

## 8. Pendências para ativação em produção (cada uma precisa da sua aprovação)

1. **IA real**: autorizar uma chave (ou o uso da chave do servidor) para rodar `scripts/video/b2-planning-proof.mjs --ai` e avaliar a qualidade criativa e o custo real.
2. Conferência visual da tela (desktop e celular) num ambiente controlado.
3. Deploy da API e da web com a migration `0209` e `VIDEO_ENGINE_WORKSPACES=<seu workspace>`.
4. Build e subida do `video-worker` (`docker compose --profile video up -d video-worker`), com `ANTHROPIC_API_KEY` (ou chave do painel) e o cache de modelos já existente.
5. Opcional: biblioteca de trilhas licenciadas (`VIDEO_MUSIC_LIBRARY_DIR` com `manifest.json` + `VIDEO_MUSIC_LIBRARY_AVAILABLE=true`).
6. Leitura jurídica: patentes H.264/AAC em serviço comercial; não distribuir a imagem com o FFmpeg de produção.
7. Rollback: apagar `VIDEO_ENGINE_WORKSPACES` (a opção some da tela e a API recusa) e parar o `video-worker`; as tabelas novas não afetam nada existente.
