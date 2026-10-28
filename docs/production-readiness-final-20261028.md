# Vorix — veredito final de produção, 28/10/2026

As correções estão implantadas. **A entrada geral de clientes com checkout real e marketplaces continua bloqueada por homologação externa**, não por falhas nas suítes executadas. Site, venda assistida/WhatsApp e checkout foram validados com dados QA; pagamento de teste do Vorix não foi contado como homologação do Mercado Pago.

```text
SITE_COMMERCE = CODE_AND_CONTROLLED_E2E_PASS
WHATSAPP_COMMERCE = CONTROLLED_E2E_PASS
CHECKOUT = CODE_E2E_AND_REAL_POSTGRESQL_CONCURRENCY_PASS
MERCADO_PAGO_CODE = PASS_PIX_CARD_TOKEN_FLOW_HMAC_IDEMPOTENCY_REFUNDS_BRL_GUARD
MERCADO_PAGO_REAL = BLOCKED_CREDENTIALS
MELHOR_ENVIO_CODE = PASS_QUOTATION_ONLY
MELHOR_ENVIO_REAL = BLOCKED_CREDENTIALS

MERCADO_LIVRE_CODE = PASS_SUPPORTED_CONTRACTS_AND_MOCKED_FLOWS
MERCADO_LIVRE_REAL = BLOCKED_CREDENTIALS
SHOPEE_CODE = PASS_SUPPORTED_CONTRACTS_AND_MOCKED_FLOWS
SHOPEE_REAL = BLOCKED_CREDENTIALS
TIKTOK_SHOP_CODE = PASS_SUPPORTED_CONTRACTS_AND_MOCKED_FLOWS
TIKTOK_SHOP_REAL = BLOCKED_CREDENTIALS
TIKTOK_NF_BLOCKER = YES_EXTERNAL_FISCAL_DOCUMENT_AND_SELLER_CENTER_UPLOAD_REQUIRED

FEATURE_FLAGS = PASS_ALL_THREE_BETA_ZERO_ALLOWLISTED_TENANTS
ALERTING = ACTIVE_EXISTING_BELL_PLATFORM_AND_TENANT_SCOPED
MANUAL_RECOVERY = PASS_RBAC_SCOPE_AUDIT_SAFE_RETRY_AND_RECONCILIATION
WORKERS = PASS_SIX_HEALTHY_ZERO_AUTOMATIC_RESTARTS_IDLE_RESTART_VERIFIED
QUEUE_HEALTH = PASS_NO_STUCK_JOBS_OR_EXPIRED_ORDER_RESERVATIONS
TEST_FLAKINESS = REPRODUCED_AND_FIXED_PGLITE_PROTOCOL_RACE_AND_SOCKET_CAPACITY
BACKUP = PASS_DAILY_DATABASE_WEEKLY_MEDIA_VERIFIED_OFF_HOST_SNAPSHOT
RESTORE_TEST = PASS_DATABASE_API_PUBLIC_SITE_SECRETS_AND_MEDIA_IN_QA
DISASTER_RECOVERY = RUNBOOK_AND_CONTROLLED_RESTORE_PASS
DISK = PASS_13961_MIB_AVAILABLE_80_PERCENT_ROUNDED_USAGE
LOG_ROTATION = PASS_SIX_VORIX_SERVICES_10MB_X3_AND_HOST_LOGROTATE
SECURITY = TARGETED_REVIEW_AND_REGRESSION_TESTS_PASS
RBAC = PASS_ADMIN_MANAGER_ATTENDANT_AND_INDIVIDUAL_GRANTS
TENANT_ISOLATION = PASS_REPOSITORY_API_AND_BROWSER_CHECKS
LGPD_REVIEW = TECHNICAL_MINIMIZATION_REVIEW_DONE_RETENTION_DECISION_PENDING
DATA_RETENTION = PREPARED_DRY_RUN_ONLY_ZERO_CURRENT_CANDIDATES_NO_REAL_DATA_EXPURGE
DATA_INTEGRITY = PASS_WITH_KNOWN_QA_CONFLICT_AND_HISTORICAL_QA_ERRORS_PRESERVED
PERFORMANCE = PASS_CURRENT_VOLUME_PAGINATION_AND_QUERY_REVIEW
RESPONSIVE = PASS_360_390_430_768_1024_1440
ACCESSIBILITY = BASIC_LABELS_KEYBOARD_FOCUS_AND_DIALOG_CHECKS_PASS

BUGS_FOUND = 19_GROUPED_FINDINGS
BUGS_FIXED = 19_GROUPED_FINDINGS

BACKEND_TESTS = 4394_TOTAL_4392_PASS_2_EXISTING_SKIPS_0_FAIL
WEB_TESTS = 217_PASS_0_FAIL
E2E = 61_SCENARIOS_PASS
BUILD = PASS_BACKEND_AND_WEB
ARCHITECTURE_CHECK = PASS_49_CONTRACTS_AND_EXISTING_ISOLATION_CHECKS

NEW_MIGRATIONS = 0
PRODUCTION_COMMIT_BEFORE = 576d781e53598f7d8ac40c2d8abc4a7c90b0a2d2
PRODUCTION_COMMIT_AFTER = df3b965e264152bc489cd864d2be1ec12ce7ad2c
DEPLOY = PASS_BACKUP_SEQUENTIAL_BUILD_MIGRATIONS_HEALTH_AND_ROLLBACK_AVAILABLE
PRODUCTION_SMOKE = PASS_24_PAGES_SIX_WIDTHS_ZERO_JAVASCRIPT_ERRORS

BLOCKED_CREDENTIALS = MERCADO_PAGO_MELHOR_ENVIO_MERCADO_LIVRE_SHOPEE_TIKTOK_SHOP
BLOCKED_EXTERNAL_CAPABILITIES = ML_CANCEL_API_TIKTOK_CLOSE_API_TIKTOK_FISCAL_UPLOAD_ME_LABEL_PURCHASE
REAL_CUSTOMER_BLOCKERS = EXTERNAL_PROVIDER_HOMOLOGATION_AND_TIKTOK_BR_FISCAL_FLOW

READY_FOR_SITE_CUSTOMERS = NO
READY_FOR_MERCADO_LIVRE_CUSTOMERS = NO
READY_FOR_SHOPEE_CUSTOMERS = NO
READY_FOR_TIKTOK_SHOP_CUSTOMERS = NO

OVERALL_PRODUCTION_READINESS = CODE_AND_OPERATION_HARDENED_EXTERNAL_HOMOLOGATION_BLOCKED

MERCADO_PAGO_REAL_VALIDATION = BLOCKED_CREDENTIALS
MELHOR_ENVIO_REAL_VALIDATION = BLOCKED_CREDENTIALS
```

