# Vorix — Fase 10: Pre-Pilot Hardening do Módulo Conversas

**Objetivo desta fase**: fechar SOMENTE os 6 riscos residuais documentados em
`docs/vorix-visual-qa-producao-fechamento.md` entre o estado atual do frontend
(`PRODUCTION_VISUALLY_READY = YES`) e a homologação física do WhatsApp. Sem redesign, sem
funcionalidade nova, sem Admin/Bastidor, sem escanear QR de verdade.

---

## 1. Home

**Antes**: com `CONVERSATIONS_MODULE_ENABLED=false` (o padrão em produção), a Home chamava
`GET /v1/inbox/metrics` incondicionalmente e mostrava um card de erro cru ("Não foi possível
carregar — Rota não encontrada...") para **todo usuário, sempre** — o achado P1 mais importante da
fase anterior.

**Depois**: a Home consulta `GET /v1/inbox/status` primeiro (sempre disponível, nunca 404) e só
chama `/v1/inbox/metrics` quando `enabled === true`. Com o módulo desligado, o card "Conversas
aguardando" **some** e o grid reflui de 4 para 3 colunas — os outros três widgets (Pipeline
comercial, Tarefas atrasadas, Conteúdos agendados) continuam funcionando de forma totalmente
independente do estado do Inbox (o `error`/`loading` combinados da página não são mais afetados
pelo Inbox quando ele está desligado).

Confirmado ao vivo em produção (conta de QA descartável, `CONVERSATIONS_MODULE_ENABLED=false` real):
zero erros, 3 KPIs renderizados normalmente, sem card de erro. Ver screenshot `fase10-home-scenarioA.png`.

## 2. Feature flag

Distinção preservada explicitamente (código e comentários): feature flag
(`CONVERSATIONS_MODULE_ENABLED`, disponibilidade técnica da plataforma) nunca foi confundida com
entitlement (permissão comercial do plano/tenant) — `GET /v1/inbox/status` reflete só o flag
global; o gate de entitlement (ex.: `ENTITLEMENT_ACCOUNT_READ_ONLY`, já usado noutro lugar do
produto) continua um mecanismo separado, não tocado nesta fase.

## 3. Conversas

**Antes**: abrir Conversas com o módulo desligado disparava `GET /v1/inbox/conversations`, que
404-ava, e caía no branch genérico do `ErrorState` — "Não foi possível carregar" com um botão
"Tentar de novo" que só repetiria o mesmo 404 para sempre.

**Depois**: a página consulta `GET /v1/inbox/status` antes de montar `InboxTab`/`ConnectionsTab`.
Com o módulo desligado, nenhuma chamada a `/v1/inbox/*` é feita — só uma mensagem neutra
("Atendimento por canais indisponível... temporariamente indisponível neste ambiente"), sem prazo
prometido, com CTA "Voltar para Início" (nunca "Tentar novamente", que sugeriria que é um erro
recuperável por retry).

Confirmado ao vivo, desktop e mobile (390px) — ver screenshots `fase10-conversas-scenarioA.png`,
`fase10-final-conversas-mobile.png`.

## 4. SSE — antes/depois

**Antes**: `GET /v1/inbox/stream?workspaceId=...&access_token=<JWT de sessão completo>` — o mesmo
token de longa duração usado em toda a API, exposto em texto puro na URL (logs de proxy/servidor,
histórico do navegador, `Referer` de eventuais requisições subsequentes).

**Depois**: `POST /v1/inbox/stream-token` (autenticado normalmente, por header) emite um token
próprio — 60 segundos de vida, `purpose: "inbox_stream"`, sem uso possível em nenhuma outra rota —
e é ESSE token, nunca o access token normal, que vai na URL: `GET /v1/inbox/stream?workspaceId=...
&stream_token=<token de 60s>`.

## 5. Mecanismo de auth escolhido

Opção B do pedido (token de curta duração emitido sob demanda), com uma camada adicional de
isolamento que a opção B "básica" não previa: o `auth.middleware.ts` agora impõe, nos dois
sentidos —

