# Perfis, permissões e escopo

Migration `0173_access_profiles_and_scope.sql`. Domínio em `src/domain/identity/identity.model.ts` (presets) e
`src/domain/identity/access-control.ts` (catálogo e proteções). Aplicação em
`src/application/identity/access-control-use-cases.ts` e `access-resolver.ts`.

## Modelo: perfil + exceções + equipes

| Dimensão | Onde vive | Observação |
| --- | --- | --- |
| Perfil base (preset) | `tenant_members.role` | `owner` = Administrador, `admin` = Gerente, `editor` = Atendente, `viewer` = Visualizador (legado). Mesmo enum de sempre: nada de tabela nova de perfis. |
| Exceções individuais | `tenant_members.permission_grants` / `permission_revokes` | Efetiva = preset + concedidas − removidas (removida vence). |
| Equipes | `team_memberships` | Participar define o que é "dados da equipe"; papel `owner`/`admin` **na equipe** = gerente daquela equipe. |
| Status | `tenant_members.status` | `disabled` perde acesso na próxima requisição (e no login/refresh). |
| Administrador principal | `tenant_members.is_account_owner` | Um por empresa (o owner mais antigo na migração). |

Permissões efetivas são resolvidas **a cada requisição** pelo `AccessResolver`, sem cache por padrão.
Trocar perfil, conceder/remover permissão ou desativar vale sem novo login e sem depender da
invalidação em outra instância. O stream de atendimento também revalida acesso a cada evento.

## Escopo de leitura (três degraus por domínio)

| Domínio | Próprios (padrão) | Equipe | Global |
| --- | --- | --- | --- |
| Atendimentos/conversas | atribuídos a mim + fila (sem responsável) das minhas equipes ou sem equipe | `inbox:view_team` | `inbox:view_all` |
| Oportunidades | minhas | `deal:view_team` | `deal:view_all` |
| Metas | a minha | `goal:read_team` | `goal:read_all` (inclui a da empresa) |
| Dashboards/relatórios | os meus | `sales_report:read_team` | `sales_report:read_all` |

"Equipe" = equipes gerenciadas para o perfil Gerente; para os demais perfis com permissão de
leitura por equipe, equipes das quais participa. Um registro explicitamente da equipe B não fica
visível ao gerente de A só porque seu responsável participa de ambas. Configurar (kanban de atendimento,
funis de oportunidade, SLA de equipe, metas de equipe) exige a permissão do domínio **e** gerenciar a equipe — ou
escopo global. Funil sem equipe (da empresa toda) só com escopo global.

O backend aplica em: listagem e **todas** as rotas `/inbox/conversations/:id/*` (hook no Fastify, fora do escopo = 404),
token de mídia, oportunidades (`resolveDealScope`), métricas comerciais, metas, performance, relatórios, kanbans e a
Dashboard. A preferência comercial antiga "visibilidade de oportunidades" é preservada para
compatibilidade, mas não concede acesso. A autoridade é perfil + permissões individuais + equipes.

## Proteções

- Ninguém altera o próprio perfil, permissões ou equipes (exceto quem já tem escopo global, nas equipes).
- Ninguém concede permissão que não possui; só Administrador cria/edita/desativa Administrador.
- Administrador principal: sempre Administrador, nunca perde gestão de usuários/permissões/equipes, nunca é
  desativado/removido.
- A empresa nunca fica sem Administrador ativo.
- Definir gerente de equipe exige `tenant_member:manage_permissions`.

## Auditoria

`access_audit_log` (estruturado, antes/depois em JSON): perfil alterado, permissão concedida/removida, membro
criado/removido/desativado/reativado, convite, entrada/saída de equipe, virou/deixou de ser gerente. Consulta:
`GET /v1/tenant-members/access-audit`.

## Compatibilidade (migração)

- Administradores (`owner`): sem mudança.
- Gestores (`admin`): o preset de Gerente ficou por equipe e sem gestão de acesso; **tudo o que eles tinham virou
  exceção concedida** (escopo global, gestão de usuários/equipes, canais, finalização, automações, metas). Ninguém
  perde acesso; o Administrador remove depois, se quiser.
- Atendentes (`editor`): passam a ver só os próprios atendimentos + a fila das suas equipes (antes viam todas as
  conversas) e deixam de configurar kanban de atendimento e funis. Para manter a visão ampla de alguém, conceda
  "Ver atendimentos da equipe" ou "Ver todos os atendimentos" na tela do usuário.
- Visualizadores (`viewer`): mantêm leitura global.
