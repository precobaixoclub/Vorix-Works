# Publicação no Kwai (conta por cliente)

> **Aviso importante**: diferente dos docs de TikTok/Instagram/Facebook, esta integração **não foi
> verificada contra um app registrado de verdade** no Kwai. Os endpoints/parâmetros abaixo vêm de
> pesquisa em dois repositórios públicos que concordam entre si — o SDK server-side oficial
> ([`KwaiOpen/KwaiOpenSDK`](https://github.com/KwaiOpen/KwaiOpenSDK), autores `@kuaishou.com`) e o
> doc de autorização do [`KwaiVideoTeam/kuaishou-liveopen-api`](https://github.com/KwaiVideoTeam/kuaishou-liveopen-api)
> — mas o SDK não recebe commit de código desde **abril de 2022**. Antes de habilitar em produção,
> registre um app em `open.kuaishou.com/platform/openApi` e teste o fluxo completo com uma conta
> real. Se algo não bater com o que está aqui, o portal do Kwai é a fonte de verdade, não este doc.

Cada cliente (tenant + workspace) conecta a própria conta do Kwai pelo painel. O token fica isolado
no secret store; a credential reference guarda só metadados, e a credencial entra na governança com
escopos e auditoria — mesmo padrão do TikTok/Meta.

## Diferenças importantes em relação ao TikTok/Instagram/Facebook

1. **Só vídeo.** A API do Kwai (pelo menos na versão documentada pelo SDK) não tem endpoint de
   imagem/carrossel — só publicação de vídeo curto.
2. **Capa (thumbnail) obrigatória.** Todo post exige uma imagem JPG de capa — não é opcional como
   nas outras redes.
3. **Sem `PULL_FROM_URL`.** TikTok e Meta pedem a URL da mídia e baixam sozinhos. O Kwai **não**
   tem isso: o fluxo é subir os bytes (`start_upload` → upload → `publish`). Como o resto do
   sistema já trabalha com URLs (upload próprio ou colado pelo cliente), o provider baixa o vídeo
   e a capa da URL fornecida e reenvia os bytes pro Kwai — então o comportamento externo (colar uma
   URL, ou usar o upload de mídia) continua igual, só o meio de campo é diferente.
4. **Sem PKCE.** A documentação encontrada não menciona suporte a PKCE no fluxo OAuth (diferente do
   TikTok/Meta) — só `state` para proteção CSRF.
5. **Sem endpoint de revogação remota documentado.** Desconectar aqui só invalida o uso local
   (apaga o secret, marca a credencial como revogada) — a autorização do lado do Kwai só é desfeita
   se o usuário revogar pelo próprio app.

## 1. Criar o app no Kwai/Kuaishou Open Platform

1. Acesse <https://open.kuaishou.com/platform/openApi> e registre um app.
2. Solicite os escopos `user_info` e `user_video_publish`.
3. Cadastre a **Redirect URI** exatamente igual à do painel (`.../kwai/callback`).
4. **Confirme o fluxo completo com uma conta de teste antes de liberar pra clientes reais** — este
   doc não substitui isso.

## 2. Variáveis de ambiente

```bash
KWAI_ENABLED=true
KWAI_APP_ID=...
KWAI_APP_SECRET=...
KWAI_OAUTH_REDIRECT_URI=https://app.seudominio.com/kwai/callback
KWAI_API_BASE_URL=https://open.kuaishou.com

# Publicação real precisa sair do modo sandbox e liberar o provider kwai:
PUBLICATION_PROVIDER_ENVIRONMENT=production
PUBLICATION_PRODUCTION_ENABLED=true
PUBLICATION_CANARY_ENABLED=true
PUBLICATION_CANARY_PROVIDER_IDS=kwai
PUBLICATION_CANARY_TENANT_IDS=*
PUBLICATION_CANARY_WORKSPACE_IDS=*

PUBLICATION_SCHEDULER_ENABLED=true
PUBLICATION_SCHEDULER_INTERVAL_MS=30000
```

## 3. Fluxo de conexão da conta

```
Painel → POST /v1/publication-providers/kwai/oauth/connect  → authorizationUrl
navegador → Kwai (login + consentimento)
Kwai → GET  {KWAI_OAUTH_REDIRECT_URI}?code&state          (página do frontend)
frontend → POST /v1/publication-providers/kwai/oauth/callback { state, code }
```

## 4. Endpoints

| Método | Rota | Permissão |
|---|---|---|
| `GET` | `/v1/publication-providers/kwai/oauth/status?workspaceId=` | `publication:read` |
| `POST` | `/v1/publication-providers/kwai/oauth/connect` | `publication:admin` |
| `POST` | `/v1/publication-providers/kwai/oauth/callback` | `publication:admin` |
| `POST` | `/v1/publication-providers/kwai/oauth/disconnect` | `publication:admin` |
| `GET` | `/v1/kwai/posts?workspaceId=` | `publication:read` |
| `POST` | `/v1/kwai/posts` | `publication:create` |
| `POST` | `/v1/kwai/posts/:id/cancel` | `publication:cancel` |
| `POST` | `/v1/kwai/posts/run-due` | `publication:operate` |

### Publicar um vídeo

```http
POST /v1/kwai/posts
{
  "workspaceId": "workspace-1",
  "caption": "Lançamento da coleção de verão ☀️",
  "videoUrl": "https://cdn.seudominio.com/video.mp4",
  "thumbnailUrl": "https://cdn.seudominio.com/capa.jpg",
  "scheduledAt": "2026-03-01T18:00:00.000Z",
  "timezone": "America/Sao_Paulo"
}
```

`videoUrl` e `thumbnailUrl` são obrigatórios — sem imagem/carrossel. Omitir `scheduledAt` publica
imediatamente. As URLs precisam ser **HTTPS públicas**.

## 5. Como o agendamento dispara

Igual às outras redes: o agendamento é inteiramente controlado pelo nosso scheduler
(`PUBLICATION_SCHEDULER_ENABLED`), que chama `publish()` no horário certo — a API do Kwai não tem
agendamento nativo documentado.

## 6. Publicação no Kwai (mecânica interna)

- `POST /openapi/photo/start_upload` → `upload_token` + `endpoint`.
- Upload dos bytes do vídeo pro `endpoint` retornado — direto se ≤10MB, fragmentado (mesmo limite
  do SDK oficial) se maior.
- `POST /openapi/photo/publish` com `upload_token`, `caption` e a capa (JPG) como arquivo.
- Token expirado/inválido dispara renovação antes de repetir a chamada.

### Mapeamento de erros

| Código do Kwai (`result`) | Resultado |
|---|---|
| `100200102`, `100200108-111`, `100200113`, `100200114` (token/autorização inválidos) | `authentication_failure` |
| `100200301`, `100200410` (rate limit/anti-spam) | `rate_limited` |
| `100200500` (erro interno do Kwai) | `transient_failure` (retry automático) |
| `100200100`, `100200105-107`, `120001-120003` (parâmetro/vídeo inválido) | `permanent_failure` |
| timeout | `unknown_outcome` (vai para reconciliação, sem retry cego) |

## 7. Testes

```bash
npm run test:kwai
```

Cobre OAuth (sem PKCE, com `state` de uso único), upload único e fragmentado, mídia/capa ausente,
renovação de token e mapeamento de erros — tudo com um cliente HTTP mockado (não bate no Kwai de
verdade). Isso valida a lógica interna, **não** confirma que o contrato bate com a API real.
