# web/ — Design system

Este projeto adotou o **SaaS Panel Design System** (`bittencourtthulio/saas-panel-design-system`).
Antes de construir ou restilizar qualquer UI aqui, carregue a skill `saas-panel-design-system`
(instalada em `.claude/skills/`, se presente na sessão) e siga os padrões dela.

## O que já foi aplicado

- Tokens canônicos (`--primary`, `--background`, `--foreground`, `--muted`, `--border`...) em
  `app/globals.css`, com a marca do Vonix (verde-limão) no lugar do verde padrão do pacote.
  Convivem com os tokens antigos (`--color-surface`, `--color-ink`...) — ambos resolvem pro
  MESMO valor, então nenhum componente antigo quebrou.
- `shadcn/ui` instalado em `components/ui/` (Tailwind v4, sem `tailwind.config.*` — CSS-first via
  `@theme`/`components.json`). Os 7 primitivos com o diff do sistema (`button`, `card`, `input`,
  `textarea`, `select`, `table`, `dialog`) foram sobrescritos pela versão do pacote.
- `components/Button.tsx`, `Card.tsx`, `Field.tsx`, `Modal.tsx`, `ConfirmDialog.tsx` são
  wrappers finos sobre `components/ui/*` — preservam a API antiga (`variant="primary"` etc.) pra
  nenhuma tela precisar mudar, mas renderizam os primitivos novos por baixo. **Nunca edite
  `components/ui/**` à mão** — é sobrescrito no próximo `shadcn add`; qualquer ajuste vai no
  wrapper em `components/`.
- Componentes do sistema copiados em `components/`: `StatsGrid`, `ListCard`, `SortableHead`,
  `PageSubnav`, `HubPage` (adaptado pra `next/navigation` em vez de `react-router-dom`),
  `DetailModal`, `InlineField`, `ResizableDialog`, `ReportsNav`, `ReportTable` (usa `sonner` em
  vez de `use-toast`), `DashboardKit`, `ThemeToggle`, `PageSkeletons`, `SearchableCombo` (o
  template `ProjectSelect` do pacote, genérico — recebe `items` como prop). Hooks em `hooks/`:
  `useAutoPageSize`, `useSortedRows`, `useDebounce`, `useModalWidth`. `lib/sort.ts`, `lib/csv.ts`.
- Tema: `next-themes` com `attribute="class"`, `defaultTheme="system"` — troca manual
  (`ThemeToggle`, na topbar) some com a preferência do SO se ninguém mexer. `Breadcrumbs.tsx`
  (adaptado pra `next/navigation`) substitui qualquer botão "Voltar".
- `ConfirmDialog` usa `AlertDialog` (Radix) — nunca `window.confirm`.

## Não-negociável (regras do sistema)

1. Uma solução por problema — sem variação local.
2. Detalhe de registro = `DetailModal` (nunca drawer/`Sheet`, nunca aba "Editar").
3. Sub-navegação de página = `PageSubnav` (trilha à esquerda), nunca `Tabs`.
4. Tela de listagem = `PageHeader` → `StatsGrid` → Card de filtro → `ListCard` com paginação
   adaptativa (nunca `PAGE_SIZE` fixo).
5. Lista que pode crescer = `SearchableCombo`, nunca um `<Select>` nativo com dezenas de itens.
6. Loading/erro/vazio sempre cobertos; erro sempre com retry.
7. Ação destrutiva = `ConfirmDialog`/`AlertDialog` nomeando o registro e a consequência.
8. Ação bloqueada = botão desabilitado + `Tooltip` explicando o motivo, nunca escondido.
9. Zero hex solto; acentos só do vocabulário fechado (`emerald`/`sky`/`violet`/`amber`/`rose`/`primary`).
10. `tabular-nums` em número comparável; `Intl` pra formatação; `—` pra valor ausente.

## O que ainda falta

A conversão ESTRUTURAL tela a tela (usar `ListCard`/`StatsGrid`/`DetailModal`/`PageSubnav` de
verdade em cada rota) ainda está em andamento — a fundação (tokens, primitivos, componentes
compartilhados) já vale pra toda tela existente automaticamente, mas o padrão de CADA tela
(lista/hub/dashboard/relatório) precisa ser aplicado rota por rota. Ver `references/` na skill
pra cada padrão antes de converter uma tela nova.