- um token com `purpose: "inbox_stream"` **só** autentica `GET /v1/inbox/stream`, e **só** quando
  chega via querystring (`stream_token`) — usado via header `Authorization`, em QUALQUER rota
  (inclusive a própria `/stream`), é rejeitado;
- um access token normal (sem `purpose`) **nunca mais** autentica via querystring, em rota
  nenhuma — só header, como sempre foi para as demais ~40 rotas de `/v1/inbox/*` e do resto da API.

Reaproveitado 100% do `JwtPort`/`AuthPort` já existentes (`jwtPort.sign()`/`verify()` já suportavam
payload genérico e TTL configurável) — nenhuma biblioteca nova, nenhuma segunda stack de auth.

Cross-tenant continua coberto pelo mecanismo já existente e já testado (`shouldDeliverInboxNotification`,
Fase 7) — o `stream_token` não precisa carregar `workspaceId` porque o filtro de entrega já
acontece depois, comparando `tenantId`/`workspaceId` do principal com os da notificação.

## 6. Testes de segurança

11 testes novos em `tests/inbox-stream-token-hardening.test.mjs`, usando um `JsonWebTokenJwtAdapter`
real (não um dublê que ignora o token) — a única forma de testar assinatura/expiração/purpose de
verdade:

| Cenário | Resultado esperado | Confirmado |
|---|---|---|
| `GET /inbox/status` com módulo ligado | 200, `enabled:true` | ✅ |
| `GET /inbox/status` com módulo desligado | 200, `enabled:false` (nunca 404) | ✅ |
| `GET /inbox/status` sem token | 401 | ✅ |
| `POST /inbox/stream-token` autenticado | 200, token com `purpose:"inbox_stream"`, `expiresIn:60` | ✅ |
| `POST /inbox/stream-token` sem token | 401 | ✅ |
| Access token normal via `?stream_token=` | 401 (rejeitado, mesmo na rota de stream) | ✅ |
| `stream_token` expirado | 401 | ✅ |
| `GET /inbox/stream` sem token nenhum | 401 | ✅ |
| `stream_token` válido via header, em OUTRA rota | 401 (nunca autoriza nada além do stream) | ✅ |
| `stream_token` válido via header, na PRÓPRIA rota de stream | 401 (só querystring é aceita) | ✅ |
| `isPrincipalAuthorizedForRequest` — matriz completa (função pura) | 8 combinações, todas corretas | ✅ |

Replay do `stream_token` (reuso dentro dos 60s) não foi bloqueado ativamente por decisão consciente:
é um token de leitura (`inbox:read`), TTL de 60s já é curtíssimo, e nenhum single-use/nonce foi
pedido explicitamente — se necessário no futuro, o padrão já suporta adicionar um `jti` + registro
de uso sem mudar a arquitetura.

## 7. Worker

**Antes**: `main()` retornava assim que via `CONVERSATIONS_MODULE_ENABLED=false`, o processo saía
(exit 0, nunca um crash) sem nunca tocar o heartbeat, `restart: unless-stopped` religava — loop
infinito, o estado "esperado" documentado pela Fase 9.1.

**Depois**: o worker permanece vivo, num estado IDLE explícito — heartbeat tocado normalmente
(healthcheck do Docker vê um processo genuinamente saudável, porque ele de fato está), e `GET
/status` (porta interna 9464, `metricsEnabled`) responde `{moduleEnabled:false,
consumersRunning:false, status:"disabled"}`. Quando o módulo está ligado, o mesmo endpoint
distingue `"starting"` (RabbitMQ ainda conectando) de `"running"` (os 4 consumers de pé).

Confirmado ao vivo: `zuno-vorix-worker-1` ficou **Up (healthy)** de forma estável em ambos os
cenários (desligado e ligado), sem nenhum restart — zero entradas novas no `RestartCount` do
container durante toda a validação.

Teste novo (`tests/inbox-worker-disabled-lifecycle.test.mjs`) sobe o **processo real** (não a
função importada) com o módulo desligado e confirma: heartbeat aparece e continua fresco, o
processo não sai sozinho depois de >1s (a prova direta de que não há mais loop), `GET /status`
responde o JSON esperado, e SIGTERM encerra limpo (código 0, log de shutdown — checado em POSIX;
no Windows local o Node não emula SIGTERM como sinal capturável de verdade, então lá só se confirma
que o processo efetivamente encerra, não o código de saída — limitação de plataforma do ambiente
de teste local, não do worker, que roda em Linux/Docker em produção).

