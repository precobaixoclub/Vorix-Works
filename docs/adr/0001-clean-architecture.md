# ADR 0001 — Clean Architecture como base

## Decisão

O Zuno seguirá Clean Architecture desde a fundação. O domínio ficará isolado de infraestrutura, frameworks, APIs externas e interfaces de entrada.

## Motivo

O projeto nasce pequeno, mas tem ambição de crescer para múltiplas redes, múltiplas IAs, múltiplos clientes, API própria, painel web e SaaS. Sem separação de camadas, a tendência seria misturar orquestração, chamadas externas, regras de negócio e apresentação.

## Consequência

O início exige mais disciplina e mais pastas do que um script simples. Em troca, o projeto poderá crescer por adição de módulos e adaptadores.
