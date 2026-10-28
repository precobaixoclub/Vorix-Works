# Operação e recuperação do Vorix

Revisão de produção: 28/10/2026. Este é o ponto de entrada operacional; os contratos detalhados continuam nos documentos ligados abaixo. Resultado e evidências desta execução: `docs/qa/production-readiness-20261028/`.

## Comércio e credenciais

- Site, carrinho, checkout e central: [Commerce](../vorix-commerce-fase2.md), [Analytics](../site-commerce-analytics.md), [Catalog Bulk](catalog-bulk-operations.md).
- Mercado Pago e Melhor Envio usam credenciais **do lojista**, cifradas em `operational_secrets`, por tenant/site. As credenciais de billing do próprio Vorix não homologam o checkout dos clientes.
- Sem token Mercado Pago, o checkout real permanece indisponível. Sandbox Vorix é simulação interna, não homologação do Mercado Pago. Cartão usa tokenização no navegador; PAN/CVV não devem passar pela API Vorix.
- Melhor Envio atualmente **cota frete** com CEPs, quantidade, peso em kg e medidas em cm. Não implementa compra/postagem/etiqueta própria; não prometer essa capacidade. Sem medidas não inventa cotação. Retirada/frete próprio continuam possíveis quando configurados.
- Homologação de PIX/cartão, webhook e refund exige credenciais e conta QA autorizadas. Pagamento ou refund real não deve ser inferido de testes com mocks.
- Mercado Pago também exige a **Assinatura secreta do webhook** do aplicativo do lojista. O checkout não abre sem ela. A rota valida HMAC-SHA256 sobre ID da query, request ID e timestamp, compara em tempo constante e rejeita notificações com mais de cinco minutos de diferença. O segredo fica no cofre e o status só expõe se está configurado. Assinatura inválida recebe 401; falha temporária de processamento recebe 503 para permitir reenvio. A releitura na API e a idempotência continuam obrigatórias. Contrato: [documentação oficial](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/optional-notifications) e [guia do SDK oficial](https://github.com/mercadopago/sdk-nodejs/blob/master/docs/webhooks.md).

## Disponibilidade dos marketplaces

[Homologação e contas de teste](../marketplaces-homologacao.md).

API e worker recebem as mesmas variáveis, para cada `MERCADO_LIVRE`, `SHOPEE`, `TIKTOK_SHOP`:

```text
MARKETPLACE_<PROVIDER>_AVAILABILITY=BETA
MARKETPLACE_<PROVIDER>_TENANT_IDS=tenant-qa-exato,outro-tenant-qa
```

Estados: `DISABLED` bloqueia todos; `BETA` e `REAL_VALIDATED` exigem matrícula explícita; `GENERALLY_AVAILABLE` permite acesso geral. Valor inválido falha fechado. Lista vazia não libera ninguém; `*` não é curinga. Credenciais de aplicativo não concedem acesso. A conferência vale no início/callback OAuth, enfileiramento e leitura de tokens pelo worker. Site Commerce independe dessas flags.

Não mudar para GA sem evidência de homologação real de cada canal. IDs iguais de vendedor em provedores/aplicativos diferentes não compartilham conexões ou credenciais.

## TikTok Brasil e nota fiscal

O provider já consulta pedido, envio, etiqueta e a indicação fiscal recebida do canal. O Vorix **não emite NF-e e não faz upload de XML fiscal**. A etiqueta permanece bloqueada enquanto a NF estiver pendente. Os dados fiscais completos do comprador devem ser obtidos no Seller Center/fluxo autorizado, com minimização e acesso restrito.

A NF deve ser emitida por sistema autorizado externo ou pelo emissor do Seller Center, quando o vendedor for elegível. Depois deve ser enviada no Seller Center e o pedido relido no Vorix. Essa dependência é específica do TikTok BR; não bloqueia os outros canais ou o Site.

Referências oficiais verificadas nesta revisão: [Upload Invoice API](https://partner.tiktokshop.com/docv2/page/upload-invoice), [emissão e upload no Seller Center](https://seller-br.tiktok.com/university/essay?knowledge_id=4896169624913680&lang=en), [dados do comprador e NF antes da etiqueta](https://seller-br.tiktok.com/university/essay?knowledge_id=5784364186437393&lang=en).

## Alertas, filas e recuperação manual

`scripts/operations/monitor-host.sh` roda fora da API a cada cinco minutos. Verifica saúde dos seis containers Vorix, disco e erros recentes de webhook/worker; usa a mesma imagem do backend e a rede interna para consultar filas e publicar na central de notificações existente.

Destinatários: Administradores (`owner`) ativos do tenant afetado para problemas comerciais; falhas de infraestrutura vão somente a administradores da plataforma, em um workspace por destinatário. A mesma condição notifica no máximo uma vez por dia. Abrange reautenticação, fila atrasada, retries repetidos, job travado/incerto/fatal, divergência de anúncio, pedido pago sem estoque, reserva vencida e cancelamento sem estorno. Não há envio automático de mensagens aos compradores.

O sino exige que alguém consulte o Vorix. Não há canal externo configurado para pager/e-mail/SMS; indisponibilidade do banco/host inteiro impede a entrega pelo sino. O cron retorna falha e mantém log nesse caso. Não declarar vigilância externa 24×7.

Na tela Marketplaces: conferir último erro, itens, tentativas e histórico; reconciliar ou sincronizar preço/estoque. A ação **Tentar novamente** só reprocessa operações seguras de leitura/sincronização e cria vínculo auditado ao job original. Repetir a mesma chave não cria outro job. Publicação incerta exige **reconciliação**, nunca replay de POST. Alteração destrutiva de status continua exigindo confirmação específica. Conta desconectada não recebe novos jobs do outbox.

Na Central de Pedidos: reler status externo, etiqueta e devoluções. Listas, totais, detalhes e ações obedecem a tenant/workspace/equipe. Cancelar exige `order:cancel`; estornar exige `payment:refund`; gerente precisa da concessão individual e do escopo. Status de pedido externo é atualizado pelo canal de origem.

Worker sem progresso: verificar health/heartbeat, logs limitados e leases. `unless-stopped` reinicia processo encerrado, **não** um container meramente `unhealthy`; inspecionar a causa e reiniciar o serviço autorizado. Publicações interrompidas viram resultado incerto; estoques e pedidos têm chaves idempotentes. O worker marketplace interrompe a espera ociosa ao receber SIGTERM.

## Backup, restore e disaster recovery

Host atual: `/opt/zuno`, Compose `docker-compose.zuno.yml`, configuração privada `.env.zuno`.

| Artefato | Local | Frequência / retenção |
|---|---|---|
| Banco Vorix e WuzAPI | `/opt/backups/postgres/*.sql.gz` | diário, 03:30 UTC (00:30 São Paulo); 14 dias, só remove vencidos após backup válido |
| Banco antes do deploy | `/opt/zuno/deploy_backups/db-pre-<sha>-<stamp>.sql.gz` | antes de cada deploy |
| Código anterior | `/opt/zuno/deploy_backups/pre-<sha>-<stamp>.tgz` | antes de cada deploy; contém configuração privada, acesso restrito |
| Código exato da release | `/opt/zuno/deploy_backups/release-<sha>.tgz` | após cada deploy aprovado |
| Configuração | `/root/.env.zuno.pre-<sha>-<stamp>` | antes de cada deploy; modo privado |
| Sessões sociais cifradas | `/opt/zuno/deploy_backups/social-sessions-pre-*.tgz` | antes do deploy |
| Uploads, mídia privada e sessões sociais | `/opt/backups/vorix-media/media-*.tgz` | semanal; mínimo das duas últimas cópias válidas, expurgo só além de 14 dias |
| Imagens para rollback | tags `rollback-<stamp>` dos serviços | três últimas por serviço |

Manifesto diário: `backup-manifest.jsonl`. Dump é escrito em `.partial`, validado e renomeado atomicamente; falta do banco principal é falha, mesmo se WuzAPI tiver backup. Um arquivo gzip válido não prova sozinho restore: manter a evidência do ensaio.

Executar como root para **provar** restauração, sem substituir produção:

```sh
bash /opt/zuno/scripts/operations/restore-production-backup.sh /caminho/backup.sql.gz
```

O script cria banco e API descartáveis em rede `--internal`, sem portas públicas e sem credenciais externas. Restaura com `ON_ERROR_STOP`, confere migrations, contagens, readiness e site publicado; remove apenas os containers/rede QA criados por ele. Resultado privado em `deploy_backups/restore-proof-<stamp>/`. Nunca usar `psql` de restore contra `zuno` em produção.

Recuperação de desastre em host novo:

1. Instalar Docker/Compose e configurar acesso TLS/DNS/Traefik, redes externas usadas pela stack e o gateway de Conversas/RabbitMQ, quando aplicável.
2. Recuperar a release e `.env.zuno` protegida. Preservar `ZUNO_JWT_SECRET`: ele também cifra os segredos do banco; gerar outra chave perde acesso às credenciais existentes. Recuperar chaves/sessões do social gateway.
3. Subir **só** PostgreSQL; restaurar para banco novo e validar primeiro em QA. Repor volumes de uploads e mídia privada a partir de backup próprio, se disponíveis.
4. Conferir checksums/migrations, aplicar apenas pendentes aditivas; subir API, workers, gateway e web, nessa ordem.
5. `/readyz`, health dos containers, login, site público, produto, pedido QA e reconciliação controlada. Não liberar tráfego de escrita sem conferir credenciais e flags.
6. Repor `scripts/operations/vorix-logrotate.conf` com a cópia privada homônima antes de reinstalar cron/logrotate com `scripts/operations/install-host-operations.sh`; verificar backup diário e notificações. A correção final de `maxsize 10M` foi aplicada ao host separadamente da release `df3b965`.

Rollback de código: `sh scripts/deploy/rollback-production.sh <stamp> all`. Inclui marketplace worker; não retrocede schema/banco. Restore de produção em desastre exige janela e autorização explícita, pois substitui dados reais.

O ensaio mede restore de banco e subida da API, não reconstrução de VPS ou DNS/TLS. O backup de mídia deve ser extraído somente para volumes QA e conferido antes de uso. Sem cópia fora da VPS, perda total do host continua sem recuperação completa. Não prometer RTO corporativo; usar tempo do ensaio como limite inferior e reservar tempo para rebuild/rede/secrets.

Ensaio final desta revisão: banco/API em aproximadamente 13 segundos e mídia em 48 segundos, com imagens e Docker já disponíveis. Não inclui download externo, instalação do host ou DNS. Snapshot externo desta execução fica em `artifacts/readiness-recovery-20261028/` na estação de trabalho, fora do Git, com ACL restrita ao usuário/SYSTEM e SHA-256 conferido. Não há replicação externa diária configurada; copiar os próximos backups para destino aprovado continua sendo responsabilidade operacional.

## Disco e logs

Todos os seis serviços Vorix: JSON Docker, 10 MB × 3 arquivos por serviço. Logs operacionais do host: logrotate diário com `maxsize 10M` (sem substituir a periodicidade diária), 14 arquivos comprimidos. A configuração efetiva `/etc/logrotate.d/vorix` também acompanha a cópia privada de recuperação. Não altera stacks de outros sistemas.

Limpeza semanal: apenas cache de build antigo, preservando 4 GB. Sem `docker system prune --volumes`, sem remoção de banco ou volumes e sem expurgo amplo de imagens. Backups de deploy e artefatos em `/tmp` devem ser revisados com identificação do artefato; nenhum backup recente é removido pela manutenção.

## Retenção e privacidade

O navegador usa ID aleatório de sessão, sem fingerprint. URL registrada perde query/fragmento; referrer vira somente hostname. UTM é limitada e deve conter campanhas, nunca CPF/e-mail ou informações sensíveis. A associação a contato depende de intenção convertida; associação ambígua não deve revelar jornada de outra pessoa. Escopo das equipes se aplica a leads/jornadas.

`node scripts/operations/data-retention.mjs` é **dry-run**. Política preparada: eventos brutos 90 dias; projeções anônimas e vínculos 400 dias; jobs concluídos 90 dias; OAuth expirado 1 dia; carrinhos anônimos vencidos, sem pedido/intenção, 30 dias. Limpeza limita cada tabela a 1.000 registros/execução. Pedidos, pagamentos, devoluções, intenções convertidas e falhas/auditoria comercial ficam preservados.

**Expurgo de dados reais não foi autorizado nesta solicitação.** Aplicação exige decisão explícita de descarte e `VORIX_DATA_DISPOSAL_AUTHORIZED=true` com `--apply`; não instalar cron destrutivo. Recibos de deduplicação e histórico comercial precisam de decisão de retenção própria antes de crescerem. Não chamar dry-run de retenção aplicada.

Insumos para política de privacidade/cookies: finalidade de analytics e atendimento, identificadores/UTMs coletados, armazenamento local/cookies usados, vinculação posterior ao CRM, operadores externos envolvidos, prazos aprovados, direitos/canal do titular, transferência e acesso a dados de pagamento/marketplace. Isso não é parecer nem política jurídica definitiva.

## Diagnóstico e validação

- `node scripts/operations/readiness-audit.mjs`: consultas somente leitura para integridade, filas, credenciais presentes (sem valores), cardinalidade e tamanho.
- `node scripts/operations/monitor.mjs --dry-run`: condições que gerariam notificação.
- `node scripts/operations/data-retention.mjs`: volume candidato, sem apagar.
- Backend: `npm test`; web: `npm --prefix web test`, typecheck/build em cada pacote; arquitetura: `npm run architecture:check`.
- Navegador: `cd web && npx playwright test --config playwright.readiness.config.ts`. Backend efêmero real para Site/Catalog Bulk; contratos simulados para UI de marketplaces. Analytics usa fixture/config específicos existentes. Nenhum desses substitui homologação externa.
- PGlite TCP usa PostgreSQL de sessão única. O helper de teste mantém ordem por conexão e propriedade do protocolo até Sync/commit, evitando mistura de Parse/Bind. Teste de fragmentação reproduz o erro sem o adaptador. Concorrência comercial real continua exigindo PostgreSQL real.

Não ocultar erro de teste como flakiness. `TEST_INFRA_FAILURE` identifica falha do adaptador/ambiente; erro de regra/permissão/estoque é `PRODUCT_FAILURE`. Gate Linux agora propaga falhas de cada etapa e dos testes em seu exit code.
