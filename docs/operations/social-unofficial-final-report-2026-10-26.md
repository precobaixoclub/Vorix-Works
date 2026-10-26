# Vorix Marketing — relatório da rodada de providers não oficiais

Relatório histórico da publicação `f90ef1d`, preservado aqui para versionamento. Os commits e
resultados abaixo se referem àquela rodada, anterior à integração do Radar de Sentimento.

Código publicado em 26/10/2026. Os três adapters estão registrados, habilitados e selecionados
pelas policies padrão. Os providers oficiais permanecem preservados e desligados por padrão.

`PASS` de código significa validação automatizada, contratos, integração com o motor existente e
fixtures em Chromium. Não significa publicação comprovada na rede. O smoke em produção abriu
somente as telas públicas de login, sem autenticar ou publicar. A conclusão funcional está parcial
até o proprietário conectar contas de teste e validar os recursos realmente expostos por cada conta.

```text
PRODUCTION_COMMIT_BEFORE = aca906c21f58913dad80e123aa30333bdaa257ed
PRODUCTION_COMMIT_AFTER = f90ef1d6f7d4dc150639f31c803b378d25458071
UNOFFICIAL_PROVIDER_REQUIREMENT = PARTIAL
INSTAGRAM_UNOFFICIAL_CODE = PASS
INSTAGRAM_UNOFFICIAL_REAL = BLOCKED
FACEBOOK_UNOFFICIAL_CODE = PASS
FACEBOOK_UNOFFICIAL_REAL = BLOCKED
TIKTOK_UNOFFICIAL_CODE = PASS
TIKTOK_UNOFFICIAL_REAL = BLOCKED
INSTAGRAM_DEFAULT_PROVIDER = UNOFFICIAL
FACEBOOK_DEFAULT_PROVIDER = UNOFFICIAL
TIKTOK_DEFAULT_PROVIDER = UNOFFICIAL
META_OFFICIAL_DEFAULT = OFF
TIKTOK_OFFICIAL_DEFAULT = OFF
SELF_SERVICE_CONNECT = PASS
SESSION_STORAGE = PASS
SESSION_ENCRYPTION = PASS
TENANT_ISOLATION = PASS
HEALTH_CHECK = PASS
REAUTH = PASS
INSTAGRAM_FEED_IMAGE = IMPLEMENTED
INSTAGRAM_FEED_VIDEO = IMPLEMENTED
INSTAGRAM_CAROUSEL = IMPLEMENTED
INSTAGRAM_STORY_IMAGE = IMPLEMENTED
INSTAGRAM_STORY_VIDEO = IMPLEMENTED
INSTAGRAM_REEL = IMPLEMENTED
FACEBOOK_FEED_IMAGE = IMPLEMENTED
FACEBOOK_FEED_VIDEO = IMPLEMENTED
FACEBOOK_STORY = IMPLEMENTED
FACEBOOK_REEL = IMPLEMENTED
TIKTOK_VIDEO = IMPLEMENTED
TIKTOK_PHOTO = IMPLEMENTED
NATIVE_MUSIC_SEARCH = IMPLEMENTED
NATIVE_MUSIC_SELECTION = IMPLEMENTED
MUSIC_SEGMENT = IMPLEMENTED
EMBEDDED_AUDIO = PASS
COMPOSER = PASS
CALENDAR = PASS
MULTI_NETWORK = PASS
PARTIAL_SUCCESS = PASS
RETRY_SINGLE_DESTINATION = PASS
RECONCILIATION = PASS
PROVIDER_SWITCH = PASS
KILL_SWITCH = PASS
RBAC = PASS
SOCIAL_TESTS = PASS
BACKEND_TESTS = PASS
WEB_TESTS = PASS
BUILD = PASS
ARCHITECTURE_CHECK = PASS
NEW_MIGRATIONS = 0178_social_unofficial_defaults.sql — APPLIED
DEPLOY_STATUS = DEPLOYED_AND_VERIFIED
REMAINING_BLOCKERS = REAL_TEST: BLOCKED_NEEDS_USER — conectar contas de teste, concluir login/MFA e validar publicações, formatos e música nas redes reais.
```

## Escopo dos formatos e música

Os estados `IMPLEMENTED` acima indicam caminhos de execução condicionados aos controles nativos
detectados pelo driver; nenhum deles recebe `REAL_VALIDATED` nesta rodada. Instagram feed video,
Stories, TikTok fotos, música, previews e trecho dependem da disponibilidade na interface da conta.
Sem o controle correspondente, o health check restringe as capabilities e o composer oculta a função.
Só a validação com contas reais poderá confirmar ou exigir ajustes nos seletores atuais de cada rede.

## Evidências de validação

- Backend: 4.145 testes, 4.143 aprovados, zero falhas, dois skips preexistentes que exigem ambiente PostgreSQL/JWT específico.
- Social: 68 testes aprovados, incluindo os três adapters, criptografia, isolamento, gateway privado, migration e integração com outbox/retry/reconciliação.
- Web: 181 testes aprovados; oito E2E aprovados em desktop/celular usando o build de produção.
- Typechecks e builds backend/web aprovados; architecture check aprovado (49 contratos, isolamento e registry).
- API, worker e gateway saudáveis; site HTTP 200; readiness `ready=true`.
- Readiness mantém `status=degraded` porque o check `production_guard` marca `warn` quando produção está habilitada. É um aviso informativo da implementação existente; os checks críticos passaram. O roteador social usa suas policies e kill switches existentes no caminho de outbox/scheduler.
- Smoke real das telas de login de Instagram, Facebook e TikTok aprovado; acesso aos fluxos por outro tenant negado. Todos os fluxos foram cancelados depois da captura; nenhuma SocialAccount foi criada.
- Banco: migration 0178 aplicada, zero pendentes; switches dos três providers `enabled=true`, `approved=true` (autorização interna, sem afirmar validação real); zero SocialAccounts e zero policies explícitas.
- Logs de API, worker, gateway e web: nove valores secretos configurados verificados; zero correspondências, zero headers privados expostos e zero linhas fatal/uncaught/unhandled.
- Backups de código, banco e ambiente com permissão 0600. Limpeza de cache de build e pacotes temporários antigos deixou 5.450 MiB livres; backups preservados.
- Worktree limpa no commit publicado.

## Backup e proveniência

```text
RELEASE_SHA256 = 7d7e640027d74f6d1cb88152783e7a048a57d71b4b22f5ae26b1bf4ff8bde1b9
DEPLOY_LOG = /var/log/vorix-deploy-f90ef1d6f7d4dc150639f31c803b378d25458071-20261026175247.log
CODE_BACKUP = /opt/zuno/deploy_backups/pre-f90ef1d6f7d4dc150639f31c803b378d25458071-20261026175247.tgz
DATABASE_BACKUP = /opt/zuno/deploy_backups/db-pre-f90ef1d6f7d4dc150639f31c803b378d25458071-20261026175247.sql.gz
ENV_BACKUP = /root/.env.zuno.pre-f90ef1d6f7d4dc150639f31c803b378d25458071-20261026175247
REAL_TEST = BLOCKED_NEEDS_USER
```

Conexão para validação real: **Marketing → Integrações → Instagram/Facebook/TikTok → Conectar**.
