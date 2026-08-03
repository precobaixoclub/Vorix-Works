# Publicação no Instagram/Facebook (conta por cliente + agendamento)

Cada cliente (tenant + workspace) conecta a **própria conta do Meta** pelo painel. Um único fluxo
OAuth resolve todas as Páginas do Facebook do usuário e, para cada uma, registra uma credencial
`facebook` (posts na Página) e — quando a Página tem uma conta profissional do Instagram vinculada
— também uma credencial `instagram` (feed/carrossel/reels). O token fica isolado no secret store e
é usado só na hora de publicar. As publicações podem ser imediatas ou agendadas.

## 1. Criar o app no Meta for Developers

1. Acesse <https://developers.facebook.com/> e crie um app do tipo "Business".
2. Adicione os produtos **Facebook Login** e **Instagram Graph API** (Content Publishing).
3. Solicite as permissões (via App Review para uso além de testers/admins):
   - `pages_show_list`, `pages_read_engagement`, `pages_manage_posts` — listar/publicar na Página;
   - `instagram_basic`, `instagram_content_publish` — ler e publicar na conta do Instagram.
4. Cadastre a **Redirect URI** exatamente igual à do painel, por exemplo
   `https://app.seudominio.com/instagram/callback` (em desenvolvimento, `http://localhost:3001/instagram/callback`).
5. A conta do Instagram do cliente precisa ser **Profissional (Business ou Creator)** e estar
   **vinculada a uma Página do Facebook** — sem isso, `instagram_business_account` não resolve e só
   a credencial `facebook` é criada.
6. Enquanto o app não passar pela App Review, só contas com papel de admin/desenvolvedor/tester no
   próprio app conseguem completar o OAuth e publicar.

## 2. Variáveis de ambiente

```bash
# Mesmo app do Meta usado pelo META_PAGES_SANDBOX (reaproveita META_APP_ID/META_APP_SECRET/META_GRAPH_BASE_URL):
META_APP_ID=...
META_APP_SECRET=...
META_GRAPH_BASE_URL=https://graph.facebook.com/v21.0

META_INSTAGRAM_ENABLED=true
META_INSTAGRAM_OAUTH_REDIRECT_URI=https://app.seudominio.com/instagram/callback

# Publicação real precisa sair do modo sandbox e liberar os providers instagram/facebook:
PUBLICATION_PROVIDER_ENVIRONMENT=production
PUBLICATION_PRODUCTION_ENABLED=true
PUBLICATION_CANARY_ENABLED=true
PUBLICATION_CANARY_PROVIDER_IDS=instagram,facebook
PUBLICATION_CANARY_TENANT_IDS=*
PUBLICATION_CANARY_WORKSPACE_IDS=*

# Dispara os agendamentos vencidos dentro do próprio processo da API (mesmo loop do TikTok):
PUBLICATION_SCHEDULER_ENABLED=true
PUBLICATION_SCHEDULER_INTERVAL_MS=30000
```

`PUBLICATION_CANARY_TENANT_IDS`/`WORKSPACE_IDS` aceitam `*` para liberar todos os clientes; use
listas explícitas para um rollout gradual. Sem `instagram`/`facebook` em
`PUBLICATION_CANARY_PROVIDER_IDS` a governança bloqueia o provider com `provider_mismatch`.

## 3. Fluxo de conexão da conta

```
Painel → POST /v1/publication-providers/meta/oauth/connect  → authorizationUrl
navegador → Meta (login + consentimento das Páginas)
Meta → GET  {META_INSTAGRAM_OAUTH_REDIRECT_URI}?code&state    (página do frontend)
frontend → POST /v1/publication-providers/meta/oauth/callback { state, code }
```

O `state` é de uso único, expira em 10 minutos e usa PKCE (`S256`). No callback a API troca o
código por um token de usuário de longa duração, resolve **todas** as Páginas do Facebook do
usuário (`/me/accounts` com `instagram_business_account`) e, para cada Página, grava a credencial
`facebook` (Page Access Token) e — quando há Instagram vinculado — a credencial `instagram`
(mesmo Page Access Token + `instagramBusinessAccountId`), ambas com `PublicationCredentialReference`
governada (escopos e auditoria).

Diferente do TikTok, o Page Access Token derivado de um token de usuário de longa duração não
expira sozinho — não existe `refresh_token`. `refresh()` existe mesmo assim para o caso de o Meta
rotacionar/exigir renovação do token do usuário antes do provider publicar de novo.

## 4. Endpoints

| Método | Rota | Permissão |
|---|---|---|
| `GET` | `/v1/publication-providers/meta/oauth/status?workspaceId=&providerId=` | `publication:read` |
| `POST` | `/v1/publication-providers/meta/oauth/connect` | `publication:admin` |
| `POST` | `/v1/publication-providers/meta/oauth/callback` | `publication:admin` |
| `POST` | `/v1/publication-providers/meta/oauth/disconnect` | `publication:admin` |
| `GET` | `/v1/instagram/posts?workspaceId=` | `publication:read` |
| `POST` | `/v1/instagram/posts` | `publication:create` |
| `POST` | `/v1/instagram/posts/:id/cancel` | `publication:cancel` |
| `POST` | `/v1/instagram/posts/run-due` | `publication:operate` |

