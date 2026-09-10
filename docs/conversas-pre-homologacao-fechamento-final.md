# Conversas — Fechamento Final Pré-Homologação (Fase 10.1)

Fase curta e deliberadamente estreita: fechar 7 pendências residuais identificadas na Fase 10
(Pre-Pilot Hardening) **antes** de retomar a homologação física do WhatsApp (que havia sido
iniciada e foi pausada para esta fase). Nenhum redesign, nenhuma feature nova, nenhuma mudança em
CRM/Marketing/Billing/Onboarding/arquitetura geral, nenhum QR escaneado, nenhum dispositivo
conectado, nenhum piloto iniciado.

## 1. DealDetailModal no mobile

Achado real, em duas camadas — a primeira correção não foi suficiente sozinha:

- **Primeira tentativa (commit `3744e8a`)**: `flex-1` no rótulo da aba virou `md:flex-1` (só
  desktop), baseado no diagnóstico da Fase 9.1 de que o texto "espremia". Typecheck limpo, mas
  **reprodução com o componente React real** (não uma réplica em HTML isolado — ver seção 2)
  mostrou que essa mudança não alterava nada visualmente: `scrollWidth === clientWidth` em ambas
  as variantes, em todas as larguras testadas.
- **Causa real, encontrada só ao reproduzir com o componente de verdade**: a aba ativa podia ficar
  **inteiramente fora da área visível** da faixa horizontal `overflow-x-auto` no mobile — com 4
  abas (Resumo/Atividades/Propostas/Timeline) e "Propostas" sendo a 3ª, ela nunca rolava pra a
  visão sozinha. Não era truncamento de texto (`text-overflow`), era a aba inteira invisível até o
  usuário rolar a faixa manualmente — o que na prática se PARECE com "rótulo cortado".
- **Correção real (commit `e8cc3c8`)**: `ref` inline no botão da aba ativa
  (`el?.scrollIntoView({ block: 'nearest', inline: 'nearest' })`). Como é uma função nova a cada
  render, o React a reinvoca sempre que aquele botão é a aba ativa — cobre tanto a montagem inicial
  (o `Dialog`/Portal do Radix monta depois do primeiro efeito da árvore, por isso um `useEffect`
  sozinho testado antes chegava tarde) quanto a troca de aba por clique.
- **Correção de permissão (commit `8e3f828`)**: sem relação com este item, mas descoberta no meio
  do processo de deploy — ver seção 6.

## 2. Reprodução visual (metodologia)

Sem acesso a uma conta de produção real (para não tocar CRM/dados de cliente, conforme escopo),
a verificação foi feita com o **componente React real** (`DetailModal.tsx`, não uma réplica HTML)
renderizado localmente via uma rota temporária (`web/app/scratch-detailmodal-preview-qa/`, dados
fixos, nenhuma chamada de API), com o cookie `zuno_refresh_token` (só a presença é checada pelo
`proxy.ts`, nunca o valor) setado para passar pelo portão de navegação sem precisar de login real.
Medido e capturado via Playwright em 360px, 390px e 1280px. **A rota temporária foi removida antes
de cada commit** — `git status` confirmado limpo em cada um dos 6 commits desta fase.

Uma primeira tentativa de reprodução (réplica HTML isolada com Tailwind via CDN, 3 abas curtas) NÃO
reproduziu o bug — por isso a investigação foi refeita com o componente de verdade, que revelou a
causa real descrita na seção 1. Isto está documentado aqui porque a honestidade do processo importa
tanto quanto o resultado: a primeira correção parecia certa, checou tipagem, mas não era real.

## 3. Teste RabbitMQ/WuzAPI (runtime real de produção)

Executado contra o stack real (não simulado):

1. `docker stop conversas-gateway-rabbitmq-1` às `15:14:05Z`.
2. WuzAPI tentou reconectar 10 vezes, ~3s de intervalo, log `attempt=1..10`, culminando em
   `"Failed to reconnect to RabbitMQ after all retries"` às `15:14:35Z` — ~30s, exatamente como o
   `max_retries=10` sugeria.
3. `docker start conversas-gateway-rabbitmq-1`, confirmado `healthy` em poucos segundos.
4. WuzAPI **não** reconectou sozinha — confirmado lendo o log até `15:15:07Z`+ sem nenhuma nova
   linha de RabbitMQ.

## 4. Comportamento real de reconnect

`WUZAPI_RABBITMQ_RECOVERY = REQUIRES_RESTART`. Confirmado que `docker restart
conversas-gateway-wuzapi-1` reconecta na tentativa 1 em ~2s
(`"RabbitMQ connection established successfully" attempt=1`). Não existe configuração nativa de
retry na imagem `asternic/wuzapi` (variáveis de ambiente do container auditadas: só
`RABBITMQ_URL`/`RABBITMQ_QUEUE`; sem documentação embarcada relevante).

## 5. Mitigação adotada

