# CLI

Ponto de entrada local para executar um comando de conteúdo de ponta a ponta: `npm run zuno -- "<comando>"` roda Arthur (interpreta linguagem natural e monta o `ExecutionPlan`) → Caio (executa o plano, encadeando automaticamente a saída de cada Skill na entrada da próxima) → Helena (descobre e carrega as Skills reais a partir de `dist/skills`) → as Skills reais. O usuário não precisa citar Arthur, Helena, João, Maria, Sofia, Bianca, Pedro, Rafa, Lucas ou Ana: comandos como "crie um post", "crie um carrossel com 5 imagens", "crie uma imagem", "crie um vídeo para Reels", "crie um TikTok", "crie um Story" e "crie um anúncio" são interpretados automaticamente. A Ana só é incluída quando o comando pede explicitamente para publicar/postar/agendar; citar Instagram/Facebook/TikTok apenas define canal e formato da peça. O modo padrão atual é `LOCAL_PRODUCTION`, também aceito explicitamente por `--mode local-production`.

Nesta fase não existe nenhum provider real de IA configurado (ver ADR 0003) e qualquer publicação roda sempre localmente. João, Maria, Sofia, Bianca e Lucas usam `DeterministicFakeIcaroProvider` (`src/infrastructure/ai`) — um provider **fake e determinístico**, exclusivamente para testes automatizados/demonstração de texto, documentado como tal. Pedro usa Developer Assisted Mode para imagens. Rafa **prefere renderização automática local via FFmpeg** (`VideoRenderingPort`, ver `docs/video-rendering.md`) e, antes de renderizar, usa `VisualAssetResolverPort` para escolher imagens reais por cena a partir de `assets/visual/library` ou `assets/visual/free/manifest.json`; se faltar imagem adequada, pausa com `pendingVisualAssets` e prompt/caminho exato para criação assistida. Ana retorna `local_ready`/`dry_run`, nunca chama Meta e nunca aciona `ArtifactHostingPort` no `LOCAL_PRODUCTION`.

## LOCAL_PRODUCTION

`LOCAL_PRODUCTION` é o modo oficial de uso pelo VS Code/CLI nesta fase. Ele garante:

- nenhuma integração com DigitalOcean, Meta, OpenAI, Gemini, Stability, ComfyUI ou qualquer provider externo;
- nenhuma criação de URL pública e nenhum upload para CDN;
- nenhuma tentativa de usar `file://` como URL pública;
- Pedro em Developer Assisted Mode; Rafa em renderização automática local (FFmpeg via `VideoRenderingPort`) por padrão, com resolução automática de assets visuais e Developer Assisted Mode como fallback;
- Ana apenas preparando payload local, com status `local_ready` quando houver etapa de publicação;
- artefatos finais em `artifacts/<executionId>/`: `index.html`, imagens/vídeos, `caption.txt`, `hashtags.txt` quando houver hashtags, `metadata.json`, `execution-report.json` e `carousel.zip` quando houver múltiplas imagens.

## Renderização automática local de vídeo (Rafa)

Desde a v1.1, um comando de vídeo (`"crie um vídeo para Reels de 30 segundos..."`) normalmente **não pausa mais** esperando intervenção manual para o MP4 final: Rafa renderiza o vídeo localmente e automaticamente via FFmpeg (`VideoRenderingPort`/`FfmpegVideoRenderingAdapter`, nunca uma API externa), cobrindo imagem real por cena, texto, legendas, CTA, logo, transições, zoom/pan e música local a partir da timeline que Diego já monta. Antes disso, o `VisualAssetResolverPort` transforma a direção de Vanessa e a timeline de Diego em consultas visuais, escolhe assets reais por score ou pausa para criação assistida quando não houver material adequado. Detalhes completos — arquitetura, segurança (nunca `shell: true`, nunca um comando vindo de variável de ambiente, sempre `spawn` com argumentos em array), e como assets locais opcionais (logo, imagens, trilha) são resolvidos — em `docs/video-rendering.md` e `docs/visual-asset-resolver.md`. O workflow segue direto para Lucas/aprovação humana quando todos os assets existem e são válidos.

## Developer Assisted Mode (Pedro, assets visuais do Rafa e fallback de vídeo)

O Claude Code **não possui nenhuma capacidade nativa de geração de imagem ou vídeo** (nem tool própria, nem MCP oficial da Anthropic, nem como parte do modelo — confirmado tecnicamente, ver `src/infrastructure/ai/README.md`), e esta fase não integra nenhum provider externo de imagem ou vídeo por IA (OpenAI, Gemini, Stability AI, Runway etc.). Por isso a CLI roda o Pedro oficialmente em modo **`developer_assisted`** para imagens — nenhuma IA é chamada para gerar pixels; em vez disso, monta um prompt técnico detalhado e o caminho exato onde o arquivo deve ser salvo, e pausa o workflow até que ele exista. Rafa usa o mesmo mecanismo para **assets visuais faltantes por cena** (`pendingVisualAssets`) e, como fallback, para o MP4 final quando não há `VideoRenderingPort` configurada ou quando a renderização automática falha (ver `docs/video-rendering.md`).

Fluxo completo do modo assistido (idêntico para imagem e para o fallback de vídeo, mudando apenas o tipo de arquivo):

