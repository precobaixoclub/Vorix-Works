# Vorix Meetings — fechamento dos ajustes de arquitetura

Revisão de 14/10/2026. Implementação local retomada após interrupção da sessão anterior.

## Regras implementadas

| Ajuste solicitado | Comportamento e evidência |
| --- | --- |
| 1. Confiança na identidade | `explicit` e `connected_account_confirmed` excluem contas. `inferred_organizer` e `inferred_calendar_owner` são sugestões; exigem confirmação antes da gravação. Testes de inferência, elegibilidade e API. |
| 2. Precedência humana | Escolha explícita substitui a sugestão, preserva a origem e gera auditoria. Organizador e conta da agenda não sobrescrevem essa escolha. |
| 3. Uma conta, uma gravação | Reserva transacional com advisory lock por tenant, bloqueio de linha e `SKIP LOCKED`. Índices únicos impedem duas reuniões ou execuções ativas com a mesma conta, mesmo se o status da conta for alterado indevidamente. |
| 4. Tenant primeiro | Novas contas pertencem ao tenant e nascem com `workspace_id = null`. Workspace definido restringe uso. Chaves estrangeiras compostas e verificação em runtime impedem associação entre tenants. |
| 5. Pool do tenant | Seleção automática das contas elegíveis, priorizando as menos recentemente utilizadas. Conta compartilhada pode atender outro workspace do mesmo tenant. |
| 6. Estados de sessão | `active`, `busy`, `reauth_required`, `invalid_session`, `disabled`, `error`. Login expirado/challenge exige reconexão; sessão ausente ou indecifrável continua inválida; indisponibilidade transitória vira erro. |
| 7. Reconexão e capacidade | `reauth_required` não é reservável nem conta na capacidade saudável. Login validado e health check bem-sucedido devolvem `active`. |
| 8. Self-service obrigatório | Conectar e Reconectar usam navegador remoto no produto. CLI restrita a homologação/suporte. Gate comercial exige aprovação do self-service real. |
| 9. Browser isolado | Sessão contém tenant, usuário criador, expiração, status e uso único. WebSocket exige autenticação, permissão, acesso a Meetings e token vinculado ao mesmo tenant/usuário. Replay é recusado. |
| 10. Expiração | TTL de dez minutos. Expiração, cancelamento, fechamento/abandono do viewer e encerramento do worker fecham browser e descartam estado incompleto. Factory limpa recursos também em falhas de abertura. |
| 11. Reconexão atômica | Durante reconexão, conta sai da seleção. Novo estado cifrado só substitui o anterior depois de validar identidade e saúde. Gravação do estado, conclusão e auditoria são transacionais. Falha/cancelamento preserva o anterior. Desativação cancela login em curso. |
| 12. Capacidade contextual | API/frontend usam `planCapacity`, `tenantHealthyCapacity`, `tenantAvailableCapacity`, `meetingEligibleCapacity`. Teste do exemplo solicitado resulta em 3, 3, 3, 2. |
| 13. Capacidade e contas | Tela informa contas saudáveis e limites de plano/disponibilidade. Cadastro isoladamente não promete gravações simultâneas. |
| 14. Auditoria | Eventos canônicos de conexão, reconexão, desativação, remoção, falha de saúde, necessidade de reconexão, reserva, liberação e conflito. Registros contêm tenant, workspace quando aplicável, usuário, id da conta, reunião quando aplicável e timestamp, sem sessão/cookies/senha/MFA. |
| 15. Liberação comercial | `meetingsCommercialBlockers` verifica as seis condições obrigatórias. Trocar apenas a disponibilidade para `public` não permite contratação. |

## Semântica de capacidade

- `planCapacity`: limite de gravações simultâneas do plano.
- `tenantHealthyCapacity`: menor valor entre plano e contas saudáveis, incluindo ocupadas.
- `tenantAvailableCapacity`: menor valor entre plano e contas saudáveis livres.
- `meetingEligibleCapacity`: contas saudáveis livres autorizadas no workspace e sem conflito com identidade humana confirmada, limitado pelo plano.
- `availableNow`: vagas que podem começar imediatamente, descontando também as gravações já ativas do limite do plano.

Campos anteriores (`planLimit`, `tenantEffectiveRecordingCapacity`, `meetingEligibleRecorderCapacity`) permanecem como aliases para compatibilidade. Contas ocupadas não entram na elegibilidade livre por reunião.

## Implantação e homologação

Aplicar as migrations `0147` e `0148` pelo fluxo existente `npm run db:migrate`. A migration `0148` converte origens antigas de organizer/calendar owner em inferências e remove suas exclusões definitivas. Confirmações explícitas são preservadas. Os índices recusam dados antigos com gravações duplicadas; não apagam nem escolhem automaticamente quais gravações preservar.

O recorder deve rodar no container Linux com Chromium/Xvfb. API e recorder devem compartilhar banco e `JWT_SECRET`. Configurar `MEETINGS_PROVISIONING_PUBLIC_ENDPOINT` com o endereço WebSocket interno alcançável pela API, por exemplo `ws://meetings-recorder:7088`. Em múltiplos workers, usar endpoint próprio por worker. O cliente acessa somente o relay autenticado da API. O browser temporário tem limite de dez minutos e grace de noventa segundos sem viewer.

`npm test` executa a lista preservada de suítes por um executor Node, evitando o limite de comando do Windows. Bancos PGlite de teste usam portas livres alocadas pelo sistema. `npm run test:meetings` continua disponível para validação focada.

## Estado comercial

`PUBLIC = NO`; `CONTRACTABLE = NO`; `SELF_SERVICE_PROVISIONING = PARTIAL`.

Fluxo self-service implementado e validado com banco PGlite, API/relay WebSocket reais e navegador de login simulado. Os testes verificam que senha/MFA não são persistidos nem logados e que estado de sessão é cifrado. Aprovação comercial ainda depende de homologação com contas Google reais e do recorder Linux, incluindo MFA/challenge, reconexão, abandono e gravação simultânea com áudio/vídeo.

`CLI_ONLY_REQUIRED_FOR_CUSTOMER = NO`; `CUSTOMER_DEPENDS_ON_VORIX_OPERATOR = NO` no fluxo implementado. Isolamento por tenant, conflito em runtime e cifragem têm cobertura automatizada. O teste dedicado de concorrência foi executado contra PostgreSQL 16 em container descartável: doze admissões paralelas, três contas elegíveis, nenhuma reserva duplicada e conta humana nunca selecionada. Container e volume de teste foram removidos ao final. Para repetir, fornecer `VORIX_REAL_PG_URL` apontando para banco descartável migrado.

Validação: suíte completa do backend com 3.563 testes aprovados, nenhuma falha e um teste externo inicialmente omitido; esse teste externo passou na execução separada com PostgreSQL real. Frontend com 87 testes aprovados. Verificações de tipos, contratos e isolamento arquitetural aprovadas.

Nenhuma implantação ou homologação com contas Google reais foi realizada nesta revisão.

Atualização posterior de 14/10/2026: após autorização explícita, API, frontend, worker de Conversas e migrations `0143`–`0148` foram publicados em produção. Recorders/processamento de Meetings permanecem no WSL2 de homologação; gravação real e contratação de Meetings continuam desabilitadas. [Relatório do deploy](production-deploy-20261014.md).
