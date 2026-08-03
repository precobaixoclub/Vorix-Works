# Publicação no TikTok (conta por cliente + agendamento)

Cada cliente (tenant + workspace) conecta a **própria conta do TikTok** pelo painel. O token fica
cifrado no secret store e é usado só na hora de publicar. As publicações podem ser imediatas ou
agendadas com foto/vídeo e descrição.

## 1. Criar o app no TikTok for Developers

1. Acesse <https://developers.tiktok.com/> e crie um app.
2. Adicione os produtos **Login Kit** e **Content Posting API**.
3. Solicite os escopos:
   - `user.info.basic` — nome/avatar da conta conectada;
   - `video.upload` — preparar a mídia;
   - `video.publish` — publicar direto no perfil (Direct Post).
4. Cadastre a **Redirect URI** exatamente igual à do painel, por exemplo
   `https://app.seudominio.com/tiktok/callback` (em desenvolvimento, `http://localhost:3001/tiktok/callback`).
5. Em **Content Posting API → Direct Post**, faça a verificação de propriedade do domínio que
   hospeda as mídias. O TikTok baixa o arquivo por `PULL_FROM_URL`; domínios não verificados
   retornam `url_ownership_unverified`.
6. Enquanto o app estiver em modo sandbox/unaudited, apenas contas adicionadas como testers
   conseguem publicar, e os posts saem como privados.

## 2. Variáveis de ambiente

```bash
TIKTOK_ENABLED=true
TIKTOK_CLIENT_KEY=...
TIKTOK_CLIENT_SECRET=...
TIKTOK_OAUTH_REDIRECT_URI=https://app.seudominio.com/tiktok/callback

# Publicação real precisa sair do modo sandbox e liberar o provider tiktok:
PUBLICATION_PROVIDER_ENVIRONMENT=production
PUBLICATION_PRODUCTION_ENABLED=true
PUBLICATION_CANARY_ENABLED=true
PUBLICATION_CANARY_PROVIDER_IDS=tiktok
PUBLICATION_CANARY_TENANT_IDS=*
PUBLICATION_CANARY_WORKSPACE_IDS=*

# Dispara os agendamentos vencidos dentro do próprio processo da API:
PUBLICATION_SCHEDULER_ENABLED=true
PUBLICATION_SCHEDULER_INTERVAL_MS=30000

# Sem isto, o token OAuth do TikTok fica só em memória (dev/sandbox). Em produção é obrigatório
# para o token ser gravado cifrado (AES-256-GCM) — ver seção 3:
PERSISTENCE_DRIVER=postgres
DATABASE_URL=postgres://usuario:senha@host:5432/banco
SECRET_MANAGER_PROVIDER=production
```

`PUBLICATION_CANARY_TENANT_IDS`/`WORKSPACE_IDS` aceitam `*` para liberar todos os clientes; use
listas explícitas para um rollout gradual. Sem `PUBLICATION_CANARY_PROVIDER_IDS=tiktok` a
governança bloqueia o provider com `provider_mismatch`.

## 3. Fluxo de conexão da conta

```
Painel → POST /v1/publication-providers/tiktok/oauth/connect  → authorizationUrl
navegador → TikTok (login + consentimento)
TikTok → GET  {TIKTOK_OAUTH_REDIRECT_URI}?code&state         (página do frontend)
frontend → POST /v1/publication-providers/tiktok/oauth/callback { state, code }
```

O `state` é de uso único, expira em 10 minutos e usa PKCE (`S256`). No callback a API troca o
código por tokens e grava três coisas: o segredo (access/refresh token) no Secret Manager, a
`PublicationCredentialReference` (só metadados) e a credencial governada com escopos e auditoria.

O Secret Manager só cifra de verdade (AES-256-GCM, `operational_secrets`) quando
`SECRET_MANAGER_PROVIDER=production` está configurado (exige `PERSISTENCE_DRIVER=postgres` +
`DATABASE_URL` + `JWT_SECRET`). Sem isso, o valor padrão é um store em memória — aceitável em
dev/test/sandbox, **não** para tokens reais de cliente em produção.

