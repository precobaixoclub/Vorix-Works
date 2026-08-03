# Upload de mídia para posts (TikTok/Instagram/Facebook)

TikTok e Meta puxam a mídia por URL pública (`PULL_FROM_URL`/Graph API) — não existe "anexar
arquivo" na API deles. Este upload resolve o outro lado: o cliente envia uma foto/vídeo direto do
computador, a Vorix hospeda num bucket compatível com S3 e devolve a URL pública que os formulários
de post (TikTok/Instagram/Facebook) usam nos campos `videoUrl`/`imageUrls`.

Escopo deliberadamente estreito: isto **não** é a Asset Library (biblioteca de marca do workspace,
só metadados até hoje) nem o Media Catalog (mídia de campanha já resolvida pelo motor de conteúdo).
Reconciliar os três é uma decisão adiada em outras sprints — este endpoint não a reabre, só resolve
"preciso de uma URL pública para publicar agora".

## 1. Escolher o provider S3-compatível

Qualquer um funciona sem mudar código, só variáveis de ambiente:

| Provider | `OBJECT_STORAGE_ENDPOINT` | `OBJECT_STORAGE_REGION` | `OBJECT_STORAGE_FORCE_PATH_STYLE` | Observação |
|---|---|---|---|---|
| Cloudflare R2 | `https://<account-id>.r2.cloudflarestorage.com` | `auto` | `true` | Sem ACL por objeto — configure "Public Access" no bucket ou um custom domain e preencha `OBJECT_STORAGE_PUBLIC_BASE_URL`. |
| DigitalOcean Spaces | `https://<region>.digitaloceanspaces.com` | região do datacenter (ex.: `nyc3`) | `true` ou `false` | Aceita `OBJECT_STORAGE_ACL=public-read`. Mesma conta do droplet — menor fricção. |
| AWS S3 | vazio | região real (ex.: `us-east-1`) | `false` | Contas novas bloqueiam ACL pública por padrão ("Block Public Access") — ajuste a bucket policy para leitura pública, ou use `OBJECT_STORAGE_ACL=public-read` só se o bucket permitir. |

## 2. Variáveis de ambiente

```bash
OBJECT_STORAGE_ENABLED=true
OBJECT_STORAGE_ENDPOINT=...          # vazio para AWS S3 real
OBJECT_STORAGE_REGION=auto
OBJECT_STORAGE_BUCKET=vorix-media
OBJECT_STORAGE_ACCESS_KEY_ID=...
OBJECT_STORAGE_SECRET_ACCESS_KEY=...
OBJECT_STORAGE_PUBLIC_BASE_URL=...   # recomendado com R2 (custom domain)
OBJECT_STORAGE_FORCE_PATH_STYLE=true
OBJECT_STORAGE_ACL=                  # "public-read" em S3/Spaces; vazio no R2
MEDIA_UPLOAD_MAX_BYTES=100000000     # 100MB
```

## 3. Endpoint

| Método | Rota | Permissão |
|---|---|---|
| `POST` | `/v1/publication-media/upload?workspaceId=` | `publication:create` |

Requisição `multipart/form-data` com um único campo de arquivo. Tipos aceitos: `image/jpeg`,
`image/png`, `image/webp`, `video/mp4`, `video/quicktime`. Resposta:

```json
{ "url": "https://cdn.exemplo.com/tenant-1/workspace-1/9f2c...-uuid.jpg", "contentType": "image/jpeg", "sizeBytes": 482318 }
```

O `url` retornado é colado direto nos campos `videoUrl`/`imageUrls` do `POST /v1/tiktok/posts` ou
`POST /v1/instagram/posts` — o painel já faz isso automaticamente ao usar o seletor de arquivo em
vez de colar uma URL.

Sem `OBJECT_STORAGE_ENABLED=true` configurado, o endpoint responde `501 NOT_IMPLEMENTED` com uma
mensagem clara em vez de tentar subir para um bucket inexistente.

## 4. Testes

```bash
npm run test:media-upload
```

Cobre resolução de URL pública para os três estilos (custom domain, path-style, virtual-hosted,
AWS S3 default), o fail-closed do storage desabilitado, upload bem-sucedido, tipo rejeitado (400) e
autenticação obrigatória (401).
