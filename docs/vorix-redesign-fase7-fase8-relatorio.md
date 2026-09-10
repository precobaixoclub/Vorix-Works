# Vorix — Redesign Premium/Futurista — Relatório Fase 7 (Configurações + Billing + Onboarding) + Fase 8 (Site Público)

**Contexto de execução**: este bloco já estava em andamento por outra sessão ("Codex"), que ficou sem tokens no meio da implementação. Esta sessão assumiu o trabalho no ponto em que parou: auditou o que já existia em cada item do checklist do prompt, corrigiu as lacunas concretas encontradas, e validou tudo (typecheck/build/testes/architecture check). **Nenhuma tela das Fases 0-6 (App Shell, Conversas, Home, CRM, Resultados, Marketing) foi redesenhada nesta sessão** — apenas lida como referência. Admin/Bastidor não foi tocado. Nenhuma funcionalidade nova de produto foi criada.

**Aviso de validação visual**: não há browser disponível neste ambiente. Toda a avaliação abaixo foi feita por leitura de código (JSX/Tailwind/tokens) e pela saída do build do Next.js — **não houve confirmação visual real (screenshot) de nenhuma tela**. Conforme pedido explicitamente no prompt ("Não afirmar 'ficou premium' apenas olhando JSX"), este relatório evita esse tipo de afirmação e se limita a descrever o que o código produz.

---

## 1. Configurações — antes/depois

**Antes** (estado auditado na sessão anterior, `docs/vorix-auditoria-frontend-ux.md`): 6 telas independentes, cada uma com seu próprio header, sem navegação secundária compartilhada, hub com cards genéricos, várias mutações sem tratamento de erro, nenhum RBAC no frontend, campos de "responsável" pedindo UUID cru.

**Depois**: shell único (`web/components/settings/SettingsShell.tsx`) com `PageHeader` + `PageSubnav` compartilhados entre as 7 seções (Geral/Usuários/Equipes/Integrações/Produtos/Automações/Plano e cobrança), navegação por rota real (cada seção é uma URL própria, `PageSubnav` reflete a rota ativa). Todas as 7 telas usam o mesmo shell.

## 2. Estrutura final de Settings

```
SettingsShell (PageHeader + PageSubnav)
├─ Geral            → /settings
├─ Usuários         → /settings/users
├─ Equipes          → /settings/teams
├─ Integrações      → /connections        (reaproveitada, não duplicada)
├─ Produtos         → /settings/products
├─ Automações       → /settings/automations
└─ Plano e cobrança → /settings/plano
```

Geral (`/settings`) foi convertido de hub-de-cards para um formulário real: nome, descrição curta, fuso horário (select fechado), idioma, formato padrão — com loading/success/error via toast, exatamente como pedido (nenhum campo inventado sem backend).

## 3. Usuários

Avatar (iniciais) + Nome + E-mail + Papel (select) + ações — **nenhum UUID exibido** (`memberIdentity()` resolve nome/e-mail via `useInboxMembers`, com fallback textual quando a API não retorna o dado). Ações: alterar papel, remover acesso (`ConfirmDialog` nomeando a consequência), revogar convite. "Reenviar convite" **não foi implementado** porque a API não suporta (`POST /v1/tenant-members/invites/:id/resend` não existe) — conforme pedido, respeitado por omissão.

**RBAC real**: `canManageTenant()` (`web/lib/rbac.ts`) gira em torno de `GuardedButton` — quem não é owner/admin vê os botões desabilitados com `Tooltip` explicando o motivo ("Apenas owner e admin podem gerenciar usuários e equipes."), nunca escondidos.

**Falha nunca silenciosa**: convite/troca de papel/remoção/revogação têm `try/catch` com mensagem de erro visível em banner.

## 4. Equipes

Nome + contagem de membros (mestre-detalhe). Times são reais (CRUD completo, consumidos de fato por Automações para "distribuir para equipe"). Adicionar membro usa `SearchableCombo` com nome+e-mail — **nunca pede ID manual**. Exclusão de time e remoção de membro usam `ConfirmDialog`.

## 5. Produtos

Lista simples: nome, preço (`tabular-nums`), status. Criar/editar/ativar/desativar já implementados (edição era um gap real da auditoria anterior — **corrigido**: agora existe `ProductModal` reaproveitado para criar e editar). Busca client-side por nome. Nenhum estoque, tributação ou SKU complexo — mantido enxuto conforme pedido.

