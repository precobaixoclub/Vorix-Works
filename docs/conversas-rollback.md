# Módulo Conversas — Rollback

**Regra geral: rollback do Vorix nunca pode derrubar/revogar a sessão do WhatsApp no WuzAPI.**
WuzAPI/RabbitMQ/Postgres dedicado vivem em `docker-compose.conversas-gateway.yml`, um deploy
independente — reverter o Vorix (API/Web/worker) nunca toca nesse stack.

## Frontend (`web/`)

- Reverter para a imagem/build anterior de `zuno-web`. Sem estado local relevante (a Inbox lê tudo
  via API) — rollback é seguro a qualquer momento, sem procedimento especial.

## API (`zuno-api`)

- Reverter para a imagem anterior. Se a versão anterior não conhece uma coluna/tabela nova
  (migration aditiva já aplicada), isso é seguro **desde que a migration seja aditiva** (ver
  seção Migrations abaixo) — código antigo simplesmente ignora colunas que não usa.
- Kill switch imediato sem rollback de código: `CONVERSATIONS_MODULE_ENABLED=false` — remove as
  rotas `/v1/inbox/*` sem precisar reverter a imagem.

## Worker (`vorix-worker`)

- Reverter para a imagem anterior. Mensagens em processamento no momento do rollback seguem a
  mesma garantia de sempre: nunca `ack`adas antes de persistir, então uma redelivery após o
  restart é segura (ver `docs/conversas-runbook.md`, seção 3).
- Se o rollback for para uma versão ANTES da Fase 7 (sem o claim `queued→sending`): mensagens que
  ficaram em `sending` no banco (deixadas pela versão nova) não são reconhecidas pelo código antigo
  — ele só verifica `status !== 'queued'` e as ignora, então elas ficam paradas até o próximo
  forward-roll. Não são perdidas, só não avançam sozinhas nesse intervalo. Documentar isso ao time
  de plantão se um rollback dessa profundidade for necessário.

## Gateway (WuzAPI/RabbitMQ/Postgres dedicado)

- **Nunca faz parte de um rollback do Vorix** — arquivo compose e ciclo de deploy próprios. Se o
  incidente é especificamente no gateway, ver `docs/conversas-runbook.md` (seções 1–4), não este
  documento.

## Migrations

- Todas as migrations do módulo Conversas são **aditivas** (novas tabelas/colunas/índices,
  nenhuma remove ou renomeia coluna existente) — reverter o código da aplicação para uma versão
  anterior nunca exige reverter o schema. **Nunca rode um `down` de migration como parte de
  rollback** — o padrão deste repositório não tem migrations reversíveis, e forçar isso é mais
  arriscado do que deixar colunas novas não utilizadas por uma versão de código mais antiga.
- Se uma migration realmente precisar ser desfeita (caso raro, ex.: índice causando lock
  inesperado em produção): escrever uma NOVA migration que remove o objeto problemático — nunca
  editar/apagar o arquivo de migration já aplicado (o runner trava por checksum; editar um arquivo
  já aplicado quebra a verificação em todo ambiente que já rodou a versão original).

## Feature flag

- `CONVERSATIONS_MODULE_ENABLED=false` é sempre o rollback mais rápido e seguro disponível — não
  requer redeploy de imagem, só reiniciar API/worker com a variável trocada. Use isto primeiro
  enquanto decide se um rollback de código é realmente necessário.

## Checklist de rollback

1. `CONVERSATIONS_MODULE_ENABLED=false` (contém o impacto imediatamente, sem tocar em imagem).
2. Decidir se é preciso reverter código (bug na lógica) ou só a flag resolve (comportamento
   inesperado de uma feature específica).
3. Se reverter código: API e worker podem reverter em momentos diferentes (não são atômicos entre
   si) — mensagens em voo continuam seguras pelas garantias de idempotência/ACK manual já descritas.
4. Nunca reverter migrations. Nunca tocar no compose do gateway.
5. Confirmar depois: `GET /v1/system/health`, fila DLQ vazia, nenhuma mensagem presa em estado
   inesperado.
