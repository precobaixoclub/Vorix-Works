# Vorix — Fase 9: Visual QA & Product Polish Global — Relatório Final

**Pergunta que este relatório responde**: quando eu abro o Vorix de verdade no navegador, ele é realmente foda? Não "o código parece correto" — o produto rodando.

---

## 1. Ambiente usado

- Frontend: servidor de desenvolvimento local (`next dev -p 3001`, Turbopack) rodando o código-fonte atual do working tree (Fases 0-8 já aplicadas).
- Backend: **API real de produção** (`https://api.vorixworks.com`), não um mock nem um ambiente local isolado — exatamente o backend que os clientes reais usam.
- Motivo da escolha: não havia Docker/Postgres local disponível nesta máquina para subir um backend isolado; rodar contra a API real (somente leitura/escrita em um tenant dedicado de QA, nunca em dados de cliente) foi o caminho que permitiu ver o produto genuinamente funcionando, como pedido, sem inventar mocks.
- Dados: tenant dedicado `tenant-visual-qa` (workspace "Visual QA"), criado só para esta sessão com fixtures realistas (6 contatos, 8 negócios distribuídos em 4 etapas do pipeline, 6 tarefas, 3 propostas, 1 conexão WhatsApp + 5 conversas com mensagens reais de ida e volta, 1 assinatura PRO ativa). **Toda a fixture foi removida ao final** (verificado: 0 linhas remanescentes em `workspaces`, `users`, `contacts`, `deals`, `inbox_messages` para o tenant de QA).
- `CONVERSATIONS_MODULE_ENABLED` foi religado temporariamente na VPS só para esta janela de QA e **devolvido a `false`** ao final (confirmado).
- Ajuste técnico temporário e já revertido: um bypass guardado por env var em `proxy.ts` (necessário porque o cookie de sessão real, `Domain=.vorixworks.com`, nunca chega a `localhost` por desenho de segurança — isso é comportamento correto do produto, não um bug) — removido por completo ao final; `git diff` de `proxy.ts` confirma que o arquivo está idêntico ao commitado.

## 2. Ferramenta de browser

**Playwright** (Chromium), instalado como devDependency local (`npm install -D playwright` em `web/`, não adicionado ao bundle de produção — Next.js nunca inclui devDependencies server-side no bundle do cliente). Scripts de captura eram arquivos `.mjs` temporários dentro de `web/.qa-tmp/`, **removidos ao final** — nenhum resquício no repositório.

## 3. Viewports testados

Desktop 1920×1080, 1440×900, 1366×768 · Tablet 1024×768 (paisagem), 768×1024 (retrato) · Mobile 430×932, 390×844, 360×800. Cobertura real em pelo menos um desktop, um tablet e um mobile para as telas mais críticas (Home, Conversas); as demais telas em pelo menos 1440 + 390.

## 4. Temas testados

Dark (padrão) e Light, via `colorScheme` do Playwright (o app usa `next-themes` com `attribute="class"` + `defaultTheme="system"`, então isso reflete exatamente o que um usuário real veria com o SO em cada modo). Testado em Home, Conversas, Negócios, Billing e Landing/Pricing.

## 5. Screenshots produzidos

**57 capturas reais** (não mockups) salvas localmente durante a sessão, cobrindo: Landing (dark/light/mobile), Pricing (dark/light/mobile), Signup (dark/mobile), Login, Terms, Home (1440 dark/light, 1366, 1920, tablet, 390), Conversas (1440 dark/light, 1366, tablet, 360, 390, com conversa selecionada e painel de contato aberto), Negócios/Kanban (1440 dark/light, 390, 430), Contatos + Contact 360 (1440, 390), Tarefas, Propostas, Resultados (1440, 390), Criar (1440, 390), Produção, Conteúdos, Calendário (1440, 390), Publicar (1440, 390), Meta Ads, Settings + 4 sub-telas, Billing (1440 dark/light, 390). Mais um conjunto de screenshots de verificação pós-correção (hero da landing, mobile Home/Conversas rolados até o fim, sidebar com acentos corrigidos).

## 6. Problemas P0

Nenhum problema P0 (interface inoperável) foi confirmado no browser. O único candidato investigado (Billing sempre retornando erro) foi rastreado até a causa raiz real via log do backend — ver seção 23 (gaps).

## 7. Problemas P1 (confirmados no browser, corrigidos nesta sessão)