## 6. Automações

Construtor visual "Quando / Se / Então" (`RuleBlock`), com rótulos 100% em linguagem humana (nunca menciona "rule engine"). Limite de 3 condições: ao chegar no limite, o botão "+ Condição" fica **desabilitado com `Tooltip`** ("Você pode adicionar até 3 condições.") — **corrigido nesta sessão** (antes usava o atributo `title` nativo do HTML em vez do componente `Tooltip` do design system). Responsável em automação usa `UserPicker`/`TeamPicker` — nunca ID manual. Histórico de execução (`AutomationRunLog`) já mostra "Executada"/"Ignorada"/"Falhou" com o motivo humano quando há erro, sem expor código interno como experiência principal.

## 7. Integrações

`/connections` foi absorvida pelo `SettingsShell` como a aba "Integrações", com copy que distingue explicitamente de canais de atendimento ("Redes de marketing que o Vorix usa para publicar e medir conteúdos. Canais de atendimento ficam em Conversas."). IDs técnicos de provider (`openId`, `providerSubjectId`, `accountId`, `channelId`) foram **removidos dos rótulos visíveis** — hoje mostram "Instagram profissional", "Página do Facebook", "Conta TikTok", "Canal do YouTube" em vez do dado cru. Status usa `StatusBadge` com linguagem amigável.

## 8. Billing — status/entitlements

`StatusBadge` agora cobre todos os status reais relevantes de assinatura e fatura: `trial`, `trial_expired`, `active`, `past_due`, `suspended`, `canceled`, `void`, `paid`, `uncollectible`, em PT-BR — **confirmado completo, nada mapeando para o fallback genérico cinza**. Nesta sessão, os últimos badges que ainda usavam cor crua (`text-red-600`/`text-amber-700`) foram normalizados para os tokens semânticos `text-danger`/`text-warning` já usados pelo resto do componente (consistência total agora).

**Preço do ciclo real (auditoria anterior apontou risco de mostrar preço mensal em ciclo anual)**: auditado e confirmado corrigido — `cyclePrice()` só mostra o valor mensal quando o ciclo é `monthly`; em ciclo `yearly`, mostra explicitamente "Valor anual não informado pela API" em vez de aproximar (o catálogo público `GET /v1/platform/plans` só expõe `monthlyPriceUsd`, embora o modelo de domínio (`PlanVersion`) já tenha `yearlyPriceUsd` — **gap documentado abaixo**, não corrigido por exigir mudança de backend fora do escopo desta fase). O importante: a tela nunca mostra um número errado.

Fluxo de upgrade/downgrade, cancelamento (com data real de fim de período + `ConfirmDialog`), reativação, add-ons (compra/remoção com `ConfirmDialog`) e "Pagamento pendente" (banner contextual, sem alarmismo) — todos usando exclusivamente o backend já existente (`features/billing/api.ts`), nenhuma lógica nova de billing foi criada.

## 9. Onboarding — polish

- Logo real no header do wizard (antes era texto "Vorix").
- Trilha de passos nomeada visível (`1 Empresa · 2 Canal · 3 Equipe · 4 Comercial · 5 Marca`) além da barra de progresso percentual.
- QR do WhatsApp: agora renderiza uma imagem real (`<img>`) quando o backend entrega `data:image`/URL; quando não entrega imagem, mostra uma mensagem honesta em vez do bloco monoespaçado tosco anterior.
- Linguagem de "pular" padronizada: "Pular por enquanto" em todos os passos (antes eram 3 variações: "Conectar depois"/"Convidar depois"/"Completar depois").
- Removida a menção "Instagram e Facebook chegam em breve" do passo de Canal.
- Tela final: "Seu Vorix está pronto." com checklist do que foi concluído/pendente e CTA único "Ir para o Vorix" — igual ao pedido.

## 10. Landing

Hero com posicionamento exato do prompt ("Marketing, atendimento e vendas conectados por IA" + "Do primeiro conteúdo à venda..."), CTAs "Criar conta" / "Ver como funciona". Preview visual do produto é uma composição CSS/HTML própria (não foto de banco de imagens, não mockup genérico) simulando Command Center + Conversas + Pipeline lado a lado. Fundo com grid sutil + glow leve, sem "visual gamer".

