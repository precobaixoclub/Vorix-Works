# Revisão Visual Global do Vorix — Relatório

Auditoria e aplicação de consistência visual em todo o front-end (`web/`), sem alterar fluxos,
regras de negócio ou arquitetura de módulos. O Vorix já tinha um design system instalado (SaaS
Panel Design System — ver `web/CLAUDE.md`); o trabalho aqui foi diagnosticar e corrigir onde a
aplicação dele estava inconsistente entre telas, não recriar tokens do zero.

## 1. Diagnóstico

Seis auditorias paralelas (shell/sidebar/primitivos + as 10 áreas pedidas) encontraram o mesmo
padrão de problema repetido, não dez problemas diferentes:

- **Badges/status com cor hardcoded fora do token** — `components/StatusBadge.tsx` misturava
  classes tokenizadas (`text-status-active`) com Tailwind cru (`text-red-600 bg-red-50`,
  `text-amber-700 bg-amber-50`) para metade dos status. Sem variante `dark:`, quebrava no tema
  escuro. Era o achado mais visível do app — badges aparecem em quase toda lista/card.
- **Botões primary competindo na mesma tela** — Produção repetia um botão sólido "Gerar agora" em
  CADA linha de uma tabela, ao lado do primary do cabeçalho; Conversas tinha "Enviar" e "Assumir
  conversa" como dois primaries visíveis ao mesmo tempo.
- **Duas linguagens de cor dentro do mesmo arquivo** — `production/page.tsx` misturava o
  vocabulário legado (`text-ink`, `bg-surface-raised`, `bg-surface-sunken`) com o vocabulário atual
  (`text-foreground`, `bg-card`) na mesma tela, mesmo os dois resolvendo pro mesmo valor via alias.
- **Paleta de gráficos fora do vocabulário fechado** — `DashboardKit.tsx` usava 8 cores HSL
  literais (incluindo vermelho puro, ciano, laranja) nunca listadas como accent válido, e o "verde"
  do gráfico nem batia com o `--primary` real da marca.
- **Componentes compartilhados existentes, mas ignorados** — Conexões reinventava o cabeçalho de
  página em vez de `PageHeader`; Analytics reinventava botão e navegação por área em vez de
  `Button`/`PageSubnav`; Marca usava `<select>`/checkbox cru em vez do `Select`/`Switch`
  compartilhado que a própria Publicar usa ao lado.
- **Ícones inconsistentes** — emoji/glyph Unicode (📎🗂🎞♪◎▶$) espalhados em Criar, Conteúdos,
  Conexões e Marca, quebrando a convenção `lucide-react` usada no resto do app; dois ícones do menu
  lateral (`settings`/`operations`) usavam preenchimento sólido enquanto o resto do set é só traço.
- **Sombra/elevação acima do padrão do sistema** — vários modais/drawers/menus usavam `shadow-xl`/
  `shadow-2xl` (Produção, Conteúdos, Publicar, Analytics) contra o `shadow-sm`/`shadow-md` que o
  próprio `Dialog`/`Card` do sistema definem.
- **Card-em-card** — Publicar tinha uma caixa interna com borda própria dentro de um `Card` que já
  tinha borda; o mesmo padrão se repetia em `ProgressivePanel` (componente compartilhado usado em
  16 telas) mais os inner boxes de Produção/Publicar que o usam.
- **Estados de botão incompletos** — `components/ui/button.tsx` tinha `hover`/`focus-visible`/
  `disabled` mas **nenhum `active`**, nenhum suporte a `loading` (cada tela improvisava
  `"Enviando…"` como texto, sem spinner), e as variantes `success`/`warning` usavam HSL literais
  que nem batiam com os tokens `--success`/`--warning` reais do app.
- **Feedback sem diferenciação semântica** — Publicar usava a MESMA cor (`bg-primary/10`) pra
  mensagem de sucesso, erro e resultado parcial de uma publicação multi-rede.

## 2. Decisão de linguagem visual (validada com o usuário antes de codar)

