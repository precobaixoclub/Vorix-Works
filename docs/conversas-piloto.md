# Módulo Conversas — Plano de Ativação do Piloto

Documento operacional para a primeira ativação real (pós-Fase 7). Não libera para todos os
tenants de uma vez — expansão é sempre gradual e observada.

## Pré-requisitos (antes de qualquer ativação)

- [ ] Homologação real do WhatsApp concluída (ver `docs/conversas-homologacao-whatsapp.md`) —
      `RUNTIME_VALIDATION_PENDING_QR` fechado.
- [ ] `RUNTIME_VALIDATION_PENDING_BROKER` fechado (RabbitMQ real testado: reconexão, DLQ, SIGTERM).
- [ ] `RUNTIME_VALIDATION_PENDING_POSTGRES_RESTORE` fechado (`pg_dump`/`pg_restore` reais testados).
- [ ] Backup automatizado dos dois Postgres (Vorix + WuzAPI) rodando e com um restore já validado.
- [ ] `docs/conversas-runbook.md` lido por quem está de plantão.

## Passo a passo

1. **Habilitar só o mecanismo, ainda sem tráfego real**
   - **Achado da Fase 7 (seção 21 do escopo)**: `CONVERSATIONS_MODULE_ENABLED` é hoje um único
     booleano global (lido uma vez no boot da API/worker) — NÃO existe granularidade por
     tenant/workspace nele. O único mecanismo comparável já existente no Vorix
     (`ProductionGuard.canaryTenantIds/canaryWorkspaceIds`, usado pela Publication) não está
     conectado ao módulo Conversas, e conectá-lo agora seria construir uma plataforma de flags
     nova — explicitamente fora de escopo desta fase ("não criar uma nova plataforma de flags").
   - **Mecanismo real de controle do piloto, sem flag nova**: `CONVERSATIONS_MODULE_ENABLED=true`
     precisa ser global, mas isso só habilita as ROTAS — nenhum workspace ganha uma conexão de
     WhatsApp ativa sozinho. O escopo do piloto é controlado pelo dado, não por uma flag: só o
     workspace piloto tem uma linha em `messaging_connections` (criada explicitamente via
     `POST /inbox/connections`, já isolada por tenant/workspace e por RBAC
     `inbox:manage_connections` — confirmado sem vazamento cross-tenant na auditoria de segurança
     da Fase 7). Durante a janela do piloto, restrinja `inbox:manage_connections` a quem está
     conduzindo o piloto, para nenhum outro workspace se autoprovisionar uma conexão por engano.
   - `AI_INBOX_AUTO_REPLY_ENABLED=false` (IA desligada nesta etapa).
   - Conectar o WhatsApp real do workspace piloto (QR).

2. **Atendimento 100% humano, observado (24–48h)**
   - Time do piloto usa a Inbox normalmente: recebe, responde, atribui, transfere.
   - Observar: `GET /v1/system/health`, métricas do worker (`/metrics`), `inbox_messages` com
     `status = 'failed'`, DLQ (deve permanecer vazia ou quase).
   - Critério para avançar: nenhuma mensagem perdida, nenhum erro recorrente nos logs, latência de
     entrega percebida normal.

3. **Habilitar IA em poucas conversas**
   - `AI_INBOX_AUTO_REPLY_ENABLED=true`, mas com `aiEnabled=false` por padrão em todas as
     conversas existentes — ligar manualmente (`POST /v1/inbox/conversations/:id/ai`) em um
     pequeno número de conversas de baixo risco primeiro.
   - Observar qualidade das respostas, custo (`GET /v1/system/health` → billing/circuit breaker),
     e se algum humano precisou corrigir/assumir com frequência anormal.

4. **Expandir gradualmente**
   - Aumentar o número de conversas com IA ativa dentro do MESMO workspace piloto antes de
     considerar outro workspace/tenant.
   - Só depois de um ciclo estável no piloto, avaliar liberar para o próximo tenant — repetindo o
     mesmo processo (nunca pular direto para "todos os tenants").

## Sinais de alerta que pausam o avanço (não avançar de etapa se algum ocorrer)

- Qualquer mensagem outbound duplicada real (não o caso `sending` documentado no runbook).
- DLQ crescendo de forma consistente.
- Circuit breaker do `messaging_provider` abrindo repetidamente.
- Reclamação de cliente sobre resposta de IA incorreta/fora de contexto.

Nesses casos: usar os kill switches (`docs/conversas-runbook.md`, seção 8) antes de investigar —
pausa primeiro, diagnostica depois.