## 11. Hero

Ver item 10 — `ProductPreview()` é construído com os mesmos tokens do produto (`bg-card`, `border-border`, `bg-primary/…`), não reaproveita literalmente os componentes reais de Conversas/CRM/Home. **Dívida restante documentada abaixo.**

## 12. Jornada do produto

Seção "Criar → Publicar → Conversar → Vender → Medir" implementada como grade numerada com 1 frase de contexto por etapa.

## 13. Seções

Marketing / Conversas / CRM (bullets fiéis às capacidades reais — Conversas menciona só WhatsApp, nunca Instagram/Facebook Inbox); Vorix Intelligence (4 exemplos de sinal — lead quente sem resposta, proposta sem retorno, tarefa atrasada, oportunidade — com a ressalva explícita de que a IA aponta contexto e sugere, nunca decide sozinha); "Por que Vorix" (Menos ferramentas / Mais contexto / IA integrada / Operação conectada). **Não existe seção dedicada "Resultados"** conectando Marketing+Atendimento+Comercial isoladamente — o conteúdo aparece distribuído nas seções de Solução/Intelligence. Prova social: corretamente ausente (nenhum depoimento inventado).

## 14. Pricing

Redesenhado: cards reais vindos de `GET /v1/platform/plans`, preço mensal + créditos + até 5 features por plano, badge "Mais escolhido" no plano em destaque. **Sem toggle anual decorativo** — o catálogo não entrega ciclo anual publicamente, e a tela comunica isso de forma transparente em vez de fingir. Sem tabela de 100 linhas — comparação textual simples, com nota de que o detalhe fica dentro do produto (Plano e cobrança).

## 15. Signup

Reduzido a e-mail + senha (removido qualquer campo além disso). **Correção crítica da auditoria anterior**: antes, todo plano (inclusive pago) criava conta FREE silenciosamente, sem levar o usuário a lugar nenhum relacionado ao plano escolhido. Agora: se o plano selecionado no Pricing não é FREE, o pós-cadastro redireciona para `/settings/plano` (Billing real) em vez do onboarding — o usuário chega exatamente onde pode de fato assinar o plano escolhido. Continua exigindo um clique manual em "Selecionar" dentro do Billing (não há auto-checkout automático a partir da URL — decisão deliberada desta sessão, ver item 26).

## 16. Login

Redesenhado com o mesmo layout split-panel do Signup. Adicionado link "Ainda não tem conta? Criar conta" (fechando a assimetria apontada na auditoria). "Esqueci minha senha" **não foi adicionado** porque a API não tem endpoint de recuperação de senha (confirmado: `src/interfaces/api/routes/v1/auth.route.ts` só tem login/signup/logout/refresh/switch-tenant/memberships/me) — gap documentado, nenhum link quebrado foi criado.

## 17. Legal

`Privacy` já estava correta (acentuação, e-mail institucional `privacidade@vorixworks.com`, `PublicHeader`/`PublicFooter`). **Nesta sessão**: `Terms` e `Data Deletion` foram reescritas do zero seguindo o mesmo padrão — acentuação corrigida, `PublicHeader`/`PublicFooter` aplicados, e-mails trocados para `legal@vorixworks.com` e `privacidade@vorixworks.com` (institucionais, nunca mais o e-mail pessoal `cleverton@si9sistemas.com.br`).

## 18. Mobile

`PublicHeader` tem menu hamburguer real (`Menu`/`X` do lucide, painel dedicado) — não depende mais de `flex-wrap`. Não foi possível validar visualmente em 430/390/360px (sem browser); a leitura de código indica classes responsivas (`sm:`/`md:`/`lg:`) consistentes com o padrão do resto do produto.

## 19. Dark/Light

O site público usa os mesmos tokens do produto (`bg-background`, `text-foreground`, `border-border`) — não foi criada uma paleta de marketing separada. Suporte a light theme preservado (herdado dos tokens globais, não haveria como quebrá-lo sem alterar `globals.css` de forma destrutiva, o que não foi feito).

## 20. Componentes criados nesta sessão