1. Rode `npm run zuno -- "<comando>"`. Quando o workflow chega em Pedro (imagem, sempre) ou em Rafa (asset visual por cena ou vídeo final no fallback) e o arquivo ainda não existe, o estado fica `WAITING_ASSISTED_GENERATION` e a CLI imprime, para cada arquivo pendente, o caminho esperado (ex.: `artifacts/<executionId>/images/slide-01.png`, `artifacts/<executionId>/visual-assets/scene-01.png` ou `artifacts/<executionId>/videos/final-video.mp4`) e o prompt técnico completo.
2. A IA desenvolvedora cria o arquivo seguindo o prompt e salva exatamente no caminho indicado — PNG/JPG na resolução informada (Pedro ou asset visual de Rafa) ou MP4 nas especificações informadas (Rafa: resolução conforme canal/formato, 30fps, H.264/AAC).
3. Rode `npm run zuno -- --mode local-production --continue <executionId>`. A Skill correspondente verifica se o arquivo existe e valida que é real e plausível — Pedro confere assinatura PNG e dimensões batendo com o esperado; o Asset Resolver confere PNG/JPG real e resolução mínima; Rafa confere a caixa `ftyp` de um MP4 real e um tamanho mínimo de arquivo. Se válido, continua o fluxo normalmente: Pedro cria o artefato, `caption.txt`, `metadata.json` e `carousel.zip` quando houver carrossel; Rafa renderiza/registra o artefato de vídeo; Lucas revisa o pacote; a aprovação humana pausa o workflow; e, se o comando tiver pedido publicação explicitamente, Ana entra depois da aprovação.
4. Se o arquivo ainda não existir (ou não for válido) no momento do `--continue`, o workflow simplesmente pausa de novo com a mesma instrução — retomar é sempre seguro e idempotente.

O relatório final deixa explícito qual caminho gerou o vídeo: `generation.provider`/`generationMode` valem `"developer-assisted"`/`"developer_assisted"` (intervenção manual) ou `"local-render"`/`"local_render"` (FFmpeg automático) — nunca `fake-icaro-provider`, usado só em testes de texto.

Para forçar o fallback assistido mesmo quando a renderização automática está disponível (ex.: em testes), defina `ZUNO_VIDEO_RENDER_MODE=developer_assisted`. É uma allowlist estrita de dois valores fixos (`local_render`/`developer_assisted`) — nunca um comando, caminho ou argumento vindo de variável de ambiente; qualquer outro valor é ignorado.

## Entrega final padronizada

Quando o workflow chega a `COMPLETED`, a CLI gera uma página única em `artifacts/<executionId>/index.html`. Essa página é a entrega oficial do trabalho e reúne tudo que antes ficava espalhado entre terminal e saídas de Skills: modo usado, intenção identificada, pipeline escolhida, tempo de execução, arquivos gerados, validações, warnings, próximos passos e relatório das Skills executadas. Para imagens, a página mostra preview grande, botão `Baixar Imagem` com link real e atributo `download`, botão `Abrir Imagem`, cópia de legenda/hashtags/CTA e botão `Baixar ZIP` quando houver carrossel. Para vídeos, mostra player HTML5, botão `Assistir`, botão `Baixar Vídeo` com arquivo real, cópia de legenda/hashtags/CTA e os dados técnicos do vídeo. Os botões de copiar usam `navigator.clipboard.writeText` com fallback para `document.execCommand("copy")`, então a página continua útil mesmo quando aberta localmente por `file://`. A entrega também grava `caption.txt`, `hashtags.txt`, `metadata.json` e `execution-report.json`.

Antes de executar qualquer etapa, Caio verifica se toda capability exigida pelo plano tem Skill pronta em Helena. Comandos que exigem capabilities ainda não implementadas (`campaign_management`, `metrics_analysis`, `optimization`, `video_creation`) falham imediatamente com o estado `FAILED` e uma mensagem consolidada listando exatamente o que falta, sem executar nenhuma etapa. Um comando pedindo um carrossel (ex.: "crie um carrossel de 3 imagens...") **não** cai nesse caso — carrossel não é uma capability separada, é `image_generation` com `imageCount > 1`, então o plano só usa a etapa de geração de imagem já implementada pelo Pedro.

## Uso

```bash
npm run zuno -- "crie um post para o Rumo ao Altar"
npm run zuno -- --mode local-production "crie um carrossel com 5 imagens sobre RSVP"
npm run zuno -- --mode local-production "crie um vídeo para Reels de 30 segundos"
npm run zuno -- --music "assets/audio/music/minha-musica.mp3" "crie um vídeo para Reels de 30 segundos"
npm run zuno -- --assets-scan
npm run zuno -- --assets-list
npm run zuno -- --assets-report
npm run zuno -- "crie um post para o Rumo ao Altar" --client-id client-rumo
npm run zuno -- --mode local-production --continue <executionId>
npm run zuno -- --mode local-production --approve <executionId>
npm run zuno -- --mode local-production --reject <executionId>
npm run zuno -- --list
```

- Sem `--client-id`, a CLI semeia automaticamente (na primeira vez) um cliente de demonstração ("Rumo ao Altar") em `.zuno-data/`, para que o comando funcione sem nenhuma configuração prévia.
- O workflow para na etapa de geração assistida (sempre para imagem no Pedro; para assets visuais faltantes ou fallback de vídeo no Rafa) ou na etapa de aprovação humana (`human_gate`), e fica salvo em `.zuno-data/executions/<executionId>.json` até ser retomado — `--continue`/`--approve`/`--reject` funcionam mesmo numa invocação de processo separada da que criou o workflow.
- Os artefatos (imagens, vídeo, `index.html`, `caption.txt`, `metadata.json`, `carousel.zip` quando houver carrossel) são gravados em `artifacts/<executionId>/` pela mesma `ArtifactDeliveryPort` que Pedro usa tanto para escrever (modo ai_provider) quanto para ler e validar (modo developer_assisted), e que Rafa usa exclusivamente para ler e validar (Rafa não escreve o vídeo — apenas verifica o que a IA desenvolvedora salvou).