### Agendar um post

```http
POST /v1/instagram/posts
{
  "workspaceId": "workspace-1",
  "target": "instagram",
  "placement": "feed",
  "caption": "Lançamento da coleção de verão ☀️",
  "imageUrls": ["https://cdn.seudominio.com/1.jpg", "https://cdn.seudominio.com/2.jpg"],
  "scheduledAt": "2026-03-01T18:00:00.000Z",
  "timezone": "America/Sao_Paulo"
}
```

`target` é `"instagram"` (padrão) ou `"facebook"`. Para vídeo/Reels, troque `imageUrls` por
`videoUrl`; mais de uma imagem vira carrossel (Instagram) ou post multi-foto (Página). No Facebook,
`target: "facebook"` também aceita um post só de texto (sem `videoUrl`/`imageUrls`). Omitir
`scheduledAt` publica imediatamente. As URLs precisam ser **HTTPS públicas** — endereços
privados/internos são recusados para evitar SSRF. Sem uma URL pública em mãos, use
`POST /v1/publication-media/upload` primeiro (ver `docs/media-upload.md`) para enviar o arquivo
direto do computador do cliente e obter a URL.

`placement` é `"feed"` (padrão) ou `"story"`. Stories não têm legenda nem carrossel na Graph API —
`imageUrls` aceita só uma imagem quando `placement: "story"`, e vídeo em Story do Facebook ainda
não é suportado por esta integração (rejeitado com `META_FACEBOOK_VIDEO_STORY_UNSUPPORTED`; use
`placement: "feed"` ou publique a foto).

## 5. Como o agendamento dispara

Igual ao TikTok: `POST /v1/instagram/posts` cria o `PublicationPlan` (canal e provider travados em
`instagram`/`facebook`), aprova automaticamente e registra o schedule. O loop configurado por
`PUBLICATION_SCHEDULER_ENABLED` chama `runDueSchedules` + `PublicationWorker` a cada ciclo. Nem a
Instagram Graph API nem a API de Páginas do Facebook oferecem agendamento nativo para posts
orgânicos — o `scheduledAt` é inteiramente controlado pelo nosso scheduler, que chama `publish()`
no horário certo. Para operar por cron externo, desligue o loop e chame `POST /v1/instagram/posts/run-due`.

## 6. Publicação no Instagram/Facebook

- **Instagram — imagem única**: `POST /{ig-user-id}/media` com `image_url` + `caption`.
- **Instagram — carrossel**: cria um container `is_carousel_item` por imagem, depois um container
  pai `media_type: CAROUSEL` com `children`.
- **Instagram — vídeo/Reels**: `POST /{ig-user-id}/media` com `media_type: REELS` + `video_url`.
- Todo container é consultado (`status_code`) até `FINISHED` antes de `POST /{ig-user-id}/media_publish`.
- **Facebook — imagem única**: `POST /{page-id}/photos` com `url` + `caption` + `published=true`.
- **Facebook — múltiplas imagens**: upload de cada foto com `published=false`, depois
  `POST /{page-id}/feed` com `attached_media`.
- **Facebook — vídeo**: `POST /{page-id}/videos` com `file_url` + `description`.
- **Facebook — texto**: `POST /{page-id}/feed` com `message`.
- **Instagram — Story**: `POST /{ig-user-id}/media` com `media_type: STORIES` (`image_url` ou
  `video_url`, sem `caption` — a Graph API não aceita legenda em Story).
- **Facebook — Story de foto**: upload da foto com `published=false`, depois
  `POST /{page-id}/photo_stories` com `photo_id`. **Story de vídeo no Facebook ainda não está
  implementada** (a API usa um protocolo de upload resumível mais complexo) — publicar retorna
  `permanent_failure`/`META_FACEBOOK_VIDEO_STORY_UNSUPPORTED` em vez de tentar silenciosamente.
- Token expirado/inválido (`OAuthException`, código 190) dispara uma renovação do Page Access Token
  antes de repetir a chamada.

### Mapeamento de erros (Graph API)

| Código do Meta | Resultado |
|---|---|
| `190` (`OAuthException`) | `authentication_failure` |
| `4`, `17`, `32`, `613` (limites de chamada/Página) | `rate_limited` |
| `1`, `2` (erro interno/serviço da API) | `transient_failure` |
| HTTP 400 (parâmetro inválido, container com erro) | `permanent_failure` |
| HTTP 5xx | `transient_failure` (retry automático) |
| timeout | `unknown_outcome` (vai para reconciliação, sem retry cego) |

## 7. Testes

```bash
npm run test:instagram
```

Cobre OAuth com PKCE, resolução de múltiplas Páginas + conta do Instagram vinculada, isolamento do
token, publicação de imagem/carrossel/vídeo no Instagram, publicação de foto/vídeo/texto na
Página, mapeamento de erros e a liberação do canário multi-provider.
