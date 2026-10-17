# Vorix Design System 2.0 — produto interno

Continuidade visual com a home pública: **dark-first, premium, AI-first**. Sem Storybook — esta
página é a documentação; `web/e2e/ds2-proof.spec.ts` é a prova visual (gera `screenshots/`).

## 1. Onde mora

| Camada | Arquivo |
|---|---|
| Tokens (cores, superfícies, raio, sombra/glow, motion) | `web/app/globals.css` (`:root`, `.dark`, `[data-solution]`, `@theme inline`) |
| Primitivos shadcn com o diff DS 2.0 | `web/components/ui/{button,card,input,select,dialog,alert-dialog,popover,tooltip,badge}.tsx` |
| Linguagem de IA | `web/components/vorix/ai.tsx` |
| Cards e status | `web/components/vorix/cards.tsx` |
| Estado vazio | `web/components/EmptyState.tsx` |
| Shell | `WorkspaceSidebar`, `WorkspaceTopBar`, `SolutionSwitcher`, `app/workspaces/[workspaceId]/layout.tsx` |

Tema padrão: `dark` (`providers.tsx`). O claro continua suportado pelos mesmos tokens.

## 2. Tokens

Todas as cores são triplets HSL (`H S% L%`) → funcionam com `/opacity` (`bg-solution/10`).

| Token | Uso |
|---|---|
| `background` | fundo da página (`222 36% 5%` no dark) |
| `surface-1` / `card` | painéis, sidebar, cards |
| `surface-2` | hover, inputs elevados, chips |
| `surface-3` / `popover` / `surface-elevated` | menus, modais, popovers |
| `border` | divisória padrão (use `/70` em cards) |
| `foreground` · `text-secondary` · `muted-foreground` · `text-disabled` | hierarquia de texto |
| `primary` | CTA principal. **Verde** (`#addb46`) em Conversas, **violeta** em Meetings |
| `solution` | acento da solução ativa (item ativo, dot do switcher, foco) |
| `ai` · `ai-glow` | exclusivo de IA (violeta → azul). Nunca para CTA comum |
| `success` · `warning` · `destructive` · `info` | estados semânticos |

**Acento por solução.** `data-solution="conversations|meetings"` é aplicado no layout do
workspace **e** no `<html>` (portais do Radix herdam). Em `meetings`, `--primary`, `--ring` e
`--solution-accent` viram `--meetings`. Nunca escreva `bg-violet-*` para "ser Meetings" — use
`bg-primary`/`bg-solution` e deixe o atributo decidir.

**Raio:** `sm 6px · md 8px · lg 10px · xl 16px · 2xl 20px` (rem, escalam com o shell). Cards `rounded-xl`, modais `rounded-xl`,
chips `rounded-full`.

**Sombra vs glow.** Separação vem de borda + superfície. `shadow-xs` em cards, `shadow-md/lg` só
em elementos flutuantes (popover, modal). Glow (`shadow-glow-primary|ai|solution`) só em: CTA
primário no hover, botão `variant="ai"`, barra de progresso. Nada de glow em card estático.

**Motion.** `--ease-standard`, `--ease-emphasized`, `--duration-fast|normal|slow`. Tudo respeita
`prefers-reduced-motion` (regra global em `globals.css` zera animações/transições).

**Utilitários:** `.vorix-backdrop` (fundo com halo da solução + IA), `.vorix-grid` (grade sutil),
`.vorix-glass` (topbar), `.vorix-ai-surface` (borda em gradiente IA), `.vorix-ai-text`,
`.vorix-display` (fonte display do site), `.vorix-ai-shimmer`, `.vorix-live-dot`.

## 3. Linguagem visual de IA

Uma regra: **se a IA gerou, tem a assinatura de IA; se não gerou, não tem.**

- Ícone único: `VorixAiIcon` (Sparkles lucide, `text-ai`). Não usar outro ícone para IA.
- Selo: `<AiBadge />` → "Vorix AI" com texto em gradiente.
- Ação que gasta IA: `<Button variant="ai">` (gradiente violeta→azul + glow).
- Processando: `<AiLoading kind="analyzing|generating|summarizing|transcribing" detail="…" />`
  — shimmer, nunca spinner genérico.
- Resultado: `<AIInsightCard title meta footnote actions>` — borda em gradiente, selo, e rodapé
  "Sugestão da IA — revise antes de agir." (personalizável; `footnote={null}` remove).
- Vocabulário: "sugestão", "revise antes de agir". A IA nunca executa sozinha.

Aplicado em: cockpit da oportunidade (Analisar com IA), resumo IA da reunião, follow-up do
Meetings, créditos na topbar.

## 4. Componentes

| Componente | Quando |
|---|---|
| `MetricCard` (`accent: neutral|solution|ai|positive|negative`, `delta`, `trend` sparkline) | KPI. `KpiCard` do `DashboardKit` delega para ele |
| `MetricGrid` | grade responsiva de métricas |
| `ActionCard` | atalho com CTA (home das soluções) |
| `StatusChip` (`active|pending|success|warning|error|neutral|ai|recording|info`, `live`) | status inline; `recording` + `live` = ponto pulsante |
| `EntityCard` | resumo de entidade (contato, reunião) |
| `EmptyState` (`tone: solution|ai|neutral`, `compact`) | sempre com ícone lucide + explicação do porquê + ação |
| `Badge` variantes `success|warning|ai|recording` | rótulos curtos |
| `DashboardLoading` / `Skeleton` | carregamento: skeleton com o formato do conteúdo |

## 5. Regras

1. Ícones: só `lucide-react`. Emoji só como **conteúdo** (reações, picker, prévia de mensagem).
2. Zero hex em componente. Exceção: editor de identidade de marca (cor escolhida pelo usuário).
3. Superfície branca só onde é funcional: QR code e páginas de impressão.
4. Foco: `ring-2 ring-ring/45` (botões) / `border-ring ring-2 ring-ring/20` (campos). Nunca
   remover outline sem substituto.
5. Topbar enxuta: workspace, créditos, notificações, menu do usuário (conta, tema, admin, sair).
6. As regras de layout do SaaS Panel Design System (`web/CLAUDE.md`) continuam valendo:
   `DetailModal`, `PageSubnav`, `ListCard` com paginação adaptativa, breadcrumb no lugar de "Voltar".

## 6. Prova visual

```bash
cd web
npx playwright test e2e/ds2-proof.spec.ts --config=playwright.sales-qa.config.ts --project=desktop-1366
```

Gera `docs/design-system-2/screenshots/<tela>-<largura>.png` (1440/1280/1024/768/390) com backend
mockado e falha se houver overflow horizontal.
