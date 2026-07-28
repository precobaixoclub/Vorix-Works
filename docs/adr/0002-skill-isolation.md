# ADR 0002 — Skills independentes e isoladas

## Decisão

Cada especialista será uma Skill independente. Nenhuma Skill poderá executar responsabilidade de outra Skill ou chamar outra Skill diretamente.

## Motivo

O modelo de agência inteligente depende de especialistas substituíveis, testáveis e auditáveis. Quando uma Skill acumula muitas funções, o sistema perde clareza operacional.

## Consequência

Arthur deverá coordenar todo fluxo entre Skills. O protocolo de comunicação precisa ser explícito e estruturado.
