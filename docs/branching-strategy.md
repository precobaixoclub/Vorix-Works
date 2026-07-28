# Estratégia de branches

Definida na Sprint 02 (fundação da plataforma), quando o projeto passou a ter controle de versão real pela primeira vez.

## Decisão

Trunk-based, simples, sem `develop` permanente:

- **`main`** — sempre estável, sempre buildável (`npm run build && npm test` passando). É o que se implanta.
- **`feature/<escopo-curto>`** — uma branch por sprint ou por unidade de trabalho (ex.: `feature/api-foundation`, `feature/workspace-domain`). Nasce de `main`, volta para `main` via merge quando o trabalho está completo e verificado.
- **`fix/<escopo-curto>`** — mesma lógica, para correções pontuais fora do fluxo de sprint.

## Por que não `develop`

O projeto ainda é operado por uma única pessoa/agente por vez, sem pipeline de CI/CD nem múltiplos times em paralelo. Uma branch `develop` de longa duração hoje só adicionaria uma etapa extra de merge sem nenhum benefício real de isolamento — não há ninguém para proteger `main` de outra pessoa. Reavaliar quando existir CI automatizado e mais de um contribuidor simultâneo.

## Regra prática até existir CI

Antes de qualquer merge para `main`: `npm run typecheck && npm test && npm run architecture:check` precisam passar localmente. Não existe hoje enforcement automático disso (nenhum workflow de CI foi criado nesta sprint — ver Riscos no relatório da Sprint 02) — é uma disciplina manual até então.

## Nomenclatura de commits

Sem convenção obrigatória (ex.: Conventional Commits) definida ainda. Recomendação para as próximas sprints: adotar `tipo: descrição curta` (`feat:`, `fix:`, `docs:`, `chore:`) quando o projeto ganhar mais de um contribuidor — não vale a pena impor isso antes de precisar.