- Correção em `web/components/StatusBadge.tsx` (normalização de tokens de cor).
- Correção em `web/app/workspaces/[workspaceId]/settings/automations/page.tsx` (Tooltip real).
- Reescrita de `web/app/terms/page.tsx` e `web/app/data-deletion/page.tsx`.

## 21. Componentes reutilizados (já existentes, construídos pela sessão anterior)

`SettingsShell`, `GuardedButton`, `UserPicker`, `TeamPicker`, `ChannelIcon`, `FilterBar`, `PublicHeader`, `PublicFooter`, `web/lib/rbac.ts`, `web/components/crm/DealDetailModal.tsx`.

## 22. APIs utilizadas

Nenhuma API nova. Consumidas as já existentes: `features/identity/api.ts` (tenant-members, teams), `features/crm/api.ts` (products, automation-rules, pipelines), `features/billing/api.ts` (overview, checkout, change-plan, addons, cancel/reactivate, portal), `features/platform-plans/api.ts` (catálogo público), `features/workspace/api.ts` (update workspace), `features/onboarding/*`, `features/inbox/hooks.ts` (useInboxMembers, para resolver nome/e-mail).

## 23. Backend alterado

**Nenhum.** Toda a Fase 7/8 consumiu backend já existente, conforme instruído ("Não desenvolver novo billing/checkout/onboarding/autenticação").

## 24. Claims removidos/corrigidos

- Landing/Pricing: nunca mencionam Instagram/Facebook/TikTok Inbox como existentes.
- Landing: nenhuma promessa de execução automática de IA sem supervisão ("a IA aponta e sugere, nunca decide sozinha").
- Landing: nenhuma atribuição de receita de Ads inventada.
- Pricing: nenhum toggle anual decorativo quando o backend não entrega o dado.
- Legal: e-mail pessoal removido de todas as páginas legais.

## 25. Gaps encontrados (documentados, não corrigidos nesta fase)

1. **Preço anual real não exposto publicamente**: o modelo de domínio (`PlanVersion`) já tem `yearlyPriceUsd`, mas o catálogo público (`listPublicPlans()`, `platform-plan-catalog.ts`) só expõe `monthlyPriceUsd`. A tela de Billing evita mostrar número errado, mas não mostra o valor anual real. Corrigir exigiria expor o campo já existente no domínio através do endpoint público — mudança pequena, porém de backend, fora do escopo desta fase.
2. **Login sem "esqueci minha senha"**: não existe endpoint de recuperação de senha no backend. Nenhum link quebrado foi criado.
3. **Reenviar convite de usuário**: API não suporta; não implementado por decisão explícita do prompt.
4. **`/analytics` não está mais em nenhum menu de navegação** (principal ou mobile) — a tela existe e continua acessível só por link direto a partir de Calendário/Resultados. Isso decorre da reorganização de navegação feita numa fase anterior (Comercial/Marketing/Resultados, fora do escopo desta sessão) — **não alterado aqui** por não ser uma decisão desta fase, mas sinalizado porque afeta descoberta da funcionalidade.
5. **Continuidade Pricing → Signup → Billing não é 100% automática**: ao chegar em `/settings/plano` vindo de um plano pago selecionado no Pricing, o usuário ainda precisa clicar manualmente em "Selecionar" no card do plano — decisão deliberada desta sessão para não disparar uma ação de cobrança/checkout automaticamente a partir de um parâmetro de URL (risco de efeito colateral em página de billing). Ver item 26.
6. **Componentes públicos não extraídos**: `Hero`, `FeatureSection`, `ProductPreview`, `PricingCard` (citados no prompt como componentes sugeridos) existem como funções locais dentro de `page.tsx`/`pricing/page.tsx`, não como arquivos separados em `web/components/public/`. Funcionalmente equivalente, mas não modularizado.
7. **Hero visual não reaproveita literalmente os componentes reais** (KpiCard, MessageBubble, DealCard) — é uma composição estilizada com os mesmos tokens, não uma renderização ao vivo da UI real.
8. **Nenhuma validação visual em browser real** foi possível nesta sessão (sem ferramenta de screenshot disponível) — ver item 31.

## 26. Nota de decisão de segurança (Billing)