- **`--primary` continua o verde-lima da marca** (`81 61% 26%`) — não é uma repaginação de
  identidade. O que mudou foi disciplina de aplicação: verde sólido só na ação principal de cada
  tela; em todo o resto (chips selecionados, ícones, navegação), tinta suave (`bg-primary/10
  text-primary`) ou tokens neutros.
- **Base neutra já existia e estava correta** (fundo/card/borda em cinza-claro sofisticado,
  `--background`/`--card`/`--border`) — o problema nunca foi a fundação de tokens, era a
  aplicação inconsistente dela tela a tela.
- **Hierarquia de botão**: `primary` (ação única da tela) → `secondary`/outline (ações
  paralelas/repetidas) → `ghost` (discreta) → `destructive` (irreversível). Regra prática nova:
  numa lista com N linhas repetindo uma ação, a ação da linha é sempre `secondary`, nunca
  `primary` — o primary fica reservado pro cabeçalho ou pra uma ação verdadeiramente única.
- **Distinção semântica real para estados opostos** (ex.: atendimento humano vs. IA numa
  conversa) — variantes nomeadas e compartilhadas (`Badge variant="info"`/`"accent"`), nunca cor
  espalhada tela a tela.

## 3. Tokens (o que já existia + o que foi adicionado)

Todos os tokens são triplas HSL em `app/globals.css`, consumidos via `hsl(var(--x))` — nenhuma cor
solta em componente.

| Token | Papel | Valor (claro) |
|---|---|---|
| `--background` | Fundo principal | `240 12% 97%` |
| `--card` | Superfície/card | `0 0% 100%` |
| `--border` | Borda | `240 10% 90%` |
| `--foreground` | Texto principal | `240 10% 12%` |
| `--muted-foreground` | Texto secundário | `240 5% 44%` |
| `--primary` / `--primary-glow` | Cor primária do produto (claro/acento sólido no escuro) | `81 61% 26%` / `77 66% 61%` |
| `--success` / `--warning` / `--destructive` | Semânticas | `136 54% 40%` / `42 88% 34%` / `2 56% 49%` |

**Novos, adicionados nesta rodada** (`app/globals.css`):

```css
/* Paleta de gráficos — vocabulário fechado primary→emerald→sky→violet→amber→rose,
   com variante própria pro modo escuro (mesma lógica do --primary-glow) */
--chart-1: var(--primary);   /* claro */ | var(--primary-glow); /* escuro */
--chart-2: 160 84% 39%  | 158 64% 52%;   /* emerald */
--chart-3: 199 89% 48%  | 199 89% 64%;   /* sky */
--chart-4: 258 90% 66%  | 255 92% 76%;   /* violet */
--chart-5: 38 92% 50%   | 43 96% 63%;    /* amber */
--chart-6: 350 89% 60%  | 351 95% 71%;   /* rose */
```

`DashboardKit.tsx`'s `CHART_COLORS` agora lê esses tokens (`hsl(var(--chart-N))`) em vez de 8
strings HSL literais — todo gráfico do app herda a paleta automaticamente, inclusive num rebrand
futuro (`--chart-1` segue `--primary`).

## 4. Padrão de botões e componentes (aplicado/reforçado)

- **`components/ui/button.tsx`**: toda variante ganhou `active:` (antes só tinha `hover`/
  `focus-visible`/`disabled`); novo prop `loading` — substitui o ícone líder por um spinner
  (`border-current`, funciona em qualquer variante), marca `aria-busy`, desabilita o botão — nunca
  mais um "Enviando…" de texto sem spinner. Variantes `success`/`warning` (usadas fora deste
  escopo) passaram a usar `bg-success`/`bg-warning` reais em vez de HSL literal desalinhado do
  token.