A API e os workers executam `df3b965`; web e social gateway executam a imagem `49b2a065`, cujo código não mudou nos commits seguintes. O ajuste final de logrotate do host (`maxsize 10M`) foi aplicado e validado separadamente; sua configuração acompanha a cópia privada de recuperação e deve ser reposta ao recuperar a release. O commit de documentação/evidências não exige reconstruir a aplicação.

O veredito do Site acima considera a oferta com **checkout e pagamento reais**. A vitrine e a venda assistida não foram bloqueadas pelas flags de marketplaces. O smoke da loja QA confirmou `checkoutAvailable=true` e `sandbox=true`, sem apresentar isso como pagamento real. Mensagens WhatsApp foram exercitadas por inbound controlado e integração com atendimento/CRM; não foram enviadas mensagens a destinatários externos não autorizados.

Os únicos blockers para as liberações marcadas NO são:

- **Site com checkout real:** faltam credenciais e conta QA autorizada do Mercado Pago, com segredo do webhook, para comprovar PIX/cartão, aprovação/recusa, webhook, pedido pago, estoque, Analytics e estorno reais.
- **Cotações reais do Melhor Envio, quando oferecidas:** faltam credenciais autorizadas. Isso não impede retirada ou frete próprio. A implementação atual é de cotação; compra/postagem/etiqueta própria do Melhor Envio não faz parte da capacidade entregue.
- **Mercado Livre, Shopee e TikTok Shop:** faltam aplicativos/contas QA autorizados para comprovar o ciclo real de conexão, catálogo, estoque/preço, pedidos e logística. Permanecem em BETA; credenciais, sozinhas, não liberam um tenant.
- **TikTok Shop BR:** o fluxo fiscal precisa ser comprovado antes da etiqueta. O Vorix não emite NF-e nem envia o XML fiscal; emissão e upload dependem do sistema autorizado/Seller Center. Essa dependência é documentada pelo próprio canal. [Upload Invoice](https://partner.tiktokshop.com/docv2/page/upload-invoice), [NF antes da etiqueta](https://seller-br.tiktok.com/university/essay?knowledge_id=5784364186437393&lang=en).

As capacidades externas bloqueadas não foram tratadas como bugs: cancelamento do Mercado Livre e encerramento do TikTok são encaminhados ao painel do canal; não foram inventados endpoints. Full/FBS/FBT conservam o estoque do marketplace como externo.

As correções foram agrupadas assim, sem contar cada endpoint ou serviço como um bug separado:

| ID | Problema objetivo corrigido |
|---|---|
| 01 | Ausência de autorização explícita por tenant para marketplaces não homologados. |
| 02 | OAuth podia reutilizar conexão de outro provider/aplicativo com o mesmo ID de vendedor. |
| 03 | Listas, totais, detalhes e ações de pedidos não aplicavam o mesmo escopo de equipe dos cancelamentos/estornos. |
| 04 | Status de pedido externo podia ser alterado pelo fluxo manual do Site. |
| 05 | Webhooks de pagamento/Shopee/TikTok confirmavam recebimento mesmo após falha de processamento/persistência. |
| 06 | Ingresso do webhook Mercado Pago não validava HMAC/timestamp; faltava cadastro protegido do segredo. |
| 07 | Produto em moeda estrangeira podia chegar ao pagamento brasileiro sem proteção contra cobrança na moeda errada. |
| 08 | Outbox gerava sincronizações para conexões desconectadas. |
| 09 | Worker marketplace não interrompia a espera ociosa de 60 segundos ao receber SIGTERM. |
| 10 | Infra de testes: Parse/Bind intercalados no PGlite, limite global de sockets inadequado e fixtures presas a host/viewport. |
| 11 | Gate Linux podia terminar com sucesso após falhas em etapas ou testes. |
| 12 | Rollback manual omitindo marketplace worker e podendo anunciar conclusão sem readiness aprovado. |
| 13 | Logs Docker da API, web, worker e PostgreSQL sem limite explícito de crescimento. |
| 14 | Backup diário Vorix ausente do cron; permissões/arquivo parcial e sucesso indevido sem backup do banco principal. |
| 15 | Recuperação de mídia e cópia externa não comprovadas; agora há snapshot privado e restore QA verificados. |
| 16 | Cron com `docker system prune --volumes`; substituído por manutenção de cache sem apagar volumes. |
| 17 | Falhas importantes não tinham entrega operacional pelo sino; monitor usa os destinatários e escopos corretos. |
| 18 | Recuperação de jobs seguros sem ação explícita de retry e exposição de tentativas na interface. |
| 19 | Analytics chamava de bruta uma receita que já considerava reembolsos. |

A suíte backend completa final passou com 4.392 testes e dois skips preexistentes; não foi adicionado skip para esconder regressão. A alteração final de destinatários do monitor teve mais 3/3 testes específicos aprovados. O teste de moeda/HMAC/Commerce/operação teve 28/28 aprovados. Runtime e infraestrutura passaram em três rodadas de 13 testes, sem retries. O teste de protocolo falha com o adaptador original e passa com a serialização corrigida.

Além dos testes PGlite, o PostgreSQL real descartável confirmou: duas compras simultâneas da última unidade não vendem além do saldo; duas submissões da mesma chave geram um pedido; aprovação repetida não duplica baixa; cancelamento/estorno simulados repõem uma vez. O formulário de segredo foi validado em 360/1440 px, limpa os inputs após salvar e não devolve os segredos na resposta.

Na produção, os seis containers Vorix ficaram saudáveis, sem restart automático. O worker marketplace foi reiniciado ocioso sem aguardar os antigos 60 segundos, voltando saudável. As flags efetivas dos três canais são BETA, com zero tenants habilitados. A imagem da API em execução passou também pelos checks locais de HMAC, bloqueio de moeda e recusa de tenant não habilitado, sem chamadas externas.

O banco final tem 187 migrations, 14 pedidos, 11 pagamentos, seis produtos e 66 contatos. As consultas executadas não encontraram estoque negativo/sobrerreservado, pedidos/pagamentos/IDs externos/intents/identidades duplicados, listings/envios órfãos, devoluções inválidas ou estornos acima do pago. Permanecem **um conflito de estoque em pedido TikTok de QA** e **34 jobs históricos de QA em conexões desconectadas**. Foram identificados e preservados, sem exclusão ou correção artificial de dados para tornar o relatório verde. Não há job travado nem reserva vencida encontrada.

O restore da imagem final recuperou banco/migrations, abriu o site publicado com HTTP 200 e descriptografou um segredo restaurado, em rede Docker interna sem portas públicas ou acesso aos providers. Levou aproximadamente **13 segundos**, com imagem já disponível. O restore separado da mídia levou **48 segundos**, recuperando 530 uploads e 3.882 arquivos privados em volume QA descartável. Isso não mede reconstrução de VPS/DNS/TLS.

Foram conferidos por SHA-256, fora da VPS: banco restaurado, banco WuzAPI, código exato da release, mídia e configuração privada. A cópia está em `artifacts/readiness-recovery-20261028/`, fora do Git e com ACL restrita ao usuário/SYSTEM. A cópia externa é um snapshot desta execução; **replicação externa contínua não foi configurada**. Banco local é diário, com 14 dias; mídia é semanal, preservando pelo menos as duas últimas cópias válidas. Pacotes de deploy recentes e imagens de rollback foram preservados. Somente tarballs temporários idênticos às releases retidas foram removidos.

O alerta foi comprovado pela infraestrutura de notificações existente. Falhas comerciais vão a administradores ativos do tenant; infraestrutura vai somente a administradores da plataforma, uma vez por destinatário/condição/dia. Não há pager fora do host: indisponibilidade total do host/banco impede entrega pelo próprio sino. Alertas transitórios emitidos durante o rollout tiveram duplicatas dispensadas, mantendo o histórico.

A revisão técnica de privacidade verificou URL sem query/fragmento, referrer reduzido ao domínio, UTM limitada, identificador aleatório sem fingerprint e associação posterior ao CRM com escopo. A política de expurgo está preparada e foi executada **somente em dry-run**, com zero candidatos atuais. O usuário limitou a autorização antes de apagar dados reais; por isso não foi instalado cron destrutivo para eventos/identidades/carrinhos/jobs. Pedidos, pagamentos, devoluções e histórico comercial permanecem preservados. Isso não equivale a parecer jurídico ou certificação LGPD.

Performance e acessibilidade foram avaliadas no volume atual e nas telas comerciais exercitadas. Não foi alegado teste de carga de grande tenant, pentest externo ou certificação WCAG. Ficam como backlog operacional: cadência de cópias externas automatizadas, decisão formal de descarte/retenção, retenção dos pacotes antigos de deploy, rebuild completo de host e benchmark de catálogo grande.

Procedimentos vigentes: [runbook](operations/production-readiness.md). Evidências sanitizadas e screenshots: [pasta da revisão](qa/production-readiness-20261028/README.md). Não foi iniciada outra fase.