Optei por **não** implementar auto-checkout/auto-seleção de plano ao chegar em `/settings/plano?plan=X` a partir do Signup, apesar de ser uma melhoria de continuidade sugerida pelo prompt (item 50 do enunciado). Risco identificado: disparar uma ação de cobrança (`startCheckout`/`changePlan`) automaticamente a partir de um parâmetro de URL, sem clique explícito do usuário nesta tela, é um efeito colateral perigoso numa área que envolve dinheiro real, e eu não tenho como validar esse fluxo contra o provedor de pagamento real neste ambiente. O comportamento atual (redirecionar para a tela certa + exigir um clique explícito) já corrige o bug crítico encontrado na auditoria (toda intenção de compra virando FREE silenciosamente) sem introduzir esse risco novo.

## 27. Arquivos modificados nesta sessão

- `web/app/terms/page.tsx` (reescrito)
- `web/app/data-deletion/page.tsx` (reescrito)
- `web/app/workspaces/[workspaceId]/settings/automations/page.tsx` (tooltip real no limite de condições)
- `web/components/StatusBadge.tsx` (normalização de tokens de cor)

**Arquivos já modificados pela sessão anterior** (auditados e validados, não retrabalhados): os 38 arquivos e 8 componentes/diretórios novos listados nas seções 20-21, cobrindo Settings (7 telas), Billing, Onboarding, Landing, Pricing, Signup, Login, Privacy, PublicHeader/PublicFooter, RBAC (`web/lib/rbac.ts`), e os pickers (`UserPicker`/`TeamPicker`/`GuardedButton`).

## 28. Testes

`cd web && npm run test` (vitest) — **25/25 testes passando** (4 arquivos de teste: `publication-history`, `format`, `api-client`, `production-line-api`). Suíte de testes de frontend é enxuta por natureza do projeto (cobertura de unidade, não E2E) — pré-existente, não ampliada nesta fase (fora do escopo pedido).

## 29. Typecheck

`cd web && npm run typecheck` — **limpo, 0 erros**, rodado após todas as correções desta sessão.

## 30. Build

`cd web && npm run build` — **compilado com sucesso**, todas as ~57 rotas geradas (incluindo `/terms` e `/data-deletion` recém-reescritas), sem erros de TypeScript nem de geração estática.

Adicionalmente, `npm run architecture:check` (raiz do repositório) rodado como sanidade: **todos os 9 checks de isolamento arquitetural passaram** (nenhum arquivo de backend foi tocado nesta fase, então o resultado era esperado, mas foi confirmado, não presumido).

## 31. Screenshots

**Não disponíveis.** Este ambiente não tem acesso a um navegador/ferramenta de captura de tela. Conforme instruído no prompt, isso é declarado explicitamente em vez de presumir que o resultado "ficou premium" apenas pela leitura do JSX. Todas as descrições de layout acima vêm de leitura de classes Tailwind e estrutura de componentes, não de inspeção visual real.

## 32. Dívida restante

1. Expor `yearlyPriceUsd` (já existente no domínio) através do catálogo público de planos, para a tela de Billing mostrar o valor anual real em vez de "não informado".
2. Extrair `Hero`/`FeatureSection`/`ProductPreview`/`PricingCard` como componentes reutilizáveis em `web/components/public/` (hoje são funções locais).
3. Avaliar se a Hero da landing deve reaproveitar componentes reais do produto (KpiCard, MessageBubble) em vez de uma composição estilizada equivalente.
4. Decidir se `/analytics` deve voltar a um menu de navegação (hoje só alcançável via link direto) — decisão de fase anterior, não desta sessão.
5. Continuidade Pricing→Signup→Billing: decidir, com o time, se vale o risco de um auto-select (não auto-checkout) do plano na tela de Billing ao chegar via `?plan=`, como meio-termo mais seguro que o auto-checkout.
6. Validação visual real (screenshots em 1440/390px, dark/light) ainda pendente — depende de acesso a browser, não disponível nesta sessão.

---

**Classificação**: Fase 7 (7A/7B/7C/7D) e Fase 8 (8A/8B/8C) **implementadas e validadas por código** (typecheck/build/testes/architecture check verdes). **Não** classificado como "validado visualmente" — essa etapa depende de uma sessão com acesso a browser.

Parando aqui, conforme instruído. Não iniciado redesign de Admin/Bastidor nem funcionalidade nova. Aguardando revisão.