## 8. WuzAPI

Investigado (não assumido) antes de qualquer correção: `docker inspect` revelou `FailingStreak:
57350` — o container estava `unhealthy` há mais de 9 dias, mas o `docker exec ... curl
localhost:8080/health` sempre respondeu `{"status":"ok",...}` normalmente. Causa raiz real: a
imagem `asternic/wuzapi` (Debian bookworm) **não tem `wget` instalado** — o healthcheck configurado
(`wget -qO- ...`) falhava com `wget: not found` a cada tentativa, desde sempre, independente do
estado real do serviço. `curl` existe na imagem (`/usr/bin/curl`) — troca simples de comando, mesmo
endpoint, mesma semântica.

Corrigido em `docker-compose.conversas-gateway.yml` e implantado — `docker inspect` confirma
`"Status":"healthy","FailingStreak":0` depois da correção.

**Risco residual, não corrigido nesta fase** (fora de escopo — exigiria um monitor novo):
documentado anteriormente que o WuzAPI não reconecta sozinho ao RabbitMQ após esgotar suas
tentativas iniciais, e seu `/health` não detecta esse estado. Não era a causa do `unhealthy` atual,
mas continua uma lacuna de resiliência separada.

## 9. QR

Três achados reais, todos corrigidos e verificados ao vivo (com `CONVERSATIONS_MODULE_ENABLED=true`
temporário, só para QA — nunca escaneado por telefone físico):

1. **Silêncio quando a geração falhava** (bug documentado na Fase 9.1) — corrigido: `qrError` +
   card "Não foi possível gerar o QR Code." + "Tentar novamente", nunca mais um espaço vazio.
2. **Expiração nunca tratada** — `expiresAt` (já retornado pela API, antes descartado) agora vira
   um timer real; ao expirar, card "Este código expirou" + "Gerar novo QR".
3. **Achado NOVO, encontrado durante a validação ao vivo desta própria fase**: reabrir a tela com
   uma conexão já existente (segunda aba, F5, resume) nunca disparava a busca do QR sozinho —
   ficava preso num spinner infinito (uma variante mais sutil do mesmo bug #1: o fetch só
   acontecia dentro do clique de "Conectar", nunca para uma conexão vinda de
   `useInboxConnections()`). Corrigido com um efeito que busca automaticamente assim que existe
   uma conexão ativa sem QR/erro carregados ainda.

Confirmado ao vivo, os dois caminhos:
- **Caminho de erro real**: uma conexão órfã (efeito colateral de um incidente operacional meu
  durante o deploy desta fase — ver seção "riscos residuais") gerou `WuzAPI reporta sessão não
  autenticada (500): "no session"` — o card de erro genérico + retry apareceu corretamente, nunca
  o payload técnico bruto.
- **Caminho feliz**: conexão nova, QR real gerado e renderizado — imagem quadrada nítida, fundo
  branco com margem de silêncio, dentro do card escuro, proporção correta. Ver
  `fase10c-qr-fresh2.png`.

`connection.status` (`requires_repair`/`logged_out`/`error`) também tratado com copy própria
("a conexão precisa ser refeita"), reaproveitando o mesmo fluxo de QR.

## 10. Health semantics

Tabela de distinção, confirmada linha por linha nesta fase:

| Camada | O que "saudável" significa agora | Nunca confundido com |
|---|---|---|
| Container (`docker ps`) | Processo vivo, healthcheck passando | Módulo habilitado |
| `zuno-vorix-worker-1` | Heartbeat fresco (liveness) | Consumers rodando |
| `GET /status` do worker | `moduleEnabled`/`consumersRunning`/`status` explícitos | — |
| `conversas-gateway-wuzapi-1` | `/health` responde `ok` de verdade | WhatsApp conectado (`connected_users`) |
| `GET /v1/inbox/status` | Flag de plataforma | Entitlement do tenant |