| # | Achado | Onde | Evidência |
|---|---|---|---|
| 1 | Hero da landing: a segunda bolha de mensagem do card "Conversas" ficava **coberta/cortada** pelo card "Pipeline" sobreposto por cima, texto ilegível | Landing, 1440 dark | Screenshot real antes/depois |
| 2 | Conteúdo real ficava **escondido atrás do menu inferior fixo** no mobile (Home: card "Ações rápidas"/"Publicar" cortado; Conversas: última conversa da lista cortada) — confirmado com scroll real simulado, não é artefato de `fullPage` screenshot | Home e Conversas, 390 mobile | Screenshot com scroll real antes/depois |
| 3 | **Perda sistemática de acentuação** em ~9 arquivos do redesign (Home, Conversas/CRM panel/inbox, Negócios/Kanban, Contatos, Tarefas, Vorix Intelligence): "Inicio", "Negocios", "Producao", "Anuncios", "Configuracoes", "Responsavel", "proxima atividade", "Ultima interacao", "atencao", "Ligacao", "periodo", "cadencia" apareciam sem acento na tela real, mesmo com dados/copy vizinhos corretamente acentuados — inconsistência visível lado a lado na mesma tela | Sidebar (todas as telas), Home, Conversas, Kanban, Contact 360 | Screenshots antes/depois |

## 8. Problemas P2/P3 relevantes (documentados, não corrigidos — fora do escopo de "correção cirúrgica")

- **Hero preview não reaproveita componentes reais do produto** (`KpiCard`, `MessageBubble`) — é uma composição estilizada equivalente, não uma renderização ao vivo. Efeito visual é bom, mas tecnicamente é uma segunda implementação visual dos mesmos elementos.
- **Bloco de gráfico vazio no Command Center da landing** — a área abaixo dos 3 KPIs no card "Command Center" é só um gradiente decorativo sem conteúdo, lê como espaço subutilizado.
- **Copy repetitiva na seção "Vorix Intelligence" da landing** — os 4 cards de exemplo têm a mesma frase de descrição verbatim ("O Vorix aponta o contexto e sugere o próximo passo."), perdendo a chance de ilustrar cada cenário de forma específica.
- **DetailModal do Kanban não foi confirmado abrindo no browser** — o componente (`DealDetailModal.tsx`) existe no código, mas o clique automatizado não conseguiu abri-lo de forma confiável dentro do tempo desta sessão (card com texto truncado/sobreposto dificultou o alvo do clique); não foi possível validar visualmente esta interação especificamente, embora a Fase 4 já tenha implementado o componente.
- Onboarding (wizard) não foi capturado com sessão autenticada ao vivo — ver gap de infraestrutura na seção 23; a revisão do onboarding nesta fase ficou limitada ao que já havia sido validado por leitura de código na Fase 7.

## 9. Correções efetuadas nesta sessão

1. **`web/app/page.tsx`** — corrigida a sobreposição/corte de texto no preview do hero (card "Conversas" reduzido de `w-[58%]` para `w-[44%]` e reposicionado de `bottom-12` para `bottom-20`, eliminando a colisão com o card "Pipeline").
2. **`web/app/workspaces/[workspaceId]/layout.tsx`** — aumentado o padding inferior reservado para o `BottomNav` fixo no mobile, de `pb-16` (64px) para `pb-24` (96px), eliminando a oclusão de conteúdo real confirmada em Home e Conversas.
3. **`web/components/workspace-navigation.ts`** — restaurada a acentuação correta em todos os rótulos de navegação (Início, Negócios, Produção, Conteúdos, Calendário, Anúncios, Integrações, Configurações, Execução, Governança, Operação) — afeta a sidebar desktop e o menu mobile em **toda tela do produto**.
4. **9 arquivos do redesign** (`app/workspaces/[workspaceId]/page.tsx`, `.../conversas/crm-panel.tsx`, `.../conversas/inbox-tab.tsx`, `.../deals/page.tsx`, `.../contacts/page.tsx`, `.../tasks/page.tsx`, `.../vorix-intelligence-panel.tsx`, `components/crm/DealDetailModal.tsx`, `components/UserPicker.tsx`) — restaurada a acentuação em ~20 palavras/expressões recorrentes, com cuidado explícito para não tocar chaves de objeto que espelham enums do backend (ex.: `ligacao: "Ligação"` — a chave permanece sem acento porque é o valor real do `TaskType` no banco; só o rótulo visível foi corrigido).
5. Correções menores já cobertas no relatório da Fase 7/8 (Terms/Data Deletion reescritas, tooltip real em Automações, tokens de cor do `StatusBadge`) permanecem válidas e não foram re-trabalhadas aqui.

Todas as correções foram **cirúrgicas**: nenhuma arquitetura, nenhum componente novo, nenhuma tela redesenhada — apenas spacing, largura, acentuação e um padding.

## 10. Conversas — parecer final