Opção 3 da ordem de preferência do escopo (opção 1 — config nativa — não existe; opção 2 — restart
controlado por health — não é possível porque não há sinal de health de RabbitMQ, ver seção 6):
`scripts/wuzapi-rabbitmq-watchdog.sh`, cron no host (`*/5 * * * *`), somente leitura de `docker
logs` + `docker restart` quando necessário (nunca um serviço novo, nunca `docker.sock` dentro de
container). **Validado de ponta a ponta contra uma queda real**: detectou a falha, reiniciou,
WuzAPI reconectou, e confirmado idempotente (não reinicia à toa quando já saudável) rodando o
script de novo depois. Log em `/var/log/wuzapi-watchdog.log`.

## 6. Health

`GET /health` da WuzAPI não tem nenhum campo de conectividade RabbitMQ — fica `{"status":"ok"}`
durante toda a queda testada. `/status` e `/metrics` não existem (404). **Limitação real, documentada
honestamente**: não há como a plataforma saber, via a própria WuzAPI, se ela está conectada ao
RabbitMQ — só via o watchdog (log-grep) ou observação manual.

## 7. Env-file

`scripts/conversas-gateway-ctl.sh` — único jeito suportado de operar o gateway a partir de agora
(`up`/`recreate`/`restart`/`logs`/`ps`/`health`/`down`), injeta `--env-file
/opt/conversas-spike/.env.conversas` automaticamente e recusa rodar se o arquivo não existir.
Elimina a dependência da memória do operador sem mover nenhum segredo real de lugar.

## 8. Fluxo de deploy

`docs/conversas-runbook.md` atualizado: tabela com um comando único por operação (subir, recriar,
restart, logs, health, parar, verificar worker), seção nova sobre o watchdog automático, e a seção
4 (RabbitMQ caiu) deixando explícito que a WuzAPI não reconecta sozinha, diferente do
worker/API.

## 9. `/opt/conversas-spike`

**Decisão: MAINTAIN, não CONSOLIDATE.** Auditoria encontrou que `/opt/conversas-spike` é um
checkout completo e separado do repositório inteiro (próprio `node_modules`, `src`, `web`, compose
files, package.json — última alteração 31/ago), não só uma pasta de env-file. Confirmado que:

- Nenhum processo roda a partir de lá (`ps aux` vazio para o diretório).
- Nenhum container ativo tem `working_dir` apontando pra lá (depois da remoção do órfão — seção 10).
- O único arquivo genuinamente em uso pela stack real é `.env.conversas`.

