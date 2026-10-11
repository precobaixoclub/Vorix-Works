# Release hardening — operação do Vorix

Para quem opera produção (deploy, incidentes, liberação de clientes). Estado a partir de 2026-10-11.

## 1. Arquivos do storage (`/uploads`) — privado por padrão

**Regra:** nenhum arquivo é lido só por conhecer a URL. `https://api.vorixworks.com/uploads/<key>` serve:

| Acesso | Quando | Cache |
|---|---|---|
| URL assinada (`?exp=&sig=`) | HMAC-SHA256 sobre a chave + expiração; escopo de UMA chave; validade curta | `private, max-age=900` |
| Objeto público explícito | chave em `public_objects` (migration 0140) com `reason` persistido | `public, max-age=3600` |
| Qualquer outro caso | sem assinatura, expirada, adulterada, traversal, symlink fora da raiz, inexistente | **404** (nunca revela existência) |

A URL canônica persistida (tabelas, JSON de execuções, `storage_ref.metadata.url`) continua sendo o
**identificador** — nunca uma credencial. Quem precisa ler assina no momento do uso:

| Consumidor | Validade | Onde |
|---|---|---|
| Navegador (respostas JSON autenticadas) | 1 h | `object-url-access.ts` — só chaves que o usuário pode ler |
| `POST /v1/files/sign` (reabrir algo expirado) | 1 h | 404 para chave de outro tenant/workspace |
| Download interno do backend (motor, legado, Satori, Kwai, YouTube) | 10 min | `signOwnedUrl` nos `fetchAsBuffer` |
| OpenAI vision (`image_url`) | 15 min | providers OpenAI |
| Publicação externa (Instagram, Facebook, TikTok, Meta Ads) | 24 h | `signForExternalPublication` |

Quem pode ler uma chave (`classifyObjectKeyOwner` + `createObjectKeyReadAuthorizer`):
- `assets/<tenant>/<workspace>/…` e `<tenant>/<workspace>/…`: o tenant do usuário, e o workspace precisa pertencer a ele;
- `ai-generated|gpt-creative-engine|product-assets|ghost-text-recheck|gpt-creative-prototype/<tenant>/…`: o tenant do usuário;
- `qa-assets/…`: só tenants da allowlist de QA/rollout;
- qualquer outra chave: ninguém.

Chave de assinatura: derivada do `JWT_SECRET` (HMAC com rótulo fixo) ou `OBJECT_URL_SIGNING_SECRET`, se
definido. Trocar o segredo invalida as URLs assinadas em circulação (o frontend recebe novas no próximo
carregamento). Logs registram o MOTIVO de cada negação (`uploadsAccessDenied`), nunca a chave nem a assinatura.

Para tornar um arquivo público de propósito (ex.: página compartilhável): inserir em `public_objects`
com `tenant_id`, `workspace_id` e `reason`. Remover a linha volta a torná-lo privado.

Driver S3: a assinatura só vale para o storage servido por esta API (driver `local`, o de produção). Com
S3, a privacidade depende da ACL do bucket — usar bucket privado + URL pré-assinada antes de migrar.

## 2. Deploy e rollback

Procedimento oficial (nunca mais scripts avulsos):

```sh
# no host, como root, com o tarball do commit (git archive) em /tmp
sh /opt/zuno/scripts/deploy/deploy-production.sh /tmp/zuno-<sha>.tgz <sha> api   # zuno-api + vorix-worker
sh /opt/zuno/scripts/deploy/deploy-production.sh /tmp/zuno-<sha>.tgz <sha> web   # zuno-web
```

O script faz:
1. backup de código, `.env.zuno` e banco (`pg_dump`, em `deploy_backups/`);
2. marca as imagens atuais com `:rollback-<stamp>`;
3. troca o código conferindo o hash do `.env`;
4. **build sequencial** — o build conjunto web+api+worker estoura a memória do host, então nunca use `docker compose up --build` com os três;
5. sobe os serviços;
6. aplica migrations, abortando se houver `CHECKSUM DIVERGENTE`;
7. confere health, `/readyz`, web 200 e logs.

Se qualquer passo falhar, faz **rollback automático**. O log fica em `/var/log/vorix-deploy-<sha>-<stamp>.log`.

Rollback manual (sem rebuild): `sh scripts/deploy/rollback-production.sh <stamp> [api|web|all]`.

O banco nunca é revertido: as migrations são aditivas, e o dump existe para desastre.

## 3. Gate de release (Linux é a autoridade)

```sh
sh scripts/ci/linux-release-gate.sh <dir-com-o-código> <rótulo>
```

Roda num container descartável igual à imagem de produção (fontes do renderer + FFmpeg oficial), sem segredos, e executa typecheck, build, architecture:check e `npm test`. O build limpa `dist/` (`build:clean`), para que módulos removidos nunca mascarem testes.

## 4. FFmpeg do runtime Linux

O binário Linux do `ffmpeg-static` não tem `drawtext`, que exige libharfbuzz desde o FFmpeg 6.1. A imagem instala `jellyfin-ffmpeg 7.0.2-9` portable em `/opt/vorix/ffmpeg/ffmpeg` (`scripts/install-ffmpeg-linux.sh`, versão fixa + sha256 + checagem de `drawtext`/`text_align`). `resolveFfmpegBinaryPath` prefere esse caminho constante no Linux.

## 5. Leituras de texto por visão do motor

