# ADR 0004 — Domínios novos totalmente independentes, isolamento verificado por script

## Contexto

A partir da Sprint 08 (AI Gateway), a plataforma passou a crescer por uma sequência de domínios novos (AI Gateway, Planning, Runtime, Execution, Publication, Credential, Webhook, Scheduling, Analytics, Operations) construídos em cima de um pipeline legado já existente (Arthur/Caio/Helena/Skills, CLI `LOCAL_PRODUCTION`) e, em alguns casos, em cima de domínios novos anteriores (ex.: Runtime traduz Planning; Execution traduz Runtime).

Cada vez que um domínio novo poderia, em teoria, reaproveitar um conceito já existente — `ExecutionPlan` legado para Planning, `SkillCapability` para `ExecutionCapability`, `ZunoEventName` para os eventos dos domínios novos — a decisão recorrente foi **não reaproveitar**, e construir um tipo/Port próprio, mesmo quando estruturalmente parecido.

## Decisão

1. Todo domínio novo nasce **totalmente independente** do pipeline legado (Arthur/Caio/Helena/Skills) — nunca uma refatoração dele, sempre um par de conceitos paralelos (ex.: `Planning`/`ExecutionGraph` novo vs. `ExecutionPlan` legado; `ExecutionCapability` novo vs. `SkillCapability` legado).
2. Cada fronteira de isolamento é verificada por um **script dedicado** (`scripts/check-<domínio>-isolation.mjs`), rodado em `npm run architecture:check` — nunca uma regra só documentada em prosa. O script escaneia imports por marcador de caminho (`/application/orchestration/`, `/application/workflows/`, `/application/skills/`, `/domain/skills/`) e falha o build se qualquer arquivo do domínio novo importar do lado legado, ou vice-versa.
3. A composição entre um domínio novo e o próximo do fluxo de negócio acontece por um **hook opcional, estreito** (interface local de 1–2 métodos, implementação real em `infrastructure/`) — nunca por importar o domínio de destino de dentro da lógica de domínio/aplicação de origem.
4. Tradução de vocabulário entre domínios (`ExecutionCapability`→`SkillCapability`, por exemplo) fica deliberadamente **adiada** até o dia em que houver necessidade real — documentado a cada sprint como recomendação para a sprint seguinte, nunca implementado preventivamente.

## Motivo

O pipeline legado antecede Workspace/multi-tenant/RBAC (`ExecutionPlanTenantContext` nunca teve `workspaceId` — evidência concreta de que ele nasceu antes desses conceitos existirem). Reaproveitar seus tipos para os domínios novos teria acoplado a plataforma nova a uma fundação que não foi desenhada para ela, e qualquer mudança no legado (usado hoje pela CLI `LOCAL_PRODUCTION`, já homologada e liberada — `docs/rc2-re-homologacao-report.md`) arriscaria regressão num produto já entregue.

O mesmo raciocínio se aplica entre domínios novos consecutivos: manter `Planning` livre de `Runtime`, `Runtime` livre de `Execution` etc. permite que cada um evolua, seja re-homologado e (no limite) seja substituído sem exigir uma reescrita em cascata dos vizinhos.

## Consequência

- 5 scripts de isolamento (`check-ai-stack-isolation`, `check-planning-isolation`, `check-runtime-isolation`, `check-execution-isolation`, `check-publication-isolation`) protegem as fronteiras contra o pipeline legado — todos verificados passando na Sprint 24 (ver `docs/sprint-24-final-report.md`).
- **Nenhum script equivalente existe para as fronteiras ENTRE os domínios novos** (Scheduling↔Publication, Webhook↔Publication, Analytics↔Scheduling) — a auditoria da Sprint 24 encontrou acoplamento direto (imports de valor, não só de tipo) nessas três fronteiras, hoje protegido apenas por revisão manual, não por CI. Registrado como recomendação para a Sprint 25.
- Duplicação deliberada de vocabulário é aceita como custo do isolamento: `ExecutionCapability` (Planning/Runtime/Execution) nunca virou `SkillCapability` (legado), mesmo cobrindo conceitos parecidos — a tradução entre os dois continua adiada, decisão reafirmada a cada sprint.