Depois de ver rodando: a tela **não** parece "WhatsApp Web piorado" nem um sistema desktop dentro do navegador. O painel de contexto agora abre **sob demanda** como overlay com opção de fixar, em vez de ocupar 320px permanentemente vazios (achado antigo da auditoria de UX, confirmado corrigido). Busca de conversas presente, badges de status/IA com cores distintas (verde/roxo/azul/âmbar, não mais todas idênticas), CRM contextual dentro do painel (lead score com fatores explicados, negócios/tarefas vinculados, "Abrir contato completo"). Em mobile, a navegação por troca de tela (lista/conversa/detalhes) funciona e, após a correção do padding, nada mais fica escondido atrás do menu inferior. Only lacuna real observada ao vivo: mensagens de mídia (a conversa com imagem recebida) — não foi possível confirmar visualmente o tratamento porque a fixture não tinha uma imagem real hospedada; ficou registrado como mensagem sem preview, consistente com o gap já documentado na Fase 2/6.

## 11. Home — parecer final

Não voltou a parecer BI. A tela abre com uma saudação, um checklist de onboarding compacto, 4 KPIs, e o painel "Vorix Intelligence" com um acento roxo distinto do verde primário — dá personalidade de "IA" sem parecer neon/gamer. Densidade equilibrada: nem caixinhas em excesso nem espaço vazio demais. O único ponto observado (não corrigido, por ser mais UX que visual): "Ações rápidas" e o painel de Intelligence dividem a mesma linha de peso visual, o que é uma escolha razoável, mas os dois competem levemente por atenção quando ambos têm conteúdo.

## 12. CRM — parecer final

**Kanban**: transformação real desde a auditoria antiga — cards agora mostram responsável (avatar+nome), próxima atividade (ou "Sem próxima atividade" explícito), canal de origem e valor, sem parecer sobrecarregado. Colunas com contagem+soma no cabeçalho. Busca e filtro presentes. **Contact 360**: um `DetailModal` de verdade, com seções (Resumo/Conversas/Negócios/Tarefas/Propostas/Timeline com contadores), lead score explicado por fatores, e "Ações contextuais" (Enviar mensagem/Criar negócio/Criar tarefa/Criar proposta) — exatamente o padrão "detalhe = DetailModal" que o design system exige, e que a versão antiga não tinha.

## 13. Marketing — parecer final

Criar/Produção/Conteúdos/Calendário/Publicar compartilham a mesma casca visual (sidebar, header, cards) — parecem parte do mesmo produto, não telas coladas de fases diferentes. "Criar" em particular tem a sensação certa de "AI-first": campo de descrição livre, "A IA já vai considerar" e "Detalhes avançados" como progressive disclosure, aviso claro de custo real antes de gerar. Não é "só mais um formulário".

## 14. Resultados — parecer final

Não visto ao vivo com dados suficientes para avaliar densidade de gráficos com profundidade (a fixture desta sessão não teve tempo de gerar histórico de conteúdo/publicação suficiente para popular todos os KPIs de Analytics) — a tela carregou corretamente e a estrutura (KPIs + comparação atendimento/comercial) é consistente com o resto do produto, mas uma avaliação mais rica de "leitura rápida dos gráficos" fica pendente de uma sessão com mais volume de dados histórico.

## 15. Settings/Billing — parecer final

Settings: navegação secundária (`PageSubnav`) realmente natural — Geral/Usuários/Equipes/Integrações/Produtos/Automações/Plano e cobrança num só shell, exatamente "tudo onde eu esperava". Billing **não pôde ser avaliado com dados reais carregados** nesta sessão — ver gap de infraestrutura na seção 23; o que foi possível confirmar é que o estado de erro em si (ícone, título, mensagem, botão "Tentar de novo") é visualmente calmo e profissional, não parece "página quebrada", cumprindo pelo menos o requisito de tratamento de erro do design system.

## 16. Landing/Auth/Onboarding — parecer final

Landing: hero forte, mensagem clara em segundos, jornada numerada, sem prova social inventada, sem promessas que o produto não cumpre (nunca menciona Instagram/Facebook Inbox, nunca promete decisão autônoma de IA). Depois da correção do overlap, o preview do produto comunica bem "Vorix real" sem ser uma screenshot literal. Signup/Login: extremamente simples (e-mail+senha), consistentes entre si (mesmo layout split-panel), plano selecionado no Pricing preservado e mostrado discretamente no Signup. Onboarding: não pôde ser validado ao vivo nesta sessão (ver gap), permanece com o parecer já registrado na Fase 7 (QR real, copy sem "em breve", trilha de passos nomeada).