## 11. Runtime — os dois cenários pedidos

**Cenário A** (`CONVERSATIONS_MODULE_ENABLED=false`, o estado real de produção, restaurado ao
final desta fase):
- Home sem erro (3 KPIs, sem card de erro) ✅
- Conversas sem 404 cru (mensagem neutra) ✅
- Worker sem restart loop (`Up`, `healthy`, estável) ✅
- API saudável (`/v1/health` → `ok`) ✅

**Cenário B** (habilitação controlada, só para esta validação):
- Worker inicia consumers (`"conectado ao RabbitMQ, iniciando consumers."`, `GET /status` →
  `consumersRunning:true, status:"running"`) ✅
- RabbitMQ conecta ✅ (log acima + `conversas-gateway-rabbitmq-1` healthy)
- WuzAPI health ✅ (`healthy`, `FailingStreak:0`)
- Endpoint QR responde — os dois casos (sucesso real com imagem, e erro real com retry) ✅
- SSE autentica pelo mecanismo novo — confirmado via captura de rede: `POST
  /inbox/stream-token` chamado, `GET /inbox/stream` usa `stream_token`, **nunca** `access_token` ✅
- Home mostra o KPI de Conversas normalmente quando ligado ✅
- Conversas renderiza o Inbox de verdade (fila viva, filtros, busca) quando ligado ✅

Depois de validado, `CONVERSATIONS_MODULE_ENABLED` foi devolvido a `false` e os containers
reiniciados — confirmado de volta ao estado A (worker `disabled`, Home/Conversas sem erro,
zero regressão), inclusive revalidado em mobile (390px).

## 12. Commits

Quatro, não os quatro sugeridos originalmente — o quarto é um achado real da própria validação
desta fase, não estava planejado de antemão:

1. `112f139` — `fix(inbox): trata módulo desabilitado sem erros na UI e remove access token da
   query string do SSE` (Home, Conversas, `/inbox/status`, `/inbox/stream-token`,
   `auth.middleware.ts`, 11 testes novos)
2. `f01f331` — `fix(inbox): normaliza health do worker desabilitado e do healthcheck do WuzAPI`
   (worker, `docker-compose.conversas-gateway.yml`, 1 teste de lifecycle novo)
3. `b4289bc` — `fix(inbox): trata falhas e expiração de QR no onboarding` (`qr-error.ts`, `ChannelStep`,
   5 testes novos)
4. `777ca41` — `fix(inbox): busca o QR automaticamente ao reabrir o passo Canal com uma conexão já
   existente` (achado ao vivo durante a validação do commit 3, corrigido na hora)

Nenhum misturou CRM/Marketing/Billing/Trial/Onboarding-fora-do-Canal/Product
Analytics/Landing/Admin/Bastidor/Creative Engine.

## 13. Push

Quatro pushes, todos fast-forward puro (confirmados via `git fetch` + contagem de commits antes de
cada um) — nunca force push.

## 14. SHA

```
HEAD local:   777ca4150ffb5f7985cbbe555f39eb8c550d484a
origin/main:  777ca4150ffb5f7985cbbe555f39eb8c550d484a
Produção:     777ca4150ffb5f7985cbbe555f39eb8c550d484a (confirmado via grep direto no código-fonte
               extraído no servidor + validação funcional ao vivo)
```

## 15. Deploy

Dois ciclos completos (código principal via `docker-compose.zuno.yml` + a stack separada
`docker-compose.conversas-gateway.yml`, que vive num diretório diferente — ver riscos residuais),
sempre via `git archive` + backup verificado (`gzip -t`) antes de cada substituição de código.

## 16. Testes

| Suíte | Resultado |
|---|---|
| `tests/inbox-stream-token-hardening.test.mjs` (novo) | 11/11 |
| `tests/inbox-worker-disabled-lifecycle.test.mjs` (novo) | 1/1 |
| `web/tests/inbox-qr-error.test.ts` (novo) | 5/5 |
| Suíte completa de Inbox/Onboarding (103 testes, incluindo os 3 arquivos acima) | 103/103 |
| Suíte completa do backend (`npm run test`, 2838 testes) | 2836/2838 — as 2 falhas
  (`analytics.test.mjs`, `cli.smoke.test.mjs`) são **pré-existentes**, confirmadas via `git stash`
  contra o estado limpo antes desta fase (falham igual sem nenhuma mudança do Fase 10) |