O scan de texto da base e o inventário do screenshot usam o `visionTextBrain` (gpt-4.1). O gpt-4o recusava de forma sistemática transcrever texto de algumas bases. Recusas aparecem em `icaro_ai_call_errors` como "OpenAI recusou a tarefa…". Uma leitura que não conclui ganha 2 novas tentativas espaçadas (15 s/30 s); depois disso fica `NOT_AVAILABLE` (falha fechada).

## 6. Liberação do Creative Engine editorial para clientes (rollout)

Flag técnica não é entitlement. O motor editorial aprovado só roda quando **todas** valem:
- `CREATIVE_ENGINE=gpt`;
- `CREATIVE_ENGINE_EDITORIAL_EXPERIMENTAL_ENABLED=true`;
- o par `tenantId:workspaceId` está em `CREATIVE_ENGINE_EDITORIAL_QA_ALLOWLIST`;
- a execução foi iniciada por um usuário confiável com `execution:start` naquele tenant.

| Etapa | Como |
|---|---|
| 1. Interno/QA (atual) | allowlist só com o workspace de QA |
| 2. Allowlist pequena | adicionar `tenantId:workspaceId` do cliente à allowlist e fazer deploy/restart do `zuno-api`; acompanhar `creative_engine_runs` (status, `error_code`, `estimated_cost_usd`) |
| 3. GA | exige mudança explícita de código/flag (hoje não existe "todos os tenants"); só depois de semanas estáveis na etapa 2 |

Custos: teto de US$ 0,60 por execução (`maxBudgetUsd`, o pipeline para antes de qualquer chamada nova). Breakdown por etapa persistido em `creative_engine_runs.cost_breakdown`:
- diretor;
- exploração;
- imagem;
- scan da base;
- inventário do screenshot;
- gate técnico;
- score visual;
- reparo.

## 7. Onde olhar quando algo falha

| Sintoma | Fonte |
|---|---|
| Quota/crédito da OpenAI | `creative_engine_runs.error_code = PROVIDER_QUOTA_EXHAUSTED`; `icaro_ai_call_errors` |
| Recusa do provedor | `icaro_ai_call_errors.message` "OpenAI recusou a tarefa…" |
| Falha de imagem | `error_code = IMAGE_GENERATION_FAILED` / `IMAGE_DOWNLOAD_FAILED` |
| Scan da base | `artifact_provenance.baseTextDiagnostic.status/reason` |
| Inventário do screenshot | `artifact_provenance.screenshotTextInventory.status/reason/gateDecision` |
| Quality gate | `quality_gate.issues`, `textDiagnostics`, `occurrenceDiagnostics` |
| Storage | `error_code = EDITORIAL_ASSET_DOWNLOAD_FAILED` / `EDITORIAL_BASE_IMAGE_PERSIST_FAILED` |
| Acesso negado a arquivo | log `uploadsAccessDenied` (motivo) |
| Asset de outro tenant | política de reference assets (`ownership_mismatch`); rotas respondem 404 |
| Worker | healthcheck por heartbeat (`zuno-vorix-worker-1`) |

## 8. Dívida de testes — classificação dos 7 vermelhos históricos

| Teste | Classe | Causa | Resolução |
|---|---|---|---|
| 4× ffmpeg/MP4 | C (dependência de ambiente) | o binário Linux do `ffmpeg-static` não tem `drawtext` (exige harfbuzz desde o 6.1) | FFmpeg oficial instalado na imagem/gate (seção 4) — **corrigido** |
| action-registry `narration_invalid` | E (contrato mudou) | a única ação é a voz Windows SAPI, declaradamente só-Windows; o teste exigia candidato aplicável em qualquer SO | cobertura × aplicabilidade × limitação de plataforma testadas separadamente — **corrigido** |
| instagram-dm-persistence | B (teste obsoleto) | importava repositórios removidos em c7d771b; "passava" no Windows por `.js` velhos em `dist/` | build limpa `dist/`; testes do que ainda existe — **corrigido** |
| CLI LOCAL_PRODUCTION | A (bug) + capacidade | o pedido "6 segundos" era ignorado (vídeo de 30 s); no Linux também faltava `drawtext` | duração extraída do pedido (render 30,6 s → 12,7 s no Windows); FFmpeg corrigido — ver abaixo |

**Limitação de capacidade documentada (reproduzível):** o caso `CLI: LOCAL_PRODUCTION resolve assets
visuais…` faz um render REAL de vídeo 1080×1920/30 fps, com no máximo 60 s por etapa do CLI. Ele passa no
Windows de desenvolvimento (12,7 s isolado; suíte completa verde). No host de produção usado como gate
(2 vCPUs compartilhadas com os serviços no ar), todo render de vídeo é cerca de 4,5× mais lento — medido nos
próprios testes do adaptador: 4,9 s × 1,1 s, 13,7 s × 2,9 s e 16,0 s × 3,3 s. Mesmo isolado, a etapa leva
75 s. O renderizador de vídeo é ferramenta do CLI local (não roda em API/worker de produção). O orçamento
de 60 s não foi aumentado nem o teste foi pulado: é falha de capacidade do host, não de código.

Reprodução:

```sh
docker run --rm -v <código>:/app -w /app node:20.20.2-slim sh -c "apt-get update && apt-get install -y fontconfig ca-certificates curl xz-utils && sh scripts/install-ffmpeg-linux.sh && node --test --test-name-pattern='LOCAL_PRODUCTION resolve assets' tests/cli.smoke.test.mjs"
```

## 9. Backlog de qualidade (não bloqueia release)

- Uso do canvas em 9:16 (faixas de respiro).
- Intensidade do perfil tech/bold em 9:16.
