# Ambiente autenticado de QA do Vorix

> Provisionado em 20 de setembro de 2026 para remover o bloqueio de acesso do QA operacional da
> jornada comercial. Esta configuração não cria bypass de autenticação, não altera funcionalidades
> comerciais e não habilita a ponte automática Inbox → CRM.

## Identidade e workspace

- Usuário dedicado: **Vorix QA Comercial** (`qa-commercial@vorixworks.internal`).
- Tenant reutilizado: `tenant-homolog-whatsapp`.
- Workspace reutilizado: **Homologacao WhatsApp Real** (`ws-homolog-whatsapp`).
- Papel: `editor`.
- Administrador global: não.

O workspace já existia para homologação e estava isolado: no momento do provisionamento continha
zero Contacts, Deals, Tasks, Proposals e InboxConversations. Duas configurações de conexão de
mensageria já existiam, mas isso não comprova que há um número físico autorizado disponível.
Qualquer teste de envio pelo WhatsApp continua condicionado a um número controlado explicitamente
pela equipe.

## Provisionamento

O fluxo foi auditado antes da criação:

- cadastro público usa `signupPublicTransactional` e cria usuário, tenant, workspace, billing,
  pipeline inicial e sessão em uma transação;
- login real ocorre em `POST /v1/auth/login` pela página `/login`;
- access token permanece somente em memória;
- refresh token fica em cookie HttpOnly e seu hash é persistido;
- refresh tokens são rotacionados a cada uso e replay revoga a sessão;
- `editor` possui leitura e operação de Conversas e CRM, incluindo Contatos, Negócios, Tarefas e
  Propostas, sem permissões administrativas de conexões, equipes ou automações.

Como o workspace seguro já existia, o usuário foi criado com o caso de uso `registerUser` existente
e associado ao tenant com papel `editor`. O procedimento foi repetido e retornou `EXISTING`, sem
criar usuário, membership ou workspace duplicado. Nenhum endpoint, header, JWT manual ou bypass de
autenticação foi criado.

## Credencial e sessão

A credencial fica apenas em `.qa/credentials.json`, ignorado pelo Git. A senha é aleatória e
armazenada cifrada com DPAPI para o usuário Windows que executou o provisionamento. O diretório tem
ACL restrita ao usuário local e ao `SYSTEM`.

O estado autenticado do navegador fica em `.qa/storage-state.json`, também ignorado e com a mesma
restrição de acesso. Ele contém credenciais de sessão e nunca deve ser copiado para documentação,
logs, artefatos ou controle de versão.

Como o refresh token é rotativo, automações devem:

1. usar o `storageState` de forma sequencial, nunca em contextos paralelos;
2. regravar o estado no mesmo arquivo depois que o refresh concluir;
3. fazer login real novamente quando a sessão for revogada ou expirar.

Para renovar a senha, gerar outra senha aleatória, atualizar o hash com o `BcryptPasswordHasher`
existente, revogar as sessões do usuário e substituir o arquivo DPAPI local. Para remover o ambiente,
revogar as sessões e remover a membership/usuário de QA; o workspace de homologação só deve ser
removido depois de confirmar que não é mais usado pelos testes de WhatsApp.

## Evidência de navegador

Chrome real instalado em `C:\Program Files\Google\Chrome\Application\chrome.exe` e Playwright
disponível no projeto.

O login foi executado pela UI de produção:

1. `/login` com a conta dedicada;
2. redirecionamento para `/workspaces`;
3. workspace **Homologacao WhatsApp Real** visível;
4. entrada em `/workspaces/ws-homolog-whatsapp`;
5. novo contexto em viewport 390 × 844 usando o `storageState`;
6. refresh real e abertura do mesmo workspace sem retornar ao login;
7. estado rotacionado persistido novamente.

## Isolamento

Com a sessão real do usuário QA:

- workspace de outro tenant: HTTP 404;
- listagem de Contacts com workspace de outro tenant: zero itens;
- listagem de Deals com workspace de outro tenant: zero itens;
- listagem de Proposals com workspace de outro tenant: zero itens;
- conversa pertencente a outro tenant: HTTP 404.

Nenhum registro de outro tenant foi alterado.

## Classificação

| Critério | Resultado |
|---|---|
| `QA_USER` | `CREATED` |
| `QA_WORKSPACE` | `EXISTING` |
| `QA_CREDENTIAL_STORAGE` | `SAFE` |
| `AUTH_BYPASS_CREATED` | `NO` |
| `BROWSER_QA_CAPABILITY` | `AVAILABLE` |
| `QA_LOGIN` | `VERIFIED_RUNTIME` |
| `QA_SESSION_STATE` | `READY` |
| `QA_TENANT_ISOLATION` | `VERIFIED` |
| `AUTHENTICATED_QA_BLOCKER` | `RESOLVED` |

`PROPOSAL_SEND_WHATSAPP = PENDING_EXTERNAL_TEST_NUMBER` até a equipe confirmar um número físico
controlado para o teste. Isso não bloqueia a autenticação nem o restante do QA comercial.