- **`components/ui/badge.tsx`**: duas variantes novas, `info` (sky) e `accent` (violet) — para
  distinguir dois estados que são categorias diferentes, não hierarquia (ex.: "Atendimento
  humano" vs. "IA ativa" em Conversas). Definidas UMA vez no primitivo, não espalhadas por tela.
- **`components/StatusBadge.tsx`**: toda cor hardcoded (`red-*`/`amber-*`) trocada pelos aliases já
  existentes `text-danger`/`bg-danger-bg` e `text-warning`/`bg-warning-bg` — usado em praticamente
  toda lista/card do app, então este foi o fix de maior alavancagem de toda a rodada.
- **`components/ui/dialog.tsx`**: `bg-background` → `bg-popover` (consistente com `Select`/
  `Table`, que já usavam a superfície de popover certa).
- **`components/ScreenGuide.tsx`** (`ScreenGuide`/`InfoCallout`/`ProgressivePanel`, usado em 16
  telas): vocabulário legado → tokens atuais; `ProgressivePanel` ganhou `hover`/`focus-visible`
  no cabeçalho clicável, que não tinha nenhum feedback de interação antes.

## 5. Áreas ajustadas

| Área | Principais ajustes |
|---|---|
| **Home** | Heading de seção unificado com o resto da página (era um "eyebrow" isolado). |
| **Criar** | 3 estilos diferentes de chip selecionado (sólido/tinta suave/neutro) → um só padrão (tinta suave); painéis soltos sem borda envolvidos no `Card` compartilhado; emojis → ícones `lucide-react`; tamanhos de botão hardcoded → `size="lg"`/`"xl"`; loading nos botões de gerar/guardar. |
| **Produção** | Vocabulário legado inteiro convertido (~130 ocorrências); botão "Gerar agora" por linha rebaixado pra `secondary` (não compete mais com o primary do cabeçalho); banner de setup do prompt de IA virou tom `warning` (não é mais um segundo primary); modais próprios alinhados ao `shadow-lg`/`bg-card` do sistema; cores amber/red hardcoded → tokens. |
| **Conteúdos** | Menu de ações e drawer de detalhe → `bg-popover`/`bg-card` tokenizados; gradiente de thumbnail por formato (8 cores fora do vocabulário: indigo/orange/teal/cyan/slate/zinc) → 4 gradientes de 2 tons, cada um dentro do vocabulário fechado. |
| **Conversas** | Badge "Atendimento humano"/"IA ativa" (antes os dois cinza idênticos) → `info`/`accent`; "Assumir conversa" rebaixado pra `secondary` (só "Enviar" continua primary); loading nos botões de enviar/assumir; seta de voltar (glyph `←`) → ícone. |
| **Conexões** | Cabeçalho próprio → `PageHeader` compartilhado; largura do container alinhada a `max-w-6xl`; avatares com glyph Unicode (`♪◎▶$`) → ícones `lucide-react` (`Music2`/`AtSign`/`PlaySquare`/`Megaphone`). |
| **Publicar** | Card-em-card removido em 4 pontos (a borda externa já bastava); barra fixa de envio de `shadow-xl` → `shadow-md`; feedback de sucesso/aviso/erro agora tem 3 cores distintas (antes tudo `bg-primary/10`, inclusive falha). |
| **Marca** | `<h1>` custom → `PageHeader`; `<select>`/checkbox cru → `Select`/`Switch` compartilhados (`ProductionSettingsPanel`); 3 linguagens de pill (`StatusBadge`, filtro custom, pill do `AssetCard`) → todas usando `Badge`; emoji/glyph → ícones. |
| **Analytics** | Seletor de período `<select>` cru → `Select`; menu de exportação → mesmo padrão de popover do resto do app; cores hardcoded (`red-200`/`amber-200` etc.) → tokens; seletor de área manteve o layout horizontal (ver §7) mas com cores/estados corrigidos. |
| **Configurações** | "Abrir Conexões" (link de texto) vs. "Abrir Governança" (botão bordado) — mesma hierarquia, dois tratamentos → unificados como link de texto. |

## 6. Padronizado globalmente (não por tela)

- Cor de badge/status (`StatusBadge`).
- Paleta de gráficos (`DashboardKit`).
- Estados de botão — `hover`/`focus-visible`/`active`/`disabled`/`loading` (`components/ui/button.tsx`).
- Superfície de popover em modais (`Dialog`) e nav mobile vs. desktop (`BottomNav` agora usa a
  mesma cor de estado ativo que `WorkspaceSidebar`, `bg-primary/10 text-primary` — antes eram duas
  cores diferentes para o mesmo conceito).
- `ScreenGuide`/`ProgressivePanel` (16 telas herdam a correção sem edição individual).
- Duas correções de typo "Vonix" → "Vorix" em comentários (`app/globals.css`, `web/CLAUDE.md`).

## 7. Desvios deliberados do plano original (e por quê)

- **Largura da sidebar (240px)**: o plano cogitava alinhar aos 256px documentados pelo template de
  referência do design system. Por instrução explícita do usuário ("não altere automaticamente,
  só se melhorar de fato"), e sem uma ferramenta de browser neste ambiente pra comparar visualmente
  as duas larguras, a sidebar **não foi alterada**.
- **Analytics — seletor de área**: o plano original propunha trocar por `PageSubnav` (rail lateral).
  Ao reler o componente, `PageSubnav` sempre vira coluna à esquerda no desktop — isso reduziria a
  largura disponível pros gráficos numa tela que é fundamentalmente um dashboard largo, não um
  formulário/configuração. Sem poder verificar visualmente o resultado, troquei por um ajuste mais
  seguro: manter o layout horizontal atual, corrigindo só cor/estado/foco. Documentado aqui como
  decisão consciente, não esquecimento.
- **Configurações — "reconstruir como HubPage"**: ao ler a tela completa, ela não é um hub puro de
  navegação — é um dashboard de configurações com dados reais (contagens de integração, membros,
  sessão) intercalado com só 4 atalhos de navegação. Transformar a página inteira em `HubPage`
  descartaria os cards de dados. Fix aplicado foi mais cirúrgico: unificar só a inconsistência real
  encontrada (dois estilos de link "Abrir X").
- **Modais ad hoc de Produção/Conteúdos** (`RoutineConfigDialog`, `IdeaFormDialog`,
  `PublicationDetailDrawer`): o plano cogitava migrar para o `Dialog` (Radix) compartilhado.
  Estrutura própria destas modais é grande e stateful; migrar pra Radix sem poder testar
  visualmente o focus trap/comportamento de fechamento é um risco real de regressão funcional.
  Fix aplicado foi só visual (mesma sombra/borda/superfície do `Dialog` do sistema), sem trocar a
  implementação.

## 8. Limitações

- **Sem ferramenta de browser/screenshot neste ambiente.** Toda verificação foi por
  `npm run typecheck`/`npm run build` (ambos limpos após cada lote) e inspeção do JSX/classes
  resultantes — nunca captura de tela real. Recomendo abrir `npm run dev` e navegar pelas 10 áreas
  antes de considerar o resultado 100% validado visualmente.
- **`text-ink`/`bg-surface-*` (vocabulário legado) não foi migrado no app inteiro** — só nos
  arquivos já tocados por outro motivo nesta rodada. Fora do escopo desta tarefa, mas continua
  seguro (são aliases válidos, não bugs visuais).
- **Ícone Unicode restante em Analytics** (`NETWORK_ICON`, usado dentro de uma string de legenda
  de gráfico) não foi convertido — exigiria reescrever o renderer de legenda do gráfico, risco
  maior que o ganho visual (baixa visibilidade, só na legenda).
- **`ProductionModeTabs`/filtros tipo-segmento** (Produção, Marca) mantiveram o estado selecionado
  sólido (`bg-primary`) — decisão consciente: são seletores de navegação/filtro, não botões de
  ação, então não competem com a regra de "um primary por tela" (que é sobre AÇÕES).
- **Sem mudança de fluxo/dado**: nenhuma chamada de API, hook de dados ou regra de negócio foi
  tocada — confirmado por `npm run architecture:check` no backend continuar limpo.

## 9. Verificação

- `npm run typecheck` (web/): limpo após cada lote e no final.
- `npm run build` (web/): limpo após cada lote e no final — todas as rotas compilam.
- `npm run architecture:check` (backend): limpo, confirma que nada de domínio/arquitetura foi
  afetado.
- 25 arquivos alterados, +543/−423 linhas.