Migrar esse arquivo para dentro de `/opt/zuno` reduziria a superfície de risco, mas **qualquer
migração de segredo real carrega algum risco** (permissões, timing, um comando digitado errado) —
e o wrapper da seção 7 já elimina o risco operacional do dia a dia sem precisar mover nada. Por
instrução explícita desta fase ("se consolidar carregar QUALQUER risco, manter como está e só
documentar. Nenhuma migração antes da homologação física"), a decisão é manter, com este documento
como registro do porquê.

## 10. Container órfão

`conversas-gateway-spike-vorix-postgres-1` — investigado por completo antes de qualquer decisão:

- Criado pelo projeto compose `conversas-gateway` a partir de
  `docker-compose.conversas-gateway.yml` + `docker-compose.conversas-gateway.spike.yml` (overlay),
  `working_dir=/opt/conversas-spike`, serviço `spike-vorix-postgres`, rodando desde 31/ago.
- **Não referenciado** pelo compose real em produção (`/opt/zuno/docker-compose.conversas-gateway.yml`
  não define esse serviço).
- Senha documentada no próprio `.env.conversas` como "spike da Fase 2, nunca em produção...
  descartável... nunca o zuno-postgres real".
- **Zero conexões reais em 10 dias** — a única conexão encontrada em `pg_stat_activity` foi a minha
  própria consulta diagnóstica.
- Schema completo (127 tabelas) mas só **109 linhas no total** — fixtures de teste, não dado real.
- Volume: `spike_vorix_postgres_data`, dedicado, sem overlap com o Postgres real da WuzAPI.

**Decisão, com aprovação explícita do usuário após apresentação da evidência**: removido. Backup
completo tirado e validado (`gzip -t` OK) **antes** da remoção — ver seção 11. Confirmado depois da
remoção que o stack real (`wuzapi`, `wuzapi-postgres`, `rabbitmq`) segue saudável e intocado.

## 11. Backups

- `pg_dump` do banco órfão antes da remoção:
  `/opt/backups/orphan-spike-vorix-postgres/vorix_spike-20260910T151801Z.sql.gz` — integridade
  `gzip -t` confirmada, sanidade de conteúdo conferida (127 `CREATE TABLE`, dump válido do
  PostgreSQL 16).
- 3 snapshots completos de `/opt/zuno` em `deploy_backups/` (um por deploy desta fase, timestamps
  `20260910152405`, `20260910154121`, `20260910154509`), todos com integridade `gzip -t` confirmada
  antes de qualquer substituição de código.

## 12. Commits

6 commits, cada um com um único assunto:

| Commit | Assunto |
|---|---|
| `3744e8a` | `fix(ui)` — primeira tentativa no rótulo da aba (insuficiente sozinha, ver seção 1) |
| `e3953d2` | `fix(infra)` — wrapper `conversas-gateway-ctl.sh` |
| `2ce5636` | `fix(inbox)` — watchdog WuzAPI↔RabbitMQ |
| `0491c63` | `docs` — runbook atualizado |
| `e8cc3c8` | `fix(ui)` — correção real do scroll da aba ativa (ver seção 1) |
| `8e3f828` | `fix(infra)` — bit executável dos dois scripts novos (achado no meio do deploy — ver seção 13) |

## 13. Push

Todos os 6 commits enviados com `git push origin main` normal — sem force push em nenhum momento.
Cada push conferido antes (`git fetch` + contagem de commits à frente/atrás, sempre fast-forward
puro) e depois (`git rev-parse HEAD` == `git rev-parse origin/main`).

## 14. Deploy

2 deploys completos (rebuild + restart de `zuno-api`/`zuno-web`/`vorix-worker`) + 1 re-sync leve
(sem rebuild, porque o commit `8e3f828` só mudava permissão de arquivo de script, fora do contexto
de build de qualquer imagem). Cada deploy seguiu `docs/deployment.md` à risca: `git archive` (nunca
tar da working tree crua), backup verificado no servidor antes de qualquer substituição, extração,
rebuild quando havia mudança de código, checagem de saúde. **Achado no meio do processo**: os dois
scripts novos foram commitados sem o bit `+x` (100644) — o primeiro deploy os reextraiu sem
permissão de execução, gerando `Permission denied` ao tentar rodar `conversas-gateway-ctl.sh`.
Corrigido com `chmod +x` imediato no servidor + `git update-index --chmod=+x` + commit `8e3f828`,
para que o próximo `git archive` já preserve a permissão (sem isso, o mesmo problema voltaria no
próximo deploy). SHA final confirmado idêntico em HEAD local / `origin/main` / `/opt/zuno` (deploy):
`8e3f828`.

## 15. Testes

- `web`: `npx tsc --noEmit` limpo; `npx vitest run` — 30/30 (5 arquivos).
- Backend relevante (Conversas/inbox/CRM-integração/messaging): 89/89 testes, 0 falhas
  (`inbox-stream-token-hardening`, `inbox-worker-disabled-lifecycle`, `inbox-persistence`,
  `inbox-attendance`, `inbox-attendance-http`, `inbox-ai-responder`, `inbox-resilience`,
  `inbox-security-hardening`, `inbox-migrations-clean-run`, `messaging-provider-capabilities`,
  `crm-conversas-integration`).
- `npm run architecture:check` (raiz): build limpo + 49 contratos verificados + 7 checks de
  isolamento arquitetural (979 arquivos cada), todos OK.
- `web`: `npm run build` limpo, sem erros.

## 16. Riscos remanescentes

- **`CONVERSATIONS_MODULE_ENABLED=true`** já está ativo em produção — resquício do início da
  homologação física que foi pausado para esta fase (não desligado nem religado por mim; encontrado
  já assim). Worker conectado ao RabbitMQ, consumidores ativos, `AI_INBOX_AUTO_REPLY_ENABLED=false`.
  Como a homologação física é o próximo passo natural (não abandonado, só pausado), deixei como
  está — sinalizando aqui em vez de decidir silenciosamente.
- Janela de detecção do watchdog: até 5 minutos entre uma queda de RabbitMQ e o restart automático
  da WuzAPI (intervalo do cron). Mensagens outbound não se perdem nessa janela (ficam `queued`);
  inbound depende da WuzAPI já estar recebendo do WhatsApp normalmente.
- `/opt/conversas-spike` continua existindo como checkout separado e desatualizado — mantido por
  decisão (seção 9), não é mais um risco operacional do dia a dia graças ao wrapper, mas é uma
  fonte de confusão para quem explorar o servidor sem este documento.
- Container `zuno-zuno-web-1` não tem `HEALTHCHECK` Docker definido (`docker ps` mostra só "Up",
  sem "(healthy)") — pré-existente, fora do escopo desta fase, mas vale registrar.

## 17. Classificação final

```
DEAL_MODAL_MOBILE_POLISH = YES
WUZAPI_RABBITMQ_RECOVERY = REQUIRES_RESTART
GATEWAY_DEPLOY_SAFE = YES
ENV_OPERATION_DOCUMENTED = YES
ORPHAN_CONTAINER_RESOLVED = YES
STACK_HEALTH_CLEAR = YES
READY_FOR_PHYSICAL_WHATSAPP_HOMOLOGATION = YES
```

Depois PARE. Não iniciar homologação física.
