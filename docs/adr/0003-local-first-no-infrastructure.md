# ADR 0003 — Primeira fase local, sem servidor e sem banco

## Decisão

A primeira fase do Zuno será local-first, executada pelo VS Code, sem servidor, sem banco de dados, sem painel web e sem integrações externas.

## Motivo

O objetivo inicial é validar a arquitetura e a divisão de responsabilidades antes de investir em infraestrutura. Isso reduz custo, risco e retrabalho.

## Consequência

As pastas de infraestrutura e interfaces existem apenas como preparação. Implementações reais só devem ser adicionadas quando houver uma Skill ou fluxo concreto justificando sua criação.

**Atualização:** `src/interfaces/cli` deixou de ser apenas preparação — é hoje o ponto de entrada real do Zuno (`npm run zuno -- "<comando>"`), executando Arthur → Caio → Helena → Skills reais localmente, com persistência em arquivos JSON (`.zuno-data/`) e artefatos em disco (`artifacts/`). A decisão original desta ADR continua válida: ainda não há servidor, banco de dados, painel web ou provider real de IA/Meta configurado — a CLI é local-first por completo, apenas deixou de ser hipotética.
