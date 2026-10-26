# Vorix Marketing — Social Publishing multiprovider

Motor de publicação social independente de provider. Composer, calendário, agendamento, fila,
histórico e auditoria não conhecem Meta, TikTok ou qualquer outro transporte.

Estado desta versão:

- O motor genérico está implementado e testado.
- Os providers oficiais Meta (Instagram e Facebook) e TikTok estão com a arquitetura pronta, mas:
  - não foram validados com publicação real;
  - estão desligados por padrão.
- Nenhuma integração não oficial faz parte do produto.

## Camadas

| Camada | Onde | Papel |
|---|---|---|
| Domínio | `src/domain/social/social-publishing.model.ts` | Conta, conexões, política, capabilities, estados, classes de erro |
| Contrato do provider | `src/application/social/social-publishing-provider.port.ts` | `SocialPublishingProvider` + `SocialProviderConnectionPort` |
| Resolução | `src/application/social/social-provider-resolver.ts` | Único ponto que decide o provider para tenant + rede + conta |
| Contas | `social-account-service.ts` | Conexão (sync), health check, reauth, retomada e política de atraso |
| Posts | `social-post-service.ts` | Composer único, validação, agendamento, retry por destino, calendário |
| Roteador | `social-publication-router.ts` | Provider `social` dentro do motor de Publication já existente |
| Administração | `social-provider-admin-service.ts` | Política por tenant, kill switch, homologação, migração de provider, métricas |
| Providers oficiais | `src/infrastructure/social/official-social-providers.ts` | Meta/TikTok sobre os adapters e o OAuth oficiais já existentes |
| Persistência | `db/migrations/0176_social_publishing_multiprovider.sql` | Contas, conexões, políticas, chaves, destinos, log e deduplicação |

A publicação reaproveita o domínio Publication. Não existe um segundo scheduler. O fluxo é:

1. Um post do composer vira um `PublicationPlan`.
2. Cada rede ou conta vira um `PublicationTarget` (destino) com o provider `social`.
3. O agendamento usa `publication_schedules` e o scheduler da API.
4. A fila é o `publication_outbox`: claim atômico com `SKIP LOCKED`, lease e fencing token.
5. Tentativas, recibos e reconciliação também vêm do motor existente.

## Conta social × provider

- A `social_account` é a identidade lógica do perfil, definida por rede + id externo.
- Cada `social_account_connections` liga a conta a **um** provider, guardando só a referência da credencial. O token fica no cofre central cifrado.
- Uma conta pode ter conexões com vários providers. Trocar de provider nunca cria outra conta, e conteúdo, agendamentos, histórico e mapeamento externo são preservados.
- `social_accounts.provider_type` só registra o último provider usado. Toda mudança passa por `recordProviderInUse` e gera `PROVIDER_CHANGED` na auditoria.
- O conjunto de providers é aberto. Um provider novo se registra com as redes que atende (`descriptor.networks`), sem mudar o resto do sistema.

## Disponibilidade (nunca um único booleano)

Um provider só atende um tenant quando **todas** as camadas abaixo estão ativas:

1. **implementado**: está registrado e atende a rede;
2. **configurado**: o app OAuth tem credenciais neste ambiente;
3. **ligado globalmente**: o kill switch está ligado (`META_OFFICIAL_GLOBAL_ENABLED`/`TIKTOK_OFFICIAL_GLOBAL_ENABLED` ou `social_provider_switches`);
4. **homologado**: `approved` foi marcado pela plataforma depois da aprovação externa;
5. **liberado ao tenant**: `publishing_enabled` está ativo e o provider está em `enabled_providers` na política da rede;
6. **conta conectada**: existe uma conexão ativa da conta com aquele provider;
7. **capability**: o formato e o recurso estão disponíveis para o provider e para a conta.

O padrão para todo tenant é publicação social **desligada**.

`realPublishingValidated` é separado de "implementado". Ele só vira `true` com evidência de publicação real.

## Ativação oficial (passo a passo)

1. Concluir a aprovação dos apps na Meta e no TikTok e configurar as credenciais OAuth existentes (`META_*`, `TIKTOK_*`).
2. Ligar o kill switch e marcar a homologação: `PUT /v1/admin/social-providers/:providerType { enabled: true, approved: true }`.
3. Liberar o tenant e a rede: `PUT /v1/admin/social-providers/tenants/:tenantId/:network { publishingEnabled: true, enabledProviders: [...], preferredProvider }`.
4. O cliente usa Marketing → Integrações → Conectar. O Vorix devolve a URL de autorização da rede, e no retorno `POST /v1/social/accounts/sync` importa as contas autorizadas.
5. Validar uma publicação real por provider antes de mudar `realPublishingValidated`.