## 4. Endpoints

| Método | Rota | Permissão |
|---|---|---|
| `GET` | `/v1/publication-providers/tiktok/oauth/status?workspaceId=` | `publication:read` |
| `POST` | `/v1/publication-providers/tiktok/oauth/connect` | `publication:admin` |
| `POST` | `/v1/publication-providers/tiktok/oauth/callback` | `publication:admin` |
| `POST` | `/v1/publication-providers/tiktok/oauth/disconnect` | `publication:admin` |
| `GET` | `/v1/tiktok/posts?workspaceId=` | `publication:read` |
| `POST` | `/v1/tiktok/posts` | `publication:create` |
| `POST` | `/v1/tiktok/posts/:id/cancel` | `publication:cancel` |
| `POST` | `/v1/tiktok/posts/run-due` | `publication:operate` |

### Agendar um post

```http
POST /v1/tiktok/posts
{
  "workspaceId": "workspace-1",
  "description": "Lançamento da coleção de verão ☀️",
  "videoUrl": "https://cdn.seudominio.com/video.mp4",
  "scheduledAt": "2026-03-01T18:00:00.000Z",
  "timezone": "America/Sao_Paulo",
  "privacyLevel": "PUBLIC_TO_EVERYONE"
}
```

Para carrossel de fotos, troque `videoUrl` por `imageUrls: ["https://...", "https://..."]`
(máximo de 35). Omitir `scheduledAt` publica imediatamente. As URLs precisam ser **HTTPS
públicas** — endereços privados/internos são recusados para evitar SSRF. Sem uma URL pública em
mãos, use `POST /v1/publication-media/upload` primeiro (ver `docs/media-upload.md`) para enviar o
arquivo direto do computador do cliente e obter a URL.

## 5. Como o agendamento dispara

`POST /v1/tiktok/posts` cria o `PublicationPlan` (canal e provider travados em `tiktok`),
aprova automaticamente e registra o schedule. O loop configurado por
`PUBLICATION_SCHEDULER_ENABLED` chama `runDueSchedules` + `PublicationWorker` a cada ciclo,
movendo os agendamentos vencidos para a outbox e publicando com garantias de lease, fencing
token e idempotência. Para operar por cron externo, desligue o loop e chame
`POST /v1/tiktok/posts/run-due`.

## 6. Publicação no TikTok

- **Vídeo**: `POST /v2/post/publish/video/init/` com `source: "PULL_FROM_URL"`.
- **Foto**: `POST /v2/post/publish/content/init/` com `media_type: "PHOTO"` e `post_mode: "DIRECT_POST"`.
- O TikTok processa de forma assíncrona; o adapter consulta
  `POST /v2/post/publish/status/fetch/` para confirmar `PUBLISH_COMPLETE` ou capturar falha.
- Token expirado é renovado automaticamente uma vez (`grant_type=refresh_token`) antes de
  reenviar a publicação.

### Mapeamento de erros

| Código do TikTok | Resultado |
|---|---|
| `access_token_invalid`, `scope_not_authorized` | `authentication_failure` |
| `rate_limit_exceeded`, `spam_risk_too_many_posts` | `rate_limited` (respeita `retry-after`) |
| `invalid_params`, `url_ownership_unverified`, `video_pull_failed` | `permanent_failure` |
| `internal_error`, HTTP 5xx | `transient_failure` (retry automático) |
| timeout | `unknown_outcome` (vai para reconciliação, sem retry cego) |

## 7. Testes

```bash
npm run test:tiktok
```

Cobre OAuth com PKCE, uso único do `state`, isolamento do token, publicação de vídeo e foto,
renovação de token, mapeamento de erros e a liberação do canário multi-provider.
