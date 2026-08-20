# Etapa 7 — Configurações, Bastidor e Rotas

## Navegação final

- Início: `/workspaces/[workspaceId]`
- Criar: `/workspaces/[workspaceId]/create`
- Produção: `/workspaces/[workspaceId]/production`
- Conteúdos: `/workspaces/[workspaceId]/campaigns`
- Calendário: `/workspaces/[workspaceId]/calendar`
- Publicar: `/workspaces/[workspaceId]/publish`
- Conexões: `/workspaces/[workspaceId]/connections`
- Marca: `/workspaces/[workspaceId]/knowledge`
- Analytics: `/workspaces/[workspaceId]/analytics`
- Configurações: `/workspaces/[workspaceId]/settings`

## Bastidor

Visível apenas para `owner` e `admin`.

- Planejamento: `/workspaces/[workspaceId]/planning`
- Runtime: `/workspaces/[workspaceId]/runtime`
- Execução: `/workspaces/[workspaceId]/execution`
- Publicação Técnica: `/workspaces/[workspaceId]/publications`
- Detalhe de Publicação Técnica: `/workspaces/[workspaceId]/publications/[publicationId]`
- Provedores: `/workspaces/[workspaceId]/providers`
- Governança: `/workspaces/[workspaceId]/governance`
- Operação: `/workspaces/[workspaceId]/operations`

Além de ficar oculto na navegação para perfis comuns, o acesso direto por URL ao Bastidor mostra um estado restrito para usuários fora de `owner` e `admin`.

## Mobile

- Barra primária: Início, Produção, Criar, Conteúdos, Menu.
- Menu: Publicar, Calendário, Conexões, Marca, Analytics, Configurações.
- Bastidor: seção separada dentro do Menu, somente para `owner` e `admin`.

## Compatibilidade

- `/workspaces/[workspaceId]/chat` e `/chat/[conversationId]`: redirects legados para Produção.
- `/workspaces/[workspaceId]/assets`: redirect legado para Marca > Materiais.
- `/workspaces/[workspaceId]/facebook`, `/instagram`, `/tiktok`: redirects legados para Publicar com filtro de rede.

## Classificação

- Produto principal: Início, Criar, Produção, Conteúdos, Calendário, Publicar, Conexões, Marca, Analytics, Configurações.
- Técnico/Bastidor: Planejamento, Runtime, Execução, Publicação Técnica, Provedores, Governança, Operação.
- Legado/redirect: Chat, Assets, Facebook, Instagram, TikTok.
- Admin plataforma: `/admin/*`, mantido fora do redesign profundo.

## Segurança operacional

- `system/queues` filtra jobs pelo tenant autenticado e pelo `workspaceId`.
- `publications/queue`, `publications/operate/work` e `publications/operate/run-due` são filtrados pelo tenant autenticado e, quando informado, pelo `workspaceId`.
- Workers acionados por publicação imediata drenam apenas jobs/outbox da publicação, tenant e workspace da ação atual.
- Reset de circuit breaker só ocorre quando o circuito pertence ao tenant/workspace autorizado.
- `system/rate-limits` não retorna `tenantId`, `principalId`, `ip` nem chave bruta com esses dados.
