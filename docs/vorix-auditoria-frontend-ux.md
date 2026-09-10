# Vorix — Auditoria Completa de Frontend e UX

**Metodologia**: leitura direta e completa do código-fonte de `web/` (Next.js/React) — cada `page.tsx` de rota real e os componentes/hooks/APIs que importa — via 8 agentes de exploração especializados por área, mais levantamento cross-cutting de navegação e adoção de design system feito diretamente nesta sessão. **Nenhum arquivo foi alterado.** Nenhuma tela foi redesenhada, nenhum componente novo foi criado, nenhum refactor foi feito. Este documento é só descrição do estado atual com evidência de código (arquivo/linha sempre que possível) — não contém recomendação de solução definitiva.

Convenção de status usada: `USADO CORRETAMENTE` / `USADO PARCIALMENTE` / `IGNORADO` / `REIMPLEMENTADO LOCALMENTE` (adoção do design system); `VERIFIED_RUNTIME` não se aplica aqui (é auditoria de código, não de runtime).

---

## Sumário

1. [Inventário completo de telas](#1-inventário-completo-de-telas)
2. [Classificação por área](#2-classificação-por-área)
3. [Fluxos do usuário por módulo](#3-fluxos-do-usuário-por-módulo)
4. [Auditoria visual (transversal)](#4-auditoria-visual-transversal)
5. [Auditoria de UX (transversal)](#5-auditoria-de-ux-transversal)
6. [Foco especial: Conversas](#6-foco-especial-conversas)
7. [Foco especial: CRM / Kanban](#7-foco-especial-crm--kanban)
8. [Foco especial: Home](#8-foco-especial-home)
9. [Foco especial: Marketing](#9-foco-especial-marketing)
10. [Responsividade](#10-responsividade)
11. [Design system — adoção real](#11-design-system--adoção-real)
12. [Navegação](#12-navegação)
13. [Tabela de prioridade](#13-tabela-de-prioridade)
14. [Nota de escopo](#14-nota-de-escopo)
15. [Entrega](#15-entrega)

---

## 1. Inventário completo de telas

> Cada tela segue o template: Rota · Arquivo · Módulo · Objetivo · Usuário típico · Dados · Ações (principal/secundárias) · Componentes · APIs · Estados (empty/loading/error) · RBAC · Flags · Dependências · Problemas visuais · Problemas de UX · Responsividade · Uso do design system.

### 1.1 Início

#### Home (Dashboard do workspace)
- **Rota**: `/workspaces/[workspaceId]` · **Arquivo**: `web/app/workspaces/[workspaceId]/page.tsx`
- **Objetivo**: resumo de 30 dias de produção/publicação + atalhos + itens de atenção (CRM).
- **Usuário típico**: qualquer membro do workspace.
- **Dados**: nome/status/data do workspace; checklist de onboarding (condicional); 4 KPIs (gerados/em produção/aguardando revisão/publicados 30d); painel "Vorix Intelligence" (sugestões comerciais + tarefas atrasadas); 4 cards de atalho (Produção/Revisão/Conteúdos/Calendário); bloco "Métricas gerais" (5 itens, duplica parte do StatsGrid).
- **Ações**: navegar por atalhos; resolver/descartar sugestão; concluir tarefa. **Ação principal**: nenhuma dominante — 3 candidatos competem (checklist, Intelligence, atalhos).
- **Componentes**: `StatsGrid`, `KpiCard`/`HubCard` (`DashboardKit`/`HubPage`), `Card` (3 variantes coexistindo), `VorixIntelligencePanel`.
- **APIs**: `GET /v1/onboarding`, `GET /v1/execution-runs`, `GET /v1/{tiktok,instagram,youtube}/posts`, `GET /v1/commercial-suggestions`, `GET /v1/tasks`, `POST` de accept/dismiss/complete.
- **Estados**: loading = "…" sem skeleton; **error NÃO TRATADO** (falha de API vira "0" permanente, sem aviso); empty parcial (Intelligence trata, KPIs/atalhos não orientam workspace novo).
- **RBAC**: nenhuma na própria tela (só o layout esconde Bastidor). **Flags**: nenhuma direta.
- **Dependências**: `/production`, `/review`, `/campaigns`, `/calendar`, `/onboarding`, `/tasks`.
- **Problemas visuais**: 9+ blocos empilhados sem hierarquia; métrica "Publicados 30d" duplicada 2x com estilos diferentes; 3 vocabulários de Card coexistindo; `HubCard` fora de contexto (desenhado pra hub de navegação, usado numa dashboard); mesma cor de destaque usada em 3 significados diferentes.
- **UX**: sem ação principal dominante; "Métricas gerais" é redundância pura; HubCards de Revisão/Calendário misturam card-métrica com card-navegação; zero indicação de erro de API; Vorix Intelligence (100% CRM) ocupa peso visual igual ao resto mesmo vazio.
- **Responsividade**: `max-w-6xl`; "degrau" entre 1024-1279px onde StatsGrid já é 4 col mas HubCards ainda 2 col.
- **Design system**: StatsGrid/KpiCard corretos; HubCard parcial; **PageHeader IGNORADO** (header ad-hoc); `CompactMetric` **REIMPLEMENTADO LOCALMENTE**.

#### Onboarding (wizard)
- **Rota**: `/workspaces/[workspaceId]/onboarding` · **Arquivo**: `.../onboarding/page.tsx`
- **Objetivo**: wizard de 5 passos (Empresa/Canal/Equipe/Comercial/Marca) + "Pronto".
- **Ações**: uma ação principal clara por passo (positivo) + variações de "pular"/"depois".
- **APIs**: `GET/POST /v1/onboarding/*`, `GET /v1/inbox/connections/:id/qr`, `PATCH /v1/workspaces/:id`, `POST /v1/brand-profile` (chamada inline, fora de módulo dedicado).
- **Estados**: loading/error bem tratados (Spinner tela cheia, ErrorState, toast por passo).
- **RBAC**: **GAP** — `inviteTeamMemberDuringOnboarding` permite convidar com papel `admin` sem checar o papel de quem convida.
- **Flags**: `channelModuleEnabled` controla CTA de WhatsApp.
- **Achado visual importante**: QR code do passo Canal é **texto monoespaçado cru**, não uma imagem real — não comunica "escaneie isto" de forma crível.
- **UX**: múltiplas variações de "pular" com diferenças sutis não explicadas; onboarding expõe limitação de roadmap ("Instagram e Facebook chegam em breve") na primeira experiência; falta trilha nomeada de passos.
- **Design system**: Button/Field/ErrorState/Spinner corretos; Card/CardBody wrapper antigo; QR **REIMPLEMENTADO LOCALMENTE** de forma rudimentar.

#### Seletor de Workspaces
- **Rota**: `/workspaces` · **Arquivo**: `web/app/workspaces/page.tsx`
- **Objetivo**: listar/criar/editar workspaces + menu de conta (com acesso admin de plataforma).
- **Estados**: dois níveis de empty bem tratados; erro tratado **mas sem retry** (diferente do padrão ErrorState do resto do app).
- **Achado**: usa tokens "antigos" (`text-ink`, `bg-surface-raised`) enquanto a Home já usa tokens novos (`text-foreground`, `bg-card`) — duas gerações de tokens visíveis lado a lado.
- **UX**: filtro de status sempre exposto mesmo com poucos workspaces; menu de conta mistura contexto pessoal com acesso admin de plataforma.
- **Design system**: EmptyState/Modal/StatusBadge corretos; **PageHeader/StatsGrid/ListCard/paginação adaptativa IGNORADOS** (grid fixo sem paginação); dropdown de conta, pills de filtro e busca **REIMPLEMENTADOS LOCALMENTE** (dropdown não fecha ao clicar fora).

#### Login
- **Rota**: `/login` · **Arquivo**: `web/app/login/page.tsx`
- **Ação principal clara** ("Entrar"), loading/error tratados.
- **Gaps funcionais**: sem "Esqueci minha senha", sem link de cadastro a partir daqui (assimetria com `/signup`, que linka pra `/login`).
- **Design system**: erro usa `text-red-600` cru em vez do token semântico `text-destructive`.

### 1.2 Conversas / Atendimento

#### Conversas (Inbox WhatsApp)
- **Rota**: `/workspaces/[workspaceId]/conversas` · **Arquivos**: `page.tsx` + `inbox-tab.tsx` + `crm-panel.tsx` + `connections-tab.tsx`
- **Objetivo**: inbox unificado de WhatsApp (WuzAPI) para atendimento humano+IA com CRM contextual.
- **Real-time**: SSE em `GET /v1/inbox/stream` (token via querystring — EventSource não aceita headers), nunca fonte de verdade (só decide quando revalidar SWR); reconecta em 5s. Fallback polling: conversas 30s, mensagens/eventos 20s.
- **APIs**: connections (CRUD+QR+refresh-status+disconnect), conversations (list/messages/read/assign/take-over/ai/transfer/close/reopen/events), members.
- **Estados**: lista/timeline bem tratadas; **painel CRM (fetch do contato) com erro NÃO TRATADO**; **envio de mensagem SEM tratamento de erro nenhum** (rascunho já foi limpo, usuário acha que enviou).
- **RBAC**: **ZERO checagem de role no frontend** — qualquer membro pode assumir/transferir/finalizar/pausar IA de qualquer conversa.
- **Flags**: `CONVERSATIONS_MODULE_ENABLED` **nunca é checada no frontend** — item de nav aparece incondicionalmente; se desligada no backend, usuário só descobre via erro genérico de API. `AI_INBOX_AUTO_REPLY_ENABLED` idem.
- Ver seção 6 para o detalhamento visual/UX extremamente minucioso pedido.
- **Design system**: PageSubnav/SearchableCombo (transferência) corretos; **SearchableCombo IGNORADO no campo "Responsável"** (input de texto livre pedindo UUID); **ConfirmDialog IGNORADO em "Desconectar" conexão** (contraste com `/connections`, que faz certo).

#### Mensagens (Instagram DM)
- **Rota**: `/workspaces/[workspaceId]/instagram-dm` · **Arquivo**: `.../instagram-dm/page.tsx` + `conversations-tab.tsx` + `automation-tab.tsx`
- **Objetivo**: inbox de DM do Instagram + automação por palavra-chave — **inbox paralelo e totalmente desconectado** do módulo Conversas (hooks/tipos/UI diferentes, bolha de mensagem reimplementada do zero).
- **Polling**: só polling (10-15s), **sem SSE** — mensagens novas demoram mais que no WhatsApp.
- Sem transferência/fila/status de atendimento; sem painel de CRM/vínculo de contato.
- Compositor é `<Input>` de uma linha (nem `Textarea`) — impossível multi-linha.
- **Achado positivo único**: `automation-tab.tsx` é o **único ponto de todo o escopo da auditoria** onde o padrão de listagem do design system é seguido à risca (ListCard+TablePagination+usePagination+SortableHead).
- Tem CRUD completo de regras de automação (contains/exact/starts_with, prioridade, fallback fixo ou IA) — capacidade que o Conversas (WhatsApp) **não tem**.

#### Conexões
- **Rota**: `/workspaces/[workspaceId]/connections` · **Arquivo**: `.../connections/page.tsx`
- **Objetivo real**: **NÃO gerencia WhatsApp** — gerencia Meta/Instagram/Facebook/TikTok/YouTube para **publicação de conteúdo**.
- **Achado crítico de navegação**: nome idêntico ("Conexões") à aba interna dentro de Conversas, que gerencia WhatsApp para **atendimento** — mesmo rótulo, dois conceitos totalmente diferentes, risco real de confusão ("cadê meu WhatsApp?").
- **Design system**: `ConfirmDialog` usado **corretamente** aqui (nomeando conta+rede) — modelo de referência, contrasta com a ausência do mesmo padrão em `conversas/connections-tab.tsx`.
- Loading/erro do status OAuth **NÃO TRATADO** na página raiz — falha vira "0 contas conectadas" indistinguível de vazio genuíno.
- `MetaAdsConnection` duplica ~100 linhas de JSX quase idêntico ao `ConnectionCard` genérico em vez de reusar.

### 1.3 Comercial / CRM

#### Contatos
- **Rota**: `/workspaces/[workspaceId]/contacts`
- **Objetivo**: visão 360° do contato. Só nome+empresa na criação — sem telefone/e-mail, fica sem `ContactIdentity` vinculável.
- Sem editar/excluir/atribuir dono/tags na UI apesar de existir no modelo.
- **Design system**: detalhe = painel lateral fixo (viola regra DetailModal); **sem paginação nenhuma** (lista inteira de uma vez).

#### Negócios (Kanban)
- **Rota**: `/workspaces/[workspaceId]/deals` — ver seção 7 para o detalhamento completo pedido como foco especial.

#### Tarefas
- **Rota**: `/workspaces/[workspaceId]/tasks`
- Filtro só por status; criar tarefa não permite vincular a contato/negócio na UI (API aceita, tela não pede).
- "Cancelar" é destrutivo **sem ConfirmDialog** (viola regra 7). Sem indicação visual de atraso.

#### Propostas
- **Rota**: `/workspaces/[workspaceId]/proposals`
- Link público gerado é mostrado **uma única vez** em modal — se fechar sem copiar, **não é recuperável pela UI** (token nunca mais exibido).
- Sem preview antes de enviar, sem edição de rascunho, sem exclusão. Detalhe = painel lateral fixo (mesma violação de Contatos).

#### Proposta pública (`/p/[token]`)
- Página pública sem auth. Aceitar/recusar com boa exclusão mútua (disabled durante chamada).
- **Achado importante**: sempre mostra o Logo da própria Vorix, nunca a marca do tenant/agência que enviou — estranho em produto B2B multi-tenant (cliente final vê a marca do fornecedor de software, não da empresa que contratou).
- Sem confirmação antes de aceitar/recusar; sem exportar/baixar PDF; sem dados da empresa/CNPJ no rodapé.

### 1.4 Marketing

Ver seção 9 para o foco especial completo. Resumo por tela:

- **Criar** (`/create`): formulário de ideia→geração. **Gasto de crédito real sem ConfirmDialog.** Loading com mensagens rotativas por tempo, não telemetria real.
- **Chat** (`/chat`, `/chat/[id]`): **rotas fantasmas** — redirect puro pra `/production`. Não existe chat de IA como experiência própria.
- **Produção** (`/production`): concentra Fila+Tanque em 2049 linhas. Tanque segue o DS corretamente; Fila ignora quase tudo. **"Rotina automática" é 100% localStorage, sem job de backend real** — UI sugere cron real que não existe.
- **Conteúdos** (`/campaigns`): boa aderência ao DS na listagem; **detalhe = drawer custom** (viola regra 2); cancelamento sem ConfirmDialog (inconsistente com Calendário/Publicar, que tratam a mesma ação corretamente).
- **Calendário** (`/calendar`): mesma fonte de Conteúdos; mesma violação de drawer; único do conjunto com ConfirmDialog consistente.
- **Publicar** (`/publish`): tela com **maior aderência ao DS do módulo inteiro** (ProgressivePanel, SearchableCombo, ToggleGroup); mas fuso horário é texto livre e "ID da Página do Facebook" exposto cru.
- **Marca/Knowledge** (`/knowledge`): única do conjunto que usa `PageSubnav` de verdade.
- **Assets** (`/assets`): rota fantasma → redirect client-side pra `/knowledge?tab=materials`.
- **Instagram/Facebook/TikTok** (nível workspace): **rotas fantasmas** — redirect pra `/publish?network=...`. Não existe tela de "gestão de canal".
- **Meta Ads** (`/meta-ads`): árvore Campanha→Conjunto→Anúncio. "ID da Página do Facebook" em texto livre; criação de anúncio só aceita URL de imagem colada (sem reusar biblioteca de assets); sem paginação na árvore.
- **Callbacks OAuth** (4 arquivos): mesmo template; sem retry automático se sessão Vorix expirar durante o callback.

### 1.5 Resultados / Analytics

#### Analytics
- **Rota**: `/workspaces/[workspaceId]/analytics` — 5 abas (Visão geral/Conteúdo/Redes/IA/Saúde).
- **Estados**: TODOS bem tratados (skeleton, ErrorState com retry, EmptyState contextual) — cumpre a regra 6 do DS.
- **Achados**: sub-navegação de abas reimplementada como pills (viola regra 3, deveria ser `PageSubnav`); menu de exportação via `<details>` nativo; timezone é texto livre; **alertas são somente leitura na tela — API já tem `acknowledge`/`resolve` prontas e NUNCA chamadas**; KPIs sempre mostram número mesmo quando indisponível (contradiz o próprio texto do componente `Freshness`).

#### Resultados
- **Rota**: `/workspaces/[workspaceId]/results` — painel de atendimento (Inbox) + comercial (CRM), sem overlap técnico de endpoint com Analytics.
- **Achado crítico — pior que Analytics**: **Loading e Error NÃO TRATADOS** — nem importa `ErrorState`. Falha ou carregamento inicial mostra ~15 KPIs como "0"/"R$ 0,00" simultaneamente, indistinguível de período com zero real.
- **Inconsistência dentro da MESMA tela**: campos opcionais do tipo mostram "—" corretamente; a MAIORIA dos KPIs (campos obrigatórios) caem em `?? 0` — mesma tela, mesmo carregamento, dois comportamentos diferentes.
- Filtro "Responsável" pede ID cru; filtros de texto sem debounce (chamada a cada tecla).
- **Comparação Analytics×Resultados**: tecnicamente complementares (zero overlap de endpoint, confirmado por código), mas a UI não comunica a distinção (nomes genéricos adjacentes na mesma seção de nav) e há assimetria grande de maturidade (Analytics = acabado; Resultados = MVP sem tratamento de erro).

### 1.6 Configurações

#### Configurações (hub)
- **Rota**: `/workspaces/[workspaceId]/settings`
- Único check de papel do módulo inteiro: `canSeeGovernance` (só controla visibilidade de 1 link).
- **Achado**: card "Equipe" mostra métricas de **workspace** membership mas linka para tela de **tenant** membership (Usuários) — dois modelos de dado diferentes sob o mesmo rótulo.
- **Design system**: **IGNORA o padrão `HubPage`** que existe no próprio DS para exatamente este caso (portal de cards); empty/loading como texto solto.

#### Usuários
- **Rota**: `/workspaces/[workspaceId]/settings/users`
- **Fluxo CRUD real e completo**: convidar, trocar papel, remover, revogar convite — confirmado por código, não é só leitura.
- **RBAC: nenhum check de papel no frontend** — qualquer papel (inclusive viewer) abre a tela e vê os controles.
- **Falhas de mutação silenciosas**: trocar papel/remover/revogar **sem try/catch** — 403/erro de rede vira "nada aconteceu" sem feedback algum.
- Lista de membros mostra **UUID cru**, não nome/e-mail — administra "pessoas" vendo só IDs opacos.

#### Equipes
- **Rota**: `/workspaces/[workspaceId]/settings/teams`
- **Times existem de verdade** (CRUD real, consumido de fato por Automações — não é decorativo).
- Mesmo padrão de RBAC ausente e mutações sem tratamento de erro que Usuários.
- Adicionar membro pede **ID do usuário como texto livre** — candidato clássico a `SearchableCombo` (existe no projeto, não usado aqui).

#### Produtos e Serviços
- **Rota**: `/workspaces/[workspaceId]/settings/products`
- Só ativar/desativar — **sem editar nome/preço nem excluir** depois de criado, apesar da API suportar.
- Backend suporta busca/filtro (`search`/`activeOnly`) — **não exposto na UI**.

#### Automações
- **Rota**: `/workspaces/[workspaceId]/settings/automations`
- Regras "gatilho+condições(até 3)+ação". Campo de responsável (`assign_owner`) é texto livre pedindo ID.
- Botão "+ Condição" **some** ao chegar em 3 (sem explicação) em vez de ficar desabilitado+Tooltip (viola regra 8: "nunca escondido").

#### Plano e Cobrança
- **Rota**: `/workspaces/[workspaceId]/settings/plano`
- **A ÚNICA das 6 telas de Configurações em que TODAS as mutações tratam erro de forma consistente e visível** (toast via sonner) — contraste direto com as outras 5.
- Único enforcement real client-side de todo o módulo Configurações: bloqueia downgrade no cliente se exceder cota do novo plano.
- **Achado**: preço do plano mostrado é sempre mensal mesmo em ciclo anual — pode não refletir o que será cobrado. `StatusBadge` sem mapeamento para vários status reais (`trial_expired`, `paid`, `open`, `void`) — caem no fallback cinza com texto cru.
- **RBAC ausente** também aqui — potencialmente mais sensível (envolve dinheiro): um `viewer` que chegue à rota pode cancelar assinatura/trocar plano/abrir portal de pagamento sem bloqueio de UI.

**Achados transversais do módulo Configurações/Billing** (confirmado pelo agente): nenhuma das 6 telas usa `HubPage`/`PageSubnav`/`ListCard`/`StatsGrid`/`SearchableCombo` de forma estrutural — todas usam `Card`+`Table` avulsos sem paginação, mesmo quando a API já suporta filtro/busca (caso de Produtos).

### 1.7 Admin / Bastidor

#### Bloco A — Painel Admin de Plataforma (`/admin/*`)
- `/admin` (dashboard financeiro), `/admin/tenants` (lista), `/admin/tenants/[id]` (operação manual de billing sem gateway), `/admin/settings` (AI Gateway/chave Anthropic), `/admin/ai-providers` (credenciais OpenAI/Gemini + financeiro por provedor), `/admin/growth` (funil de aquisição/MRR).
- Gate duplo real: client-side `RequirePlatformAdmin` + backend `requirePlatformAdmin` (403).
- Design system em geral **USADO CORRETAMENTE**; `/admin/ai-providers` usa tabelas HTML cruas em 3 seções (inconsistência local) e mistura 3 responsabilidades num scroll longo sem `PageSubnav`.

#### Bloco B — Bastidor técnico do workspace (7 telas, `BACKSTAGE_NAV`)
Planejamento, Runtime, Execução, Publicação Técnica, Provedores, Governança, Operação.
- **RBAC**: `canUseBackstage()` = só owner/admin, enforcement **centralizado no layout** do workspace (nenhuma das 7 páginas checa individualmente).
- **Achado importante**: comentário do código em Runtime está **desatualizado/incorreto** — diz "sem nenhuma ação" mas a tela tem 2 botões reais e sensíveis ("Criar execução real").
- Execução é a tela mais densa de jargão técnico de todo o escopo (`traceId`, `fencingToken`, `handlerId`).
- **Publicação Técnica é o único par lista+detalhe de TODO o escopo (incluindo CRM/Marketing) que usa `DetailModal` corretamente.**
- Governança tem o melhor exemplo de `ConfirmDialog` rigoroso em toda a auditoria (nomeia credencial+consequência em toda ação sensível).
- Operação é a única do bloco que usa `PageSubnav`.
- Ver seção "Avaliação geral do Bastidor" nos achados consolidados abaixo (13).

### 1.8 Onboarding / Site Público

Ver inventário completo na seção 1.1 (Login) e abaixo:

- **Landing** (`/`): 4 features fixas + preview de planos; **falha de API de planos é 100% silenciosa** (seção some sem aviso); preço em USD com copy 100% PT-BR; sem prova social/FAQ; botões `h-9` (abaixo do alvo de toque mobile ~44px).
- **Pricing** (`/pricing`): **achado crítico de funil** — TODOS os planos (inclusive pagos) levam ao mesmo `/signup` que só cria FREE; comentário do próprio código admite que a tela de upgrade pós-signup "ainda está por construir" — hoje é **impossível comprar um plano pago** pelo funil público.
- **Signup** (`/signup`): após criar conta, uma 2ª chamada (`listWorkspaces()`) descobre o workspaceId pra redirecionar ao onboarding; se falhar, cai silenciosamente em `/workspaces` (lista genérica) em vez do onboarding guiado.
- **Login**: sem "esqueci minha senha" em nenhum lugar do código; sem link pra `/signup`.
- **Privacy/Terms/Data Deletion**: texto sem acentuação em vários trechos (parece erro de encoding); contato aponta pra **email pessoal** (`cleverton@si9sistemas.com.br`) em vez de canal institucional.

---

## 2. Classificação por área

| Área | Telas |
|---|---|
| **INÍCIO** | Home (`/`), Onboarding, Seletor de Workspaces, Login |
| **CONVERSAS / ATENDIMENTO** | Conversas (WhatsApp), Mensagens (Instagram DM), Conexões (canais de atendimento) |
| **COMERCIAL / CRM** | Contatos, Negócios (Kanban), Tarefas, Propostas, Proposta pública |
| **MARKETING** | Criar, Chat (fantasma), Produção, Conteúdos, Calendário, Publicar, Marca, Assets (fantasma), Instagram/Facebook/TikTok (fantasmas), Meta Ads, 4 callbacks OAuth |
| **RESULTADOS / ANALYTICS** | Analytics, Resultados |
| **CONFIGURAÇÕES** | Configurações (hub), Usuários, Equipes, Produtos, Automações |
| **BILLING / SAAS** | Plano e Cobrança |
| **ADMIN / BASTIDOR** | `/admin`, `/admin/tenants`(+detalhe), `/admin/settings`, `/admin/ai-providers`, `/admin/growth`, Planejamento(+detalhe), Runtime(+detalhe), Execução(+detalhe), Publicação Técnica, Provedores, Governança, Operação |
| **ONBOARDING** | (mesma tela de Início — wizard) |
| **SITE PÚBLICO** | Landing, Pricing, Signup, Login, Privacy, Terms, Data Deletion |

Total de rotas reais mapeadas: **~57** `page.tsx`, das quais **6 são rotas fantasmas** (redirect puro, sem UI própria): `/chat`, `/chat/[id]`, `/assets`, `/instagram`, `/facebook`, `/tiktok` (nível workspace).

---

## 3. Fluxos do usuário por módulo

### Conversas (o que a UI REALMENTE permite)
Contato/conversa aparece → lista (**sem busca**) → seleciona → marca lida automático → lê timeline → responde (**só texto**) → no painel lateral: assume/transfere/finaliza/pausa IA, vincula ao CRM, vê contato truncado (**sem link pro perfil completo**), cria negócio/tarefa/proposta via modal local (sempre no pipeline/estágio padrão, sem escolha).

**NÃO EXISTE NA UI**: perfil de contato navegável; busca de conversas; anexo/mídia/emoji/template no compositor; indicador de "IA digitando"; visualização de mídia recebida; paginação de conversas/mensagens; qualquer `ConfirmDialog` antes de finalizar/transferir/pausar IA.

### Comercial/CRM (o que a UI REALMENTE permite)
Contato → Negócio (`contactId` **opcional**, sem UI pra vincular) → funil por drag (**sem UI de detalhe do negócio**) → Tarefa (**sem vínculo a negócio/contato na UI**) → Proposta (**sem vínculo na UI**) → envio manual do link (**sem integração com Conversas/WhatsApp** para disparo automático) → lead responde no link público → status muda, mas **nenhuma automação "de fábrica"** move o negócio pra Ganho (só se o usuário configurar uma regra manualmente) → **sem notificação visível** ao vendedor de que a proposta foi respondida.

**Achado central**: Contato → Negócio → Tarefa → Proposta **não são conectados na interface** — os campos de vínculo existem no modelo/API, mas nenhuma das 4 telas os expõe.

### Marketing (o que a UI REALMENTE permite, com "buracos" confirmados)
Criar (ideia) → ~~Chat com IA~~ **(rota fantasma, não existe)** → geração real com poll síncrono no navegador → Revisão (aprovar/rejeitar/pedir alteração) → **Conteúdos NÃO reflete aprovação automaticamente** (é preciso publicar manualmente em Publicar depois) → Publicar (rede+legenda+timing) → aparece em Conteúdos/Calendário.

**Buracos confirmados no código**:
1. Chat com IA: rota existe, funcionalidade não.
2. "Rotina automática" do Tanque: UI completa de configuração existe, execução automática real **não existe** (é 100% `localStorage`, sem job de backend).
3. Revisão → Conteúdos **não é automático** — são dois sistemas de dados desconectados (ExecutionRun/blueprint local vs. publicação de rede).
4. "Pedir alteração" na Revisão **não edita** a peça — gera uma peça nova do zero (gasta crédito de novo), sem deixar isso explícito.

---

## 4. Auditoria visual (transversal)

Achados que se repetem em múltiplas telas, com evidência de código:

- **Excesso de cards / blocos empilhados**: Home (9+ blocos), Analytics (5 abas com múltiplos KPIs cada).
- **Botões primary competindo**: Home (checklist + Intelligence + 4 atalhos, nenhum dominante).
- **Cores inconsistentes**: duas gerações de tokens coexistindo (`text-ink`/`bg-surface-raised` antigos vs. `text-foreground`/`bg-card` novos) em Workspaces, Onboarding, Login, Publicação Técnica; mensagens de erro usam `text-red-600` cru em vez de `text-destructive` em Login/Signup/Pricing.
- **Hierarquia fraca**: card do Kanban (Negócios) tem informação **insuficiente** (não excesso) — falta responsável/contato/próxima atividade que já existem no modelo.
- **Informação importante escondida**: status da conversa (aberta/pendente/resolvida) só aparece no painel lateral de Conversas, não no header da timeline.
- **Componentes pequenos demais**: coluna de contexto do Conversas sempre ocupa 320px mesmo vazia, sem conteúdo.
- **Uso ruim de modal/drawer**: `Conteúdos` e `Calendário` usam drawer full-screen custom pro detalhe (viola regra "detalhe = DetailModal, nunca drawer"); `Contatos` e `Propostas` usam painel lateral fixo em vez de DetailModal; `Produção` usa dialogs `fixed inset-0` custom.
- **Headers inconsistentes**: `/create` ignora `PageHeader` (usa `<h1>` cru), enquanto praticamente todo o resto do produto usa.
- **Tabs reimplementadas em vez de PageSubnav**: sub-navegação de abas do Analytics (pills com scroll horizontal); alternância Fila/Tanque em Produção; Mês/Semana/Lista em Calendário.
- **Ícones inconsistentes**: glifos Unicode (`◎♪f▶`) em Conteúdos/Calendário/Publicar/Meta Ads vs. `lucide-react` em Criar/Produção — nenhuma fonte única de ícone de rede social no produto inteiro.
- **Elementos "admin técnico" em vez de produto SaaS**: as 7 telas de Bastidor (UUIDs crus, `traceId`/`fencingToken`/`decisionCode`, "disjuntor"/circuit breaker) e `/admin/ai-providers` (tabelas HTML cruas, jargão de billing interno).
- **Tabelas HTML cruas em vez do primitivo `Table`**: `/admin/ai-providers` (3 seções), detalhe de Execução (3 seções).

---

## 5. Auditoria de UX (transversal)

- **O usuário entende em 3s o que fazer?** Sim, com clareza, em: Login, Signup, Landing, Pricing, Publicar (CTA fixo no rodapé), Onboarding (uma ação por passo). Não fica claro em: Home (3 CTAs competindo), Configurações (hub sem hierarquia de prioridade entre os cards).
- **Existe ação principal clara?** Ausente em Home; presente na maioria das telas de listagem (padrão "Novo X" no header).
- **Excesso de opções?** Publicar (4 seções sempre expandidas mesmo pro caso simples "1 rede, agora"); Meta Ads (segmentação avançada sempre visível, sem "básico vs. avançado").
- **Navegação excessiva?** Fluxo Contato→Negócio→Tarefa→Proposta exige o usuário lembrar manualmente as relações (sem breadcrumb/link cruzado); Kanban não tem detalhe do negócio nenhum (clique no card não faz nada).
- **Ações que deveriam ser contextuais?** Em Conversas: "Liberar"/"Transferir"/"Pausar IA" ocupam painel lateral permanente — bons candidatos a menu "Mais" contextual.
- **Informações que deveriam estar escondidas até necessárias?** Bloco "Inteligência artificial" do Conversas (sempre expandido); campos de segmentação avançada do Meta Ads.
- **Ações duplicadas?** "Criar conteúdo" em 5+ lugares; 2 implementações divergentes de disparo de geração de IA (Criar vs. Produção); cancelamento de publicação implementado 3 vezes independentes.
- **Funcionalidades importantes longe demais?** Métricas de atendimento (Inbox) só existem em `/results`, desconectadas da tela de trabalho diário (`/conversas`).
- **Tela que deveria ser drawer/modal em vez de página?** Nenhuma identificada no sentido inverso (o problema é o oposto: telas usam drawer onde deveriam usar `DetailModal`).
- **Página que deveria ser modal em vez de drawer?** Detalhe de Conteúdos/Calendário/Contatos/Propostas — todos deveriam ser `DetailModal` conforme a regra 2 do design system, hoje são drawer/painel lateral fixo.
- **Tela que deveria se fundir com outra?** Analytics×Resultados têm nomes genéricos adjacentes na navegação sem comunicar a distinção real (uma é conteúdo/publicação, outra é atendimento/comercial) — não precisam se fundir tecnicamente, mas a apresentação hoje confunde.

---

## 6. Foco especial: Conversas

### Layout atual (medido em código)
3 painéis **flex** (não grid) num único container com borda (`inbox-tab.tsx:102`):

| Área | Classe Tailwind | Largura resultante |
|---|---|---|
| Lista | `md:w-80 md:flex-none` | 320px fixos (≥768px) |
| Timeline | `min-w-0 flex-1` | Resto do espaço, **sem teto** (em monitor grande, esticada ao extremo) |
| Contexto/CRM | `md:w-80 md:flex-none` | 320px fixos, **sempre renderizado mesmo sem conversa selecionada** |
| Bolha de mensagem | `max-w-[75%]` | 75% do container pai (que já é ilimitado) |

Nenhuma das 3 colunas é redimensionável pelo usuário.

### Lista de conversas — item a item
- **Busca**: **NÃO EXISTE**.
- **Filtros**: 7 chips (Todas/Minhas/Não atribuídas/Não lidas/Em atendimento/Pendentes/Finalizadas), scroll horizontal sem indicação visual de mais itens.
- **Status**: existe, mas as 4 badges (Em atendimento/Pendente/Finalizada/Arquivada) são **visualmente idênticas** (outline neutro) — só o texto distingue.
- **Canal**: **NÃO EXISTE indicador** — se o workspace tem múltiplos números WhatsApp, impossível saber de qual número é a conversa.
- **Unread**: existe (pill circular com contagem).
- **Avatar**: só iniciais, nunca foto real.
- **Nome**: existe, truncado.
- **Preview da última mensagem**: **NÃO EXISTE** (diferente do Instagram DM, que tem isso).
- **Timestamp**: existe (hora da última mensagem).

### Área de mensagens
- **Header**: nome+telefone, badge de status IA/atendimento, botão voltar/detalhes (mobile). **Não mostra** status da conversa (aberta/pendente/resolvida) nem conexão/número usado.
- **Bolhas**: outbound à direita (primary), inbound à esquerda (muted), rótulo de remetente (IA/Automação/Atendente) só em outbound.
- **Eventos**: pill central cinza, nunca se mistura com bolhas.
- **Compositor**: `Textarea` crescente, Enter envia. **Sem anexo, emoji ou template.**
- **Mensagens de mídia NÃO SÃO RENDERIZADAS** — só imprime `message.body` como texto; uma foto recebida aparece como bolha vazia/legenda solta.

### Painel lateral (contexto)
Seções sempre expandidas em sequência única, sem colapso: dados do contato → Atendimento (assumir/transferir/finalizar) → Inteligência artificial (pausar/reativar) → CRM (lead score, tags, responsável, negócios até 4, tarefas até 3, Copiloto Comercial, botões +Negócio/+Tarefa/+Proposta).

- **Sem link "ver todos"** para negócios/tarefas além dos 4/3 primeiros.
- **Sem link para o perfil completo do contato** em `/contacts`.
- Campo "Responsável" do CRM é input de texto livre pedindo UUID (inconsistente com o seletor de transferência de conversa, que corretamente usa `SearchableCombo`).
- Estado "assumir" × IA pode ficar inconsistente: o próprio código documenta que `assign()` nunca desliga `aiEnabled` no banco — "IA ativa" pode aparecer numa conversa que nunca vai responder.

### Ações de IA visíveis
Badge na lista, badge no header, texto+botão na seção "IA" do painel, pills de evento na timeline. **Não existe indicador de "IA gerando resposta agora"** em tempo real — só pill pós-fato.

### Comportamento mobile
`MobileView` (`list`/`conversation`/`details`) alterna via `hidden`/`flex` puro — nunca drawer real, nunca 2 painéis ao mesmo tempo. **Sem deep-link/histórico do navegador por painel** — refresh sempre volta pra lista. Painel "Detalhes" precisa rolar tudo (CRM+atendimento+IA) numa tela só, sem priorização adicional pra tela pequena.

### Diagnóstico (só descrição, sem solução definitiva)
- **O que está poluindo visualmente**: painel de contexto acumula tudo sem colapso; coluna de contexto vazia ocupando espaço permanentemente; badges de status/IA duplicadas em 3 lugares simultâneos.
- **O que deveria ficar sempre visível**: nome/telefone + status da conversa no header; unread/status na lista; compositor.
- **O que deveria virar drawer/sob demanda**: o bloco de CRM inteiro (hoje fixo, sempre expandido).
- **O que deveria aparecer só quando necessário**: bloco "Inteligência artificial" (condensar); botão "Gerar sugestões" do Copiloto (hoje sempre visível mesmo sem indício de oportunidade).
- **O que deveria estar no topo vs. lateral**: status da conversa deveria estar no topo (hoje só na lateral); ações de alta frequência (Assumir/Finalizar) poderiam estar no header.
- **O que deveria ficar em menu "Mais"**: Liberar, Transferir, Pausar IA, ações de tag.
- **O que deveria desaparecer no mobile**: hoje nada desaparece (consistente com "nunca 3 colunas juntas"), mas o painel Detalhes deveria esconder itens secundários (Copiloto, negócios/tarefas) atrás de "ver mais".

Outros achados relevantes do módulo:
- **Ambiguidade "Conexões"**: existe `/connections` (nível topo, publicação de conteúdo) e uma aba interna também "Conexões" dentro de Conversas (WhatsApp/atendimento) — mesmo rótulo, dois conceitos.
- **RBAC ausente**: qualquer membro pode assumir/transferir/finalizar/pausar IA de qualquer conversa.
- **`CONVERSATIONS_MODULE_ENABLED` nunca é checada no frontend** — item de nav aparece incondicionalmente independente da flag.
- **Envio de mensagem sem tratamento de erro** — usuário pode achar que enviou quando falhou.

---

## 7. Foco especial: CRM / Kanban

### Pipeline
Seletor só aparece com >1 pipeline; seleção default = índice 0 (ignora `Pipeline.isDefault`); `<Select>` nativo (aceitável só se a lista permanecer pequena).

### Etapas
**100% fixas no backend** — **não existe nenhuma tela de configuração de etapas no frontend** (nenhum `createStage`/`updateStage`/`reorderStage` usado). Cor: só 3 variantes (verde=ganho, vermelho=perdido, azul=**todas** as intermediárias, sem diferenciação entre elas).

### Campos no card — TODOS os campos renderizados
1. Título · 2. Origem (opcional) · 3. Valor (`tabular-nums`) · 4. Tempo relativo desde última mudança de etapa.

**Avaliação**: isto é **pouco, não muito**. Faltam campos que já existem no modelo `Deal` e não aparecem: **responsável, contato vinculado, próxima atividade/tarefa, data prevista de fechamento, tags**. O problema real não é excesso de informação — é falta de hierarquia/contexto: o vendedor não sabe, olhando o quadro, de quem é cada negócio.

### Drag-and-drop
HTML5 DnD nativo puro (sem lib). Problemas confirmados no código:
- **Sem optimistic update** — card só se move após o round-trip da API completar.
- **Sem loading state** durante o drag.
- **Sem tratamento de erro** — `handleDrop` sem try/catch; falha na API não avisa o usuário, card simplesmente "não se move".
- **Sem debounce/lock** contra drops múltiplos rápidos.
- **Sem validação** do `dealId` recebido via `dataTransfer`.
- **HTML5 DnD nativo NÃO funciona em touch/mobile sem polyfill, e não há fallback** (long-press, menu "mover para etapa X") — **em mobile, mover negócio de etapa não é possível pela UI.**

### Filtros e busca
Busca por título OK; filtro "responsável" é `<Input>` de texto livre exigindo UUID manual — praticamente inutilizável para um vendedor comum. Sem filtro por origem, período, tags, ou "sem próxima atividade" (o backend já calcula isso, não é exposto).

### Criação/edição
Só criação (título/valor/origem); etapa de criação sempre a primeira do pipeline (hardcoded); **não pede contato nem responsável**. **Não existe edição de negócio na UI** (`updateDeal` existe na API, não é usado).

### Detalhes do negócio
**Não existe tela/modal de detalhe.** Clicar no card não faz nada (sem `onClick`) — `getDealTimeline`/`useDealTimeline` existem no código e estão **mortos** (não referenciados por nenhum componente).

### Comportamento mobile
`overflow-x-auto` simples (scroll horizontal puro, sem virar lista, sem snap). Combinado com DnD quebrado em touch: em celular dá pra **criar e ver** negócios, mas **não mover** de etapa.

### Resumo dos achados-chave
Informação insuficiente no card (não excesso) · falta de hierarquia visual entre etapas · colunas de largura fixa crescem sem limite · drag-and-drop sem optimistic update/loading/erro/alternativa touch · nenhuma ação alcançável em menos de "arrastar" · etapas e pipelines são somente leitura no frontend.

---

## 8. Foco especial: Home

### Classificação de cada elemento

| Elemento | Tipo |
|---|---|
| StatusBadge do workspace | MÉTRICA |
| Data de criação | MÉTRICA |
| Checklist de onboarding | CONFIGURAÇÃO |
| Botão "Continuar configuração" | AÇÃO |
| KPI "Gerados em 30 dias" | MÉTRICA |
| KPI "Em produção" | MÉTRICA |
| KPI "Aguardando revisão" | MÉTRICA (viés de ALERTA, sem CTA direto) |
| KPI "Publicados em 30 dias" | MÉTRICA |
| Intelligence — sugestões | ALERTA + AÇÃO |
| Intelligence — tarefas atrasadas | ALERTA + AÇÃO |
| 4 Cards de atalho | ATALHO (2 misturam MÉTRICA na descrição) |
| Métricas gerais (5 itens) | MÉTRICA (1 duplicata exata do KPI do topo; "Falhas" é ALERTA visual sem CTA) |

### A Home mostra informação demais? **SIM**, com evidências concretas:
1. Métrica duplicada 2x com estilos diferentes ("Publicados em 30 dias" no StatsGrid e em "Métricas gerais").
2. Contagens repetidas em até 3 lugares simultâneos (KPI + card de atalho + métricas gerais).
3. Dois blocos de KPI com propósito idêntico (topo vs. rodapé) sem diferenciação clara de prioridade.
4. 5 seções empilhadas força rolagem grande mesmo em desktop (nenhum uso de colunas paralelas para reduzir altura total).
5. Vorix Intelligence (100% CRM) ocupa seção de peso visual igual ao resto mesmo quando vazia ("Tudo em dia") na maior parte do tempo.

**Maior candidato a redundância pura**: a seção inteira "Métricas gerais" — repete "Publicados 30 dias" do StatsGrid; as outras 4 métricas são números frios sem tendência/comparação, sem gráfico (apesar do kit de gráficos `ChartCard` existir e ser usado em Analytics).

---

## 9. Foco especial: Marketing

### Duplicação de ações entre telas
- **"Criar conteúdo" existe em pelo menos 5 lugares diferentes** (header de Conteúdos, header de Calendário, empty states de Produção/Conteúdos/Calendário, o próprio `/create`, "+ Nova ideia" em Produção).
- **Duas implementações paralelas e divergentes** de disparo de geração real de IA: `/create` (com retry automático de qualidade) e `/production`/`/review` (cada um reimplementa sua própria cópia do retry, sem compartilhar).
- **"Publicar de novo"/"Ajustar no Publicar"/"Tentar novamente"** — 3 rótulos diferentes para o mesmo destino (`/publish?network=&source=`).
- **Cancelar publicação implementado 3 vezes independentes** (Conteúdos, Calendário, Publicar) — só 2 das 3 usam `ConfirmDialog`.

### Telas que parecem diferentes entre si
- **Ícones de rede social**: `lucide-react` em Criar/Produção; glifos Unicode (`◎♪f▶`) em Conteúdos/Calendário/Publicar/Meta Ads — nenhuma fonte única no módulo inteiro.
- **Detalhe de registro**: nenhuma das 6 telas do conjunto usa `DetailModal` de fato, apesar de existir pronto — Conteúdos/Calendário usam drawer custom, Produção usa dialog `fixed inset-0`, Marca usa modal de edição próprio.
- **Sub-navegação**: Marca e Meta Ads usam `PageSubnav` de verdade; Produção (Fila/Tanque) e Calendário (Mês/Semana/Lista) reimplementam a mesma ideia com botões locais.
- **Campo de seleção**: Criar/Meta Ads usam `Select` do DS; Conteúdos usa `<select>` nativo; Produção mistura os dois no mesmo arquivo.
- **Cartão de estatística clicável**: Conteúdos (`StatCard`) e Calendário (`Stat`) são dois componentes locais distintos pro mesmo conceito visual.

### Excesso de formulários/campos
- Publicar concentra 4 seções sempre expandidas (mídia/redes/legenda/timing) mesmo pro caso comum de 1 rede/publicar agora.
- Criar tem 3 blocos de escolha (tipo/formato/canal) que colapsam nas mesmas ~4 combinações pré-definidas.

### Excesso de opções técnicas expostas
- Meta Ads: "ID da Página do Facebook" em texto livre, URL de imagem colada manualmente (sem reusar a biblioteca de assets).
- Publicar: fuso horário como texto livre.
- Produção: mensagens de falha mostram texto cru do provedor de IA sem tradução.

### Campos avançados expostos cedo demais
- Meta Ads → Novo conjunto de anúncios: países/idade sempre visíveis, sem etapa "básico vs. avançado".
- Exemplo **positivo** de progressive disclosure: `RuleAdvancedSettings` em Produção (já atrás de "Ajustes avançados") e `ProgressivePanel` em Publicar.

### Achado mais enganoso do módulo
A **"rotina automática"** do Tanque (Produção): UI completa (dias/horários, badges "ativa/pausada", "próximo horário planejado") sugere um job real de backend, mas é **100% `localStorage`**, sem nenhum cron/job que gere ou publique sozinho — o próprio comentário do código admite isso.

---

## 10. Responsividade

Descrito a partir do código (classes Tailwind reais) — sem screenshot (nenhum browser disponível nesta auditoria).

| Tela | 1920/1440/1366px | Tablet | Mobile |
|---|---|---|---|
| Home | `max-w-6xl`; "degrau" 1024-1279px onde KPIs já são 4 col mas HubCards ainda 2 col | HubCards em 2 col | Empilha tudo, sem tratamento especial |
| Conversas | Timeline sem largura máxima — esticada em monitores grandes | 3 painéis cabem a partir de `md` (768px) | 1 painel por vez (`list`/`conversation`/`details`), sem deep-link |
| Kanban (Negócios) | Colunas `w-72` fixas, crescem sem limite horizontal | Mesmo comportamento, scroll horizontal | Scroll horizontal simples; **DnD não funciona em touch** — não dá pra mover negócio de etapa |
| Analytics | `RankingChart` com `width={120}` fixo comprime barras em telas pequenas | Ok | `EditorialFunnelChart` com rótulo `LabelList position="right"` tende a cortar em containers estreitos |
| Publicar | Grid `lg:grid-cols-[1fr_340px]`, aside sticky | Empilha | Ok, mas 4 seções sempre expandidas |
| Contatos | Grid `lg:grid-cols-[...]` | Empilha em 1 coluna abaixo de `lg` | Timeline aparece abaixo da tabela inteira, sem scroll-to |
| Site público (Landing/Pricing/Signup) | `sm:` breakpoints em quase todo bloco | Ok | **Sem menu mobile dedicado** (hambúrguer) — depende de `flex-wrap` puro no header |
| Bastidor (7 telas) | Tabelas com `overflow-x-auto min-w-[640-720px]` | Só com scroll horizontal | Disponível no menu mobile mas exige desktop confortável pra usar de verdade |

**Riscos de responsividade identificados por código** (sem confirmação visual):
- Kanban: DnD nativo HTML5 não funciona em touch — funcionalidade central da tela (mover negócio) **não operável em mobile**.
- `RankingChart`/`EditorialFunnelChart` (Analytics/Recharts): risco de corte de rótulo em telas estreitas.
- Landing: sem hambúrguer, header pode quebrar linha de forma não testada em ~320-360px.

---

## 11. Design system — adoção real

### Medição objetiva feita diretamente no código (contagem em 60 `page.tsx`)

| Componente | Telas que usam | % |
|---|---|---|
| `PageHeader` | 38 / 60 | 63% |
| `ListCard` | 12 / 60 | 20% |
| `StatsGrid` | 15 / 60 | 25% |
| `PageSubnav` | 5 / 60 | 8% |
| `DetailModal` | **4 / 60** | **7%** |
| `HubPage` | 3 / 60 | 5% |
| `DashboardKit` | 4 / 60 | 7% |
| `ConfirmDialog` | 17 / 60 | 28% |
| `<Tabs>` (proibido) | **0 / 60** | 0% — regra 100% respeitada |

### Violações confirmadas com arquivo/linha

| Regra do design system | Violação encontrada |
|---|---|
| Detalhe = `DetailModal`, nunca drawer | `campaigns/page.tsx` (`PublicationDetailDrawer`), `calendar/page.tsx` (`EventDrawer`), `Contatos`/`Propostas` (painel lateral fixo) |
| Sub-navegação = `PageSubnav`, nunca Tabs | Analytics (pills reimplementadas), Produção (Fila/Tanque), Calendário (Mês/Semana/Lista) |
| Listagem = `PageHeader→StatsGrid→filtro→ListCard` com paginação adaptativa | `admin/tenants/page.tsx:32` — **`PAGE_SIZE = 20` fixo confirmado**; Contatos/Propostas/Tarefas sem paginação nenhuma; Configurações inteiro (6 telas) sem `ListCard`/`StatsGrid` |
| Lista que cresce = `SearchableCombo` | Campo "Responsável" no CRM-panel de Conversas, em Equipes, em Automações — todos texto livre pedindo UUID |
| Ação destrutiva = `ConfirmDialog` nomeando o registro | "Cancelar" em Tarefas; "Remover ideia/regra" em Produção; "Desconectar" em `conversas/connections-tab.tsx`; "Cancelar agendamento" em Conteúdos — todos sem `ConfirmDialog` |
| Ação bloqueada = desabilitado + `Tooltip`, nunca escondido | Botão "+ Condição" em Automações **some** ao chegar em 3 (em vez de desabilitar); rede não conectada em Publicar sem `Tooltip` |
| Zero hex solto | Confirmado — só `globals.css`, `icon.svg` e `Logo.tsx` (aceitável); nenhuma violação real em componentes |
| `tabular-nums`/`Intl`/"—" para ausente | Analytics e Resultados mascaram métrica ausente como "0"/"0%"/"R$ 0,00" em vez de "—" — violação confirmada linha a linha em ambas |

### Reimplementações locais confirmadas (7 arquivos com Modal/Drawer/Dialog função local em vez do componente compartilhado)
`calendar/page.tsx`, `campaigns/page.tsx`, `instagram-dm/automation-tab.tsx`, `meta-ads/audiences-tab.tsx`, `meta-ads/page.tsx`, `meta-ads/pixels-tab.tsx`, `production/page.tsx`.

### Tabela consolidada por componente

| Componente | Status geral |
|---|---|
| `Button`/`Card`/`Input`/`Select` (primitivos) | USADO CORRETAMENTE na maioria; Meta Ads importa de `@/components/ui/*` direto em vez do wrapper |
| `PageHeader` | Bem adotado (63%), mas ignorado em `/create` e no hub de Configurações |
| `StatsGrid` | Adotado nas telas mais maduras (Analytics, Conteúdos, Bastidor); ignorado em Contatos, Propostas, Kanban, Configurações |
| `ListCard` + paginação adaptativa | Baixa adoção (20%) — `PAGE_SIZE` fixo confirmado em admin/tenants; várias listas sem paginação nenhuma |
| `DetailModal` | Adoção muito baixa (7%) apesar de ser regra "não-negociável" — só Publicação Técnica (Bastidor) o usa como pretendido |
| `PageSubnav` | Baixa adoção (8%) — Marca, Meta Ads, Operação (Bastidor), Conversas o usam corretamente; Analytics/Produção/Calendário reimplementam Tabs locais |
| `ConfirmDialog` | Adoção razoável (28%) mas inconsistente — Governança (Bastidor) e Conexões são referência; várias ações destrutivas do CRM/Marketing não usam |
| `SearchableCombo` | Existe e funciona bem onde usado (transferência de conversa), mas ignorado sistematicamente em campos "responsável"/"usuário" em 3+ telas diferentes |
| `EmptyState`/`ErrorState` | Boa cobertura geral, com exceção grave de `/results` (nenhum dos dois) |
| `StatusBadge` | Usado mas com taxonomia incompleta (`trial_expired`, `paid`, `open`, `void`, `error` de conexão caem no fallback cinza genérico) |
| `Badge` genérico usado em vez de `StatusBadge` | Usuários (convites), Produtos (ativo/inativo), Automações (ativa/inativa) |

---

## 12. Navegação

Fonte: `web/components/workspace-navigation.ts` (única fonte da sidebar, breadcrumbs e nav mobile).

```
HOME_NAV_ITEM       — Início
CREATE_NAV_ITEM     — Criar conteúdo (top-level, fora de seções)

MAIN_NAV_SECTIONS:
  CRIATIVO           — Produção, Conteúdos, Calendário
  DISTRIBUIÇÃO       — Publicar, Anúncios, Mensagens, Conversas, Contatos,
                       Negócios, Tarefas, Propostas, Conexões   (9 itens!)
  MARCA E RESULTADOS — Marca, Analytics, Resultados

SETTINGS_NAV         — Configurações
BACKSTAGE_NAV        — Planejamento, Runtime, Execução, Publicação Técnica,
                       Provedores, Governança, Operação          (7 itens, só owner/admin)

PRIMARY_MOBILE_NAV   — Início, Produção, Criar, Conteúdos          (4 itens)
MOBILE_MENU_NAV      — Publicar, Calendário, Anúncios, Mensagens, Conversas,
                       Conexões, Marca, Analytics, Configurações   (9 itens)
```

### Achados

- **Excesso de itens na seção "DISTRIBUIÇÃO"**: 9 itens misturando 3 domínios completamente diferentes — distribuição de conteúdo (Publicar/Anúncios), mensageria/atendimento (Mensagens/Conversas/Conexões) e CRM (Contatos/Negócios/Tarefas/Propostas). O rótulo "DISTRIBUIÇÃO" não descreve semanticamente CRM nem atendimento.
- **Agrupamento ruim confirmado por evidência de código**: já existe um plano de reorganização (`Fase A — Navegação`, ver plano de sessão) que identifica exatamente este problema e propõe separar em seções "VENDAS" e promover Conversas a item de topo — não implementado ainda.
- **Nome "Conexões" duplicado com significados diferentes**: `/connections` (nível topo, gerencia Meta/TikTok/YouTube para publicação) vs. aba interna "Conexões" dentro de `/conversas` (gerencia WhatsApp/WuzAPI para atendimento) — confirmado por 2 agentes de auditoria independentes como fonte real de confusão.
- **Nomes técnicos**: "Publicação Técnica", "Governança", "Operação" (itens do Bastidor) leem como jargão interno, não vocabulário de produto — consistente com o achado de que o Bastidor inteiro é instrumentação interna, não feature de cliente.
- **Funcionalidades que não deveriam ser item principal**: as 7 rotas do Bastidor coexistem na mesma sidebar/BottomNav que Produção/Publicar/Analytics, mesmo sendo, por conteúdo e RBAC, equivalentes a um painel administrativo separado (ver seção 13).
- **Itens que poderiam virar subnavegação contextual**: "Mensagens" (Instagram DM) e "Conversas" (WhatsApp) são dois inboxes paralelos e desconectados — poderiam ser canais dentro de uma única navegação de "Conversas" em vez de 2 itens de topo separados.
- **Gap de navegação mobile**: `MOBILE_MENU_NAV` **não inclui** Contatos, Negócios, Tarefas, Propostas, Resultados, nem nenhuma das 7 rotas de Bastidor — essas telas ficam efetivamente inacessíveis a partir do menu mobile "Mais" (confirmado por leitura direta do array).

---

## 13. Tabela de prioridade

Severidade: **P0** = quebra operação · **P1** = muito ruim/confuso · **P2** = precisa melhorar · **P3** = polish.

| Tela | Problema visual | Problema UX | Severidade | Impacto | Prioridade |
|---|---|---|---|---|---|
| Negócios (Kanban) | Card com pouca informação (falta responsável/contato) | Drag-and-drop não funciona em touch — mover negócio de etapa é impossível no mobile; sem detalhe de negócio (clique não faz nada) | **P0** | Funcionalidade central do CRM inoperável em mobile | 1 |
| Resultados | KPIs sempre numéricos mesmo sem dado | Loading/Error totalmente não tratados — falha de API é indistinguível de "zero real" em ~15 métricas de negócio | **P0** | Decisão comercial baseada em dado potencialmente falso | 2 |
| Conversas | Painel de contexto sempre expandido, sem hierarquia | Envio de mensagem sem tratamento de erro (usuário acha que enviou); RBAC zero (qualquer um assume/transfere/pausa IA de qualquer conversa) | **P0** | Perda de mensagem real ao cliente + falha de governança de acesso | 3 |
| Pricing/Signup | — | Todos os planos pagos caem em FREE — upgrade pós-signup não existe ainda | **P0** | Bloqueia monetização via funil público | 4 |
| Produção (Tanque) | Duas paletas de filtro coexistindo | "Rotina automática" sugere execução real que não existe (100% localStorage) | **P1** | Expectativa quebrada do cliente sobre automação prometida | 5 |
| Conversas | Badges de status idênticas visualmente | Sem busca de conversas; sem indicador de canal/número; mídia recebida não é renderizada | **P1** | Inviável em volume real de atendimento | 6 |
| Configurações (Usuários/Equipes) | UUID cru em vez de nome | Mutações (trocar papel/remover) sem tratamento de erro — falha vira silêncio total | **P1** | Admin não sabe se a ação realmente aconteceu | 7 |
| Marketing (Revisão→Conteúdos) | — | Aprovar conteúdo não o publica automaticamente — dois sistemas desconectados | **P1** | Confusão sobre "onde está minha peça aprovada" | 8 |
| CRM (Contato→Negócio→Tarefa→Proposta) | — | Nenhum vínculo exposto na UI entre as 4 entidades, apesar de existir no modelo | **P1** | Perda de contexto comercial, retrabalho manual | 9 |
| Home | 9+ blocos empilhados, métricas duplicadas | Sem ação principal dominante; sem tratamento de erro de API | **P1** | Primeira tela do produto passa impressão de desorganização | 10 |
| Analytics | Sub-nav reimplementada (pills) | Alertas somente leitura (API pronta, não conectada); timezone texto livre | P2 | Funcionalidade pronta no backend não utilizável | 11 |
| Propostas | — | Link público mostrado uma única vez, não recuperável | P2 | Perda de link obriga recriar proposta | 12 |
| Site público (Privacy/Terms) | Texto sem acentuação | Contato pessoal em vez de institucional em documento legal | P2 | Percepção de baixa maturidade/compliance | 13 |
| Bastidor (Runtime/Execução) | Tabelas HTML cruas | Comentário de código desatualizado diz "sem ações" mas há ações reais de produção sem segunda aprovação | P2 | Risco operacional de execução real acidental | 14 |
| Meta Ads | — | "ID da Página do Facebook" em texto livre; sem reusar biblioteca de assets | P2 | Fricção alta para usuário não-técnico | 15 |
| Navegação (DISTRIBUIÇÃO) | — | 9 itens de 3 domínios diferentes numa seção; "Conexões" duplicado com 2 significados | P2 | Confusão recorrente de onde encontrar cada função | 16 |
| Login | — | Sem "esqueci senha", sem link para signup | P2 | Suporte recebe tickets evitáveis | 17 |
| Diversas (drawers) | Detalhe como drawer em vez de DetailModal (Conteúdos, Calendário, Contatos, Propostas) | Inconsistência de padrão de interação entre módulos | P3 | Polish / débito de design system | 18 |
| Diversas (ícones) | Glifos Unicode vs. lucide-react | Inconsistência visual entre telas do mesmo módulo | P3 | Polish visual | 19 |
| Produtos/Configurações | — | Sem editar produto após criado; sem busca apesar da API suportar | P3 | Baixo volume de uso esperado | 20 |

---

## 14. Nota de escopo

Conforme instruído: **nenhuma linha de código foi alterada**, nenhuma tela foi redesenhada, nenhum componente novo foi criado e nenhum refactor foi realizado durante esta auditoria. Todo o conteúdo acima é observação direta do estado atual do repositório, com citação de arquivo/linha sempre que disponível pelos agentes de exploração. Nenhuma solução de redesign definitiva foi proposta — apenas descrição do estado atual e dos problemas encontrados, como solicitado.

## 15. Entrega

Este relatório está salvo em `docs/vorix-auditoria-frontend-ux.md`.