## Estados

**Destino:** `DRAFT`, `AWAITING_APPROVAL`, `SCHEDULED`, `PUBLISHING`, `PUBLISHED`, `FAILED`, `RECONCILIATION_REQUIRED`, `WAITING_REAUTH`, `AWAITING_CONFIRMATION`, `PAUSED`, `CANCELLED`, `SKIPPED`.

**Post:** agrega os estados dos destinos, incluindo `PARTIAL_SUCCESS`. Uma falha numa rede não desfaz a outra, e o retry é sempre por destino.

## Fila, limites e erros

- A fila é sequencial por conta, com uma trava `social-account:<id>`.
- Limites conservadores e configuráveis: intervalo mínimo, máximo por hora e por dia, e falhas consecutivas.
- Um bloqueio (conta ocupada, limite, reconexão ou provider pausado) gera o resultado `deferred`: a mensagem volta para a fila sem consumir tentativa e sem perder o horário.
- Erros de autenticação ou segurança: a fila da conta para, ela vai para `REAUTH_REQUIRED` e a notificação sai agrupada. Nunca há fallback para outro provider.
- Erros transitórios: retry controlado, com limite de tentativas.

## Resultado desconhecido

Quando há timeout depois do envio, o destino fica em `RECONCILIATION_REQUIRED` e **nunca é republicado às cegas**:

- A verificação usa o **mesmo provider** da tentativa e a referência que ele devolveu (codificada no `providerRequestId` da reconciliação).
- Quando a API oficial não oferece identificador consultável (Meta em timeout sem id de mídia), o resultado fica inconclusivo. O cliente confere na rede e confirma em `POST /v1/social/destinations/:id/resolve-unknown`:
  - "publicado" registra o recibo;
  - "não publicado" libera o retry.

## Reconexão e atraso

Conexão revogada ou expirada (vista na sincronização, no health check ou na própria publicação):

1. A conta vai para `REAUTH_REQUIRED`.
2. Os agendamentos são preservados com o horário original.
3. Um alerta agrupado informa quantas publicações estão esperando.

Depois da reconexão, a política de atraso de cada tenant e rede decide o que fazer:

| Situação | O que acontece |
|---|---|
| Dentro da tolerância | Publica |
| Além dela, com `ASK_CONFIRMATION` | Pede confirmação |
| Além dela, com `PUBLISH_ON_RECONNECT` | Publica |
| Além dela, com `SKIP` | Pula |

A saída é escalonada pela fila por conta.

## Música

O domínio representa `NATIVE_PLATFORM_MUSIC` e `EMBEDDED_AUDIO`. As APIs oficiais usadas hoje não oferecem música nativa, então:

- os providers oficiais não declaram `nativeMusic`;
- a UX não promete o recurso;
- a validação recusa música nesse caso.

O áudio embutido no vídeo continua funcionando.

## Segurança

- Tokens ficam só no cofre central (credenciais OAuth governadas). A conta guarda apenas a referência, e a credencial é resolvida sempre no escopo do tenant e workspace da própria conta.
- A auditoria descarta qualquer chave sensível (token, senha, cookie, sessão, authorization).
- O backend valida RBAC (`marketing:social_*`) e o isolamento por tenant. As rotas `/v1/social/*` pertencem à solução Marketing. Política, kill switch e homologação ficam em `/v1/admin/social-providers` (platform admin).

## Manutenção

`registerSocialMaintenanceScheduler` roda dentro da API e faz:

- o health check leve das contas;
- a reconciliação dos resultados desconhecidos (`SOCIAL_MAINTENANCE_INTERVAL_MS`, `SOCIAL_HEALTH_CHECK_MAX_AGE_MS`).

Ele não publica: quem publica é o scheduler de Publication.

## Testes

- `tests/social-publishing.test.mjs`: infraestrutura genérica com provider roteirizado.
- `tests/social-providers-contract.test.mjs`: contrato dos providers oficiais, usando fixtures dos adapters e do OAuth.

Nenhum dos dois faz chamada externa. Rodar com `npm run test:social`.
