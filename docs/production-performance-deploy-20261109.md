# Desempenho, celular e equipe padrão — produção em 09/11/2026

Release [`e7a9c922`](https://github.com/precobaixoclub/Vorix-Works/commit/e7a9c922eb3b5ae55130fa91dbc729ba129b83b3), publicada pelo procedimento oficial com alvo `all`. Inclui `c41d48f3` (equipe padrão), `e6d1b0b2` (build do gravador), `90068d50` (modelos no celular) e `e7a9c922` (desempenho).

## Resultado

- `DEPLOYED e7a9c922` e `DEPLOY_DONE`; API `ready: true`, site HTTP 200, zero erros nos logs do deploy.
- Sete contêineres saudáveis, incluindo `meetings-recorder` (perfil `meetings`, ligado para teste).
- 196 migrations, nenhuma pendente. Os logos inline dos dois workspaces foram movidos para o storage no boot da API (`migrated: 2`).

## Medições

Loja CMKV Wears, celular emulado (390 px, 4G, CPU 4×), navegação entre páginas:

| | Antes | Depois |
|---|---|---|
| TTFB | 1,0–1,7 s | 0,24–0,31 s |
| Primeiro conteúdo | 1,4–2,2 s | 0,5–0,7 s |
| `/v1/auth/refresh` por página | 1 | 0 |

Páginas repetidas saem do cache (`x-nextjs-cache: HIT`); expiradas são servidas na hora (`STALE`) e renovadas em segundo plano. Publicar expira o cache da loja imediatamente.

Servidor:

| | Antes | Depois |
|---|---|---|
| `settings` do workspace | ~194 KB | 150–211 bytes |
| Leituras TOAST de `workspaces` | ~2,7 milhões em 7 dias | nenhuma após o deploy |
| CPU do Postgres | 12,8% | 1,0% |
| Memória da API | 300 MB | 153 MB |
| Memória livre / swap | 381 MB / 1.054 MB | 569 MB / 797 MB |

## Validação

- Backend: 4.499 testes aprovados; as 20 falhas são as mesmas da `main` anterior.
- Frontend: 306 testes; e2e de mídia de produto, Bambilu, banner e regras comerciais aprovados.
- Build de produção local: cache por página e expiração imediata ao publicar conferidos.

## Recuperação

Host `143.198.47.74`, diretório `/opt/zuno`.

- Log: `/var/log/vorix-deploy-e7a9c922eb3b5ae55130fa91dbc729ba129b83b3-20261109160503.log`.
- Código anterior: `/opt/zuno/deploy_backups/pre-e7a9c922eb3b5ae55130fa91dbc729ba129b83b3-20261109160503.tgz`.
- Banco anterior (inclui os logos inline): `/opt/zuno/deploy_backups/db-pre-e7a9c922eb3b5ae55130fa91dbc729ba129b83b3-20261109160503.sql.gz`.
- Imagens anteriores: `rollback-20261109160503`, `rollback-20261109005939`, `rollback-20261108225451`.

Para liberar o disco exigido pelo deploy, foram removidos o cache de build, o conjunto de rollback de 07/11 (com autorização) e uma cópia temporária idêntica à release `c41d48f3` já arquivada.

## Pendências

- A foto de perfil do usuário também é salva inline; hoje não pesa, mas deve seguir o mesmo caminho do logo.
- O host tem 2 GB de RAM. O processador de reuniões (`meetings-worker`) segue desligado; transcrição exige mais memória.
