# Reorganização de UX — Fase 14: qualidade e pendências

Registro da revisão final (2026-11-23). Complementa os commits das Fases 1–14 e a correção de segurança `d491d576`.

## Falhas antigas da suíte E2E ampla (eram 41)

| Grupo | Testes | Causa | Situação |
|---|---|---|---|
| `site-personalizar` | 4 | Esperavam o botão "Salvar rascunho", substituído pelo salvamento automático | **Atualizados** (verificam rascunho salvo, nada publicado, cor mantida) — passam |
| `phase3-tasks` | 5 | Botão "Detalhes" renomeado para "Detalhes do contato"; mock de contato sem `customFields` (campo obrigatório do contrato) | **Atualizados** — passam |
| `conversation-product-share` | 1 | Lista de conversas mostra "Nome · telefone"; seletor de texto exato | **Atualizado** — passa |
| `opportunity-attention` (conversas) | 1 | Mesmo motivo acima | **Atualizado** — passa |
| `opportunity-attention` (cartão) | 1 | O cartão mostrava o nome conhecido pela conversa; hoje mostra o contato canônico (`contactDisplayName` do backend) | **Mantido falhando**: possível perda de recurso — decisão de produto |
| `unified-products` (bloqueado) | 3 | Fixture local roda (PGlite, origem 127.0.0.1:3391). 1 passa; 2 esperam Marketing "interno" e a seção "Loja online" (hoje Marketing é público e a seção é "Como vender pelo site") | Desatualizados — dependem de redefinir o que verificar |
| `commercial-rules` (bloqueado) | 4 | Fixture local roda. 2 passam (administração das regras); 2 falham porque a fixture `--commercial-rules` não ativa o carrinho exigido pelas regras de venda atuais | Fixture desatualizada |
| `billing-capacity-self-service` | 6 | Campos e fluxos da tela de cobrança mudaram | Desatualizados (cobrança fora do escopo de alteração) |
| `admin-tenant-contract` | 2 | Controles da tela do cliente no admin mudaram | Desatualizados |
| `commerce-multichannel` | 2 | Lista de pedidos não mostra os pedidos de marketplace do mock | Desatualizados (mock anterior às mudanças de pedidos) |
| `bambilu-fashion`, `product-media` | 12 | Vitrine pública dos modelos (renderizador fora do escopo) | Desatualizados frente aos modelos atuais |
| `public-product`, `site-analytics`, `feedback-proof` | 6 | Exigem servidores de fixture próprios (`public-product-browser-server` 3396, `site-analytics-browser-server` 3890) | Infraestrutura de fixture específica |
| `ds2-proof` | 1 | Prova visual antiga do design system | Desatualizado |

**Resultado da regressão final (desktop-1440, specs sem fixture própria):** 346 passaram, 30 falharam, 1 ignorado. As 30 falhas estão todas na lista original das 41 (nenhuma falha nova); 11 foram corrigidas.

Como rodar as fixtures localmente (sem produção): `node tests/fixtures/product-site-browser-server.mjs [--commercial-rules]` (PGlite, sem Docker) + front compilado com `NEXT_PUBLIC_API_URL=http://127.0.0.1:3390` servido em `127.0.0.1:3391` (origem aceita pelo CORS da fixture). O modo `--capacity` exige Postgres em Docker (WSL indisponível nesta máquina).

## Pendências que dependem de backend

- **Segurança (alta prioridade):** `GET /v1/publications/health` exige só `publication:read` (todo papel) e devolve `orchestrator.locks` sem filtro de tenant (IDs de publicações de outras empresas), tamanho da fila global e saúde do resolvedor de segredos. Recomendação: exigir `requirePlatformAdmin` ou filtrar por tenant. Não alterado (fora da autorização).
- **Senha:** não há redefinição de senha nem autoedição de perfil; a tela orienta o caminho real.
- **Notificações:** não há preferências por tipo de aviso.
- **Reuniões:** a API não filtra por "tem análise" nem por vários status; analytics de Marketing não tem preset de 90 dias (o front envia intervalo).
- **Marketing:** histórico de publicações carregado sem paginação; o calendário usa o fuso do navegador (o fuso configurado do workspace não é aplicado pela API).
- **Backend:** suíte com 30 falhas pré-existentes (inbox, radar, equipes padrão, mídia) — idênticas antes e depois da correção de segurança.

## Percursos de ponta a ponta (specs com API simulada)

| Percurso | Spec |
|---|---|
| Conhecer a Vorix, consultar planos, links e SEO | `public-site-organization` |
| Cadastro simulado e onboarding | `public-site-organization` |
| Entrar no workspace, Início | `home-unified` |
| Alternar ferramentas e trocar de workspace | `navigation-mobile-workspaces` (+ troca em cada spec de fase) |
| Atender conversa simulada | `inbox-organization`, `conversas-layout` |
| Oportunidade, proposta, pedido | `sales-organization`, `phase4-proposals` |
| Criar conteúdo (IA simulada) e agendar publicação | `marketing-create`, `marketing-organization` |
| Editar site (simulado) | `site-editor-organization`, `site-personalizar` |
| Reunião e transcrição simuladas | `meetings-organization` |
| Configurações | `settings-organization` |
| Resultados | `results-organization` |
| Admin global × admin de workspace | `admin-platform` + `tests/system-routes-authorization.test.mjs` (backend) |
| Acessibilidade automatizada | `a11y-quality` |