| Frontend (`npm run test`, Vitest) | 30/30 |

## 17. Typecheck

`tsc --noEmit` (backend e frontend) — 0 erros, em cada um dos 4 commits.

## 18. Build

`npm run build` (backend e frontend) — sucesso em cada um dos 4 commits, inclusive o build real do
Docker em produção (2 ciclos).

## 19. Architecture check

`npm run architecture:check` — 9/9 checks (contract-drift de 49 contratos + 6 isolamentos
arquiteturais) passaram depois do commit final.

## 20. Riscos restantes

1. **Incidente operacional próprio, corrigido na hora**: ao recriar o container do WuzAPI pela
   primeira vez, rodei `docker compose -f docker-compose.conversas-gateway.yml up -d` sem
   `--env-file`, e os 3 containers da stack (wuzapi, wuzapi-postgres, rabbitmq) foram recriados
   momentaneamente com credenciais em branco (o env real fica em
   `/opt/conversas-spike/.env.conversas`, um diretório diferente de `/opt/zuno` — não documentado
   em lugar nenhum que eu tenha visto). Corrigido em ~90 segundos com o `--env-file` correto;
   `total_users: 9` no WuzAPI confirmou que nenhum dado foi perdido (Postgres não reaplica
   `POSTGRES_PASSWORD` num volume já inicializado). **Recomendo documentar isso** — o próximo
   operador vai cometer o mesmo erro sem essa informação, e da próxima vez pode não ter a mesma
   sorte de o volume já estar inicializado.
2. **WuzAPI não reconecta sozinho ao RabbitMQ** após esgotar retries, e `/health` não detecta isso
   (achado anterior, não é o que causava o `unhealthy` atual, mas continua aberto).
3. **Replay do `stream_token`** dentro da janela de 60s não é bloqueado ativamente (decisão
   consciente — TTL já curtíssimo, token só de leitura) — se uma política mais estrita for exigida
   antes do piloto físico, o padrão já suporta adicionar single-use sem mudar arquitetura.
4. **`/opt/conversas-spike`** continua existindo como um diretório separado de `/opt/zuno` para os
   env reais do Conversas gateway — funcional, mas operacionalmente frágil (um segundo lugar pra
   lembrar, fora do fluxo de deploy documentado em `docs/deployment.md`).
5. **Container órfão** `conversas-gateway-spike-vorix-postgres-1` (10 dias rodando, do antigo spike)
   — não tocado nesta fase por estar fora de escopo, mas é debris que vale limpar numa próxima
   operação.
6. **Homologação física do WhatsApp** continua não iniciada, como determinado — QR validado só via
   endpoint real + UI real, nunca escaneado por telefone.

## 21. Classificação final

```
HOME_FLAG_SAFE             = YES
CONVERSATIONS_FLAG_SAFE    = YES
SSE_AUTH_HARDENED          = YES
WORKER_DISABLED_HEALTHY    = YES
WUZAPI_HEALTHY             = YES
QR_ERROR_HANDLING_READY    = YES

READY_FOR_PHYSICAL_WHATSAPP_HOMOLOGATION = YES
```

**Justificativa**: todos os seis critérios foram comprovados ao vivo, em produção real, nos dois
cenários (módulo desligado — o estado de produção restaurado ao final — e módulo ligado
temporariamente para QA), incluindo os dois caminhos do QR (sucesso real com imagem, e erro real
com tratamento correto) e a confirmação por captura de rede de que o access token de sessão nunca
mais aparece na URL do SSE. Nenhum P0/P1 novo ficou aberto — os riscos residuais (seção 20) são
either pré-existentes/fora de escopo, ou débito documentado e de baixo risco.

---

Parando aqui, conforme instruído. QR não foi escaneado por telefone físico — aguardando autorização
explícita para a homologação física. Não iniciado Admin/Bastidor.