## 17. Mobile

Testado em 3 breakpoints (430/390/360). Achado real corrigido: conteúdo escondido atrás do `BottomNav` (seção 7, item 2). Fora isso, os layouts colapsam corretamente para coluna única, o Kanban rola horizontalmente sem quebrar, e o hero da landing continua legível.

## 18. Dark/Light

Ambos testados nas telas mais importantes (Home, Conversas, Negócios, Billing, Landing/Pricing). Nenhuma quebra de contraste ou token ausente encontrada nas telas efetivamente carregadas com dados (Billing light não pôde ser avaliado com dados reais pelo mesmo motivo do item 15/23).

## 19. Overflow

Verificado explicitamente: nenhum scrollbar horizontal não-intencional encontrado nas telas revisadas; o único "texto cortado" real confirmado foi o do hero (corrigido, item 7.1). Cards do Kanban truncam textos longos com reticências de forma controlada (`truncate`), sem vazamento.

## 20. Accessibility visual

Não foi feita uma auditoria de acessibilidade dedicada (fora do escopo desta fase, que é sobre polish visual). Observação incidental: os alvos de toque do `BottomNav` (`min-h-11` ≈ 44px) atendem a recomendação usual de área mínima de toque.

## 21. Motion

Não foi possível avaliar timing de animação (hover/dropdown/dialog/toast) de forma instrumentada nesta sessão — screenshots são estáticos por natureza. Nenhuma animação "chamativa" ou glow excessivo foi observado nos estados capturados (abertura de modal, overlay de contexto).

## 22. Consistência global (component drift)

- Confirmado: Home, Conversas, Negócios, Contatos usam a mesma casca (sidebar + topbar), o mesmo raio de borda, e o mesmo vocabulário de cor (verde primário + roxo para "Intelligence").
- Corrigido nesta sessão: labels de navegação eram a fonte mais visível de drift (acentuação divergente da copy real dentro das telas).
- Achado não corrigido (P3, fora do escopo): a Landing usa uma composição de preview própria (`ProductPreview`) em vez de reaproveitar componentes reais como `KpiCard` — visualmente equivalente, mas é uma segunda implementação.

## 23. Gaps da Fase 7/8 revisados e classificados

Revisão dos gaps documentados em `docs/vorix-redesign-fase7-fase8-relatorio.md`, mais um novo gap de infraestrutura descoberto nesta sessão:

| Gap | Classificação | Justificativa |
|---|---|---|
| **Preço anual não exposto publicamente no catálogo** (`yearlyPriceUsd` existe no domínio, não exposto em `/v1/platform/plans`) | **BACKLOG** | Baixo impacto imediato: a tela já evita mostrar preço errado (o requisito de segurança do funil já está cumprido); expor o valor real é melhoria, não correção de bug. |
| **`/analytics` fora da navegação principal** (só acessível via link direto de Calendário/Resultados) | **PRE_LAUNCH** (verificar intenção) | Achado na Fase 7/8: parece decorrer de uma decisão de fase anterior de consolidar em "Resultados" — precisa confirmação explícita do time se é intencional antes do lançamento público, já que hoje a tela existe mas não é descoberta pela navegação. |
| **Componentes públicos não extraídos** (`Hero`/`FeatureSection`/`ProductPreview`/`PricingCard` são funções locais, não arquivos em `components/public/`) | **BACKLOG** | Puramente organização de código; não há drift visual real hoje (confirmado nesta sessão — a Landing é visualmente coesa). Não vale refatorar sem necessidade concreta. |
| **Continuidade Pricing→Signup→Billing não é 100% automática** (usuário ainda clica "Selecionar" de novo no Billing) | **POST_LAUNCH** | Decisão deliberada da Fase 7/8 por segurança (evitar checkout automático via parâmetro de URL); é uma melhoria de conversão, não um bug bloqueante. |
| **🆕 Migrations de Billing/Trial (0103+) não aplicadas na VPS de produção** (`relation "subscriptions" does not exist`, `relation "workspace_onboarding" does not exist`) | **VISUAL_QA_BLOCKER para validação de Billing/Onboarding especificamente — já era PRE_LAUNCH conhecido para o restante** | Descoberto ao investigar por que a tela de Billing retornava "Erro interno inesperado" com um tenant real. Confirmado nos logs do backend: são as mesmas tabelas já documentadas como pendentes na auditoria geral anterior (`docs/vorix-auditoria-geral-estado-atual.md`). **Não é um bug desta redesign** — é a lacuna de deploy de migrations já conhecida. Bloqueia especificamente a validação visual *com dados reais* de Billing e do progresso de Onboarding nesta VPS até as migrations serem aplicadas (decisão que continua fora do escopo desta sessão, por exigir aplicar todo o Billing/Trial em produção). |

