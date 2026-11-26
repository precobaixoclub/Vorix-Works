# Motor de vídeo B (IA + FFmpeg) — prova B0

Data: 2026-11-26. Escopo: executor FFmpeg ligado ao contrato de edição existente, vídeos reais nos
três formatos, revisão visual, medição controlada no VPS. Nada foi implantado.

## 1. O que foi construído

| Peça | Arquivo | Papel |
|---|---|---|
| Contrato do plano (ampliado) | `src/domain/video-editing/video-edit-plan.ts` | + cartão de cor/gradiente, zoom de enquadramento, palavras com tempo na legenda, narração |
| Compilador FFmpeg | `src/infrastructure/video-editing/ffmpeg-edit-compiler.ts` | plano → passos (base 2×, clipe, áudio, montagem) com nomes simples |
| Executor FFmpeg | `src/infrastructure/video-editing/ffmpeg-edit-executor.ts` | implementa `VideoEditExecutor`: pasta isolada, limites, disco, timeout, cancelamento, progresso, cache por workspace |
| Textos e legendas | `src/infrastructure/video-editing/ass-subtitles.ts`, `font-metrics.ts` | ASS/libass com fonte real medida, áreas seguras, colisão e deduplicação, palavra falada destacada |
| Transcrição → legenda | `src/application/video-editing/transcript-tools.ts` | legenda sai da transcrição (nunca da IA), glossário da marca, corte sem partir palavra, enquadramento automático |
| Transcrição com tempo por palavra | `scripts/meetings/faster_whisper_transcribe.py --word-timestamps` | opção nova, desligada por padrão (Meetings não muda) |
| Reaproveitado | `video-quality-gate.ts`, `ffmpeg-media-analysis.ts`, `ffmpeg-binary.ts` | Quality Gate e análise da Etapa A; binário vetado do renderizador existente |

A integração DaVinci continua no repositório e recusa explicitamente os recursos novos (cartão,
narração), sem receber investimento.

## 2. Vídeos da prova (local, 2 threads, preset medium, sem cache)

Saída em `artifacts/video-b0/out/` (MP4, plano JSON, relatório, folha de contato).

| Vídeo | Material | Duração | Render | Pico FFmpeg | Quality Gate |
|---|---|---|---|---|---|
| `cmkv-9x16.mp4` | fotos reais da camiseta CMKV + logo | 15 s | 43 s | 0,90 GB | aprovado para revisão |
| `cmkv-1x1.mp4` | idem | 15 s | 25 s | 0,59 GB | aprovado para revisão |
| `cmkv-16x9.mp4` | idem (produto inteiro sobre fundo desfocado) | 15 s | 40 s | 0,88 GB | aprovado para revisão |
| `reels-raa-9x16.mp4` | gravação bruta de 82 s com fala pt-BR → 31 s | 31 s | 39 s | 0,85 GB | aprovado para revisão |
| `demo-raa-16x9.mp4` | capturas reais do Rumo ao Altar + narração | 17,5 s | 41 s | 0,88 GB | aprovado para revisão |

Máquina: Ryzen 7 5700G. A fala da gravação e da narração é sintética (voz Maria do Windows), e a
trilha é original sintetizada: a Vorix ainda não tem biblioteca de músicas licenciadas.

## 3. Revisão visual (feita nos quadros reais, não só nos testes)

Defeitos encontrados e corrigidos durante a prova:
- Foto com proporção ligeiramente diferente caía em "mostrar inteiro" e ficava com faixas no 9:16 →
  limite de corte de produto ajustado (60% da área), todas as fotos preenchem de forma consistente.
- Fundo desfocado do 16:9 mostrava os braços da modelo ampliados → desfoque e escurecimento fortes.
- Faixa clara no topo do cartão (filtro de gradiente) → gradiente linear calculado por pixel.
- Gravação de tela no 9:16 ficava pequena demais para ler → zoom de enquadramento 1,5×.
- Legenda com ".com .gr" e "100 %" separados → tokens grudados do Whisper juntados, glossário por
  palavra mantendo o destaque.
