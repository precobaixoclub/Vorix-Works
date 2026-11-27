# Vídeo no piloto automático — auditoria (2026-11-26)

## Motor de vídeo existente (no ar desde `3456b976`)
- Plano estruturado (`VideoEditPlan`) → `FfmpegEditExecutor` (base 2×, zoompan, xfade, ASS, logo, ducking, −14 LUFS) → Quality Gate determinístico.
- Planejamento por IA via AI Gateway (`video_edit_planning`, Anthropic com crédito do tenant) — usado pela tela "Criar vídeo com IA".
- Fila `video_projects`/`video_versions` + `video-worker` (2 vCPU/2 GiB, um render por vez). Nenhum vídeo gerado em produção até aqui.
- Limite visual dos primeiros vídeos: toda cena é "foto em tela cheia + zoom", textos em caixa, poucas transições — funcional, mas com cara de apresentação.

## Piloto automático real (servidor, `/opt/vorix-editorial`)
- **Disparo**: systemd (`codex-social.timer` 11:15/18:15 e reconciliações 12/19h; `codex-social-redo.timer` a cada poucos minutos), como root, com `flock /run/vorix-editorial.lock`, sem acesso a `/opt/zuno`, `/root` e `/var/lib/docker`.
- **Codex**: CLI `codex exec` (modo não interativo, recurso oficial da CLI) como usuário `vorix-codex` (`runuser -u vorix-codex -- env -i … CODEX_HOME=/var/lib/vorix-codex/.codex codex exec --model gpt-6.2-sol --ephemeral --sandbox read-only --json --output-schema <schema> --image <arquivo> -`). Conta ChatGPT logada (não usa crédito de API). Recebe imagens, devolve JSON por schema; gera imagens com a ferramenta nativa (gravadas em `.codex/generated_images`).
- **Sistema**: toda leitura/escrita passa por `docker exec -i zuno-zuno-api-1 node` com `codex-social-backend.mjs` + pedido JSON pela entrada padrão (usa o container da API: banco, storage, publicação).
- **Ideias**: `select` escolhe pauta `available` `single_image`/`carousel` (calendário, histórico, catálogo, capturas da Biblioteca, regras por marca: CMKV com 34 produtos de terceiros proibidos, Vorix com capturas reais por recurso). **Pautas `video` são ignoradas** (só contadas).
- **Produção**: base pela IA (quando o arquétipo pede) ou composição controlada com a foto original → render → revisão visual pelo Codex (`reviewWithCodex`) → Quality Gate → `submitArt`.
- **Publicação/aprovação**: `c.social.posts.create`; marca com regra de aprovação → publicação nasce aguardando o WhatsApp; trava `verifyApprovedArt` (só a arte exata aprovada segue).
- **WhatsApp**: `WhatsappApprovalService.dispatchPending` envia só **imagens** + texto; a resposta é aplicada pela API. O provedor (WuzAPI) já tem `sendVideo`/`sendDocument`.
- **Reprovação/refação**: motivo vira `publication_redo_requests`; `codex-social-redo.mjs` reivindica e roda o agendador com `VORIX_REDO_JOB`; o Codex reescreve só o que o motivo pede; no máximo 2 refações (`MAX_REDO_ATTEMPTS`), depois volta ao Bolsão.

## IA do piloto × IA por API
| | Piloto (Codex) | API (AI Gateway) |
|---|---|---|
| Autenticação | login ChatGPT do usuário `vorix-codex` | chave Anthropic/OpenAI do painel, crédito do tenant |
| Onde roda | host, CLI | dentro da API/worker |
| Visão | sim (`--image`) | não (provedor atual só texto) |
| Gera imagem | sim (ferramenta nativa) | OpenAI Images (pago, por crédito) |
| Usado por | piloto automático do Bolsão | telas do produto (ex.: Criar vídeo com IA) |

Restrição a registrar: o uso é o que a CLI oferece (`codex exec` não interativo) dentro dos limites do plano ChatGPT da conta; a documentação da CLI recomenda chave de API para automação em CI. Nada aqui contorna limites — se o plano limitar, a peça vai para revisão manual.

## Repositório × servidor
Os `codex-social-*` do repositório são mais novos que os do servidor (commits de outra frente ainda não implantados). Qualquer deploy dos scripts leva também essas mudanças — será apresentado antes, para confirmação.