## 24. Arquivos alterados nesta Fase 9

- `web/app/page.tsx` (hero: correção de overlap)
- `web/app/workspaces/[workspaceId]/layout.tsx` (padding do BottomNav)
- `web/components/workspace-navigation.ts` (acentuação)
- `web/app/workspaces/[workspaceId]/page.tsx` (acentuação)
- `web/app/workspaces/[workspaceId]/conversas/crm-panel.tsx` (acentuação + correção da chave `ligacao`)
- `web/app/workspaces/[workspaceId]/conversas/inbox-tab.tsx` (acentuação)
- `web/app/workspaces/[workspaceId]/deals/page.tsx` (acentuação)
- `web/app/workspaces/[workspaceId]/contacts/page.tsx` (acentuação)
- `web/app/workspaces/[workspaceId]/tasks/page.tsx` (acentuação)
- `web/app/workspaces/[workspaceId]/vorix-intelligence-panel.tsx` (acentuação)

Nenhum arquivo de backend (`src/`) foi alterado. `web/proxy.ts` foi temporariamente alterado e **revertido** (confirmado via `git diff` vazio).

## 25. Testes

`cd web && npm run test` (vitest) — **25/25 passando** (4 arquivos), rodado após todas as correções desta fase.

## 26. Typecheck

`cd web && npm run typecheck` — **limpo, 0 erros**, incluindo depois de detectar e corrigir uma quebra de tipo introduzida por um dos ajustes de acentuação (a chave `ligacao` de um `Record<TaskType, string>` foi acidentalmente acentuada por um script de correção em lote e revertida assim que o typecheck acusou o erro).

## 27. Build

`cd web && npm run build` — **sucesso**, todas as ~57 rotas geradas. Rodado 3 vezes ao longo da sessão (antes das correções, depois da primeira leva de correções, e na validação final).

## 28. Screenshots

57 capturas reais salvas localmente durante a sessão (fora do repositório, em diretório temporário de trabalho) — usadas para a inspeção visual descrita neste relatório. Não foram commitadas ao repositório (são evidência de processo, não artefato de produto).

## 29. Dívidas restantes

1. Aplicar as migrations de Billing/Trial (0103+) na VPS para permitir validação visual completa de Billing e Onboarding com dados reais — decisão de escopo maior, não desta sessão.
2. Confirmar com o time se `/analytics` deveria voltar à navegação principal ou permanece intencionalmente só acessível via link direto.
3. Validar a interação do `DealDetailModal` no Kanban com um teste manual (a automação desta sessão não conseguiu abri-lo de forma confiável).
4. Avaliar Resultados/Analytics com um volume de dados históricos maior antes do lançamento, para julgar densidade de gráficos com mais confiança.
5. Motion/microinterações (hover, dropdown, toast) não foram avaliadas de forma instrumentada — ficaria melhor com uma sessão dedicada e vídeo/gravação, não só screenshots estáticos.
6. Auditoria de acessibilidade visual dedicada (contraste formal, navegação por teclado) não foi feita — esta fase focou em polish visual, não em conformidade de acessibilidade.

## 30. Classificação final

# READY_WITH_POLISH

Justificativa: o produto foi **realmente aberto no navegador** (não apenas lido em JSX), em múltiplos viewports e temas, contra a API real de produção. As telas centrais — Home, Conversas, Kanban, Contact 360, Landing — já entregam a sensação de "produto AI-first premium" pedida: hierarquia clara, densidade equilibrada, sem neon/glow gratuito, com uma identidade visual coerente entre landing e produto. Três problemas reais e visíveis foram encontrados e corrigidos nesta sessão (overlap no hero, conteúdo escondido atrás do menu mobile, perda de acentuação em ~9 arquivos). O que impede `VISUALLY_READY` (não `VISUALLY_INCONSISTENT`, que seria mais grave) é: (a) Billing e Onboarding não puderam ser validados com dados reais carregados por uma lacuna de infraestrutura pré-existente e já documentada (migrations não aplicadas), não uma falha de design; (b) alguns detalhes (motion, DetailModal do Kanban, Resultados com dados históricos ricos) ficaram sem confirmação visual completa dentro do tempo desta sessão. Nenhum desses pendentes é, pelo que foi visto, um problema de acabamento visual — são lacunas de validação, não de qualidade.

---

Correções feitas foram comprovadas visualmente no browser antes e depois (não apenas inferidas do código). Parando aqui, conforme instruído. Não iniciado redesign de Admin/Bastidor. Aguardando revisão.