- Legenda da narração repetindo o CTA do cartão final → legenda redundante com título é omitida.
- Corte começava 20 ms depois da primeira palavra quando as palavras encostavam → corrigido.
- Cache reaproveitava intermediário de versão anterior do motor → chave por argumentos + versão +
  conteúdo dos arquivos.

Qualidade observada: produto, estampa e cores preservados (nenhuma correção de cor aplicada a foto
de produto); textos legíveis dentro da área segura; movimentos suaves; transições coerentes
(dissolve, push, zoom, dip); legenda sincronizada com a palavra falada; encerramento com marca e CTA.

## 4. Medição controlada no VPS

Condições: container temporário da própria imagem `zuno-zuno-api` com `--cpus=2 --memory=2g
--memory-swap=2g --pids-limit=256 --network=none --cpu-shares=256`, uma renderização por vez,
`timeout` de 10 min com kill, somente materiais sintéticos gerados dentro do container, pasta em
`/var/tmp` removida ao final. Verificado depois de cada rodada: nenhum container restante, nenhuma
pasta, `/tmp` inalterado, memória disponível igual (9,7 GiB).

| Caso | Duração | Render (medium) | Montagem final | Render (veryfast) | Pico do container* |
|---|---|---|---|---|---|
| Fotos 9:16 | 15 s | 86 s | 35 s | 103 s | 1,49 GB |
| Fotos 1:1 | 15 s | 51 s | 22 s | — | 1,49 GB |
| Fotos 16:9 | 15 s | 101 s | 44 s | — | 1,50 GB |
| Gravação 9:16 + legendas | 31 s | 150 s | 84 s | 104 s | 1,49 GB |

\* `memory.peak` do cgroup inclui cache de disco; o processo FFmpeg mede ~0,9 GB.

A carga do VPS variou de 1,9 a 4,4 durante a medição (outros projetos), o que explica a
variação entre rodadas. Leitura: **1,5–2,5 min por vídeo de 15–30 s com 2 vCPUs**, cerca de
25–40 vídeos por hora por worker. Recomendação de produção: preset `veryfast` na montagem.

Primeira rodada no VPS falhou por diferença de versão (FFmpeg 7.0 exige frame rate constante
declarado no `xfade`; o 6.1 local tolerava). Corrigido e coberto pelo teste local.

## 5. Licença do FFmpeg

- Produção: `jellyfin-ffmpeg 7.0.2-9 portable` (versão fixa, sha256 conferido em
  `scripts/install-ffmpeg-linux.sh`), configurado com `--enable-gpl --enable-version3`, x264/x265
  (GPL), libass, libfdk-aac, openssl.
- Uso como serviço no próprio servidor: permitido. A GPL só gera obrigação ao distribuir o binário.
- **Não distribuir** a imagem Docker com esse FFmpeg a terceiros (cliente, revenda, on-premise):
  libfdk-aac é incompatível com a GPL, então esse binário não é redistribuível.
- O motor usa o codificador AAC nativo do FFmpeg, não a libfdk-aac.
- Patentes de H.264/AAC num serviço comercial: pedir leitura jurídica antes da cobrança.
- Local: `ffmpeg-static` 6.1.1 (gyan essentials, GPL v3), só para desenvolvimento.

## 6. Ainda não suportado (registrado)

- Biblioteca de trilhas licenciadas; narração por voz sintética (TTS) não habilitada.
- Detecção do produto na imagem: textos usam posições seguras fixas (planejador com visão escolherá).
- Composição dividida para 16:9 (produto de um lado, texto do outro) e sobreposição de imagem sobre vídeo.
- Correção de cor/LUT, estabilização, remoção de ruído de áudio, velocidade variável.
- Geração de cenas por IA (vídeo generativo).
