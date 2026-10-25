# Vorix — publicação da revisão de integração

Publicação concluída em 25/10/2026. Verificação final às 08:55, America/Sao_Paulo.
Solicitação explícita: commitar e publicar todas as alterações locais, atualizando Git e servidor.

- Aplicação: `6530754f9b123c1158bedd9d82e867ce43ead926`, enviado à `main`.
- Entrega principal: `78f47d9d32e6c370d009cb86dd41dd76f0c56c08`.
- Site: <https://vorixworks.com>. API: <https://api.vorixworks.com>.
- API e worker saudáveis; web HTTP 200; `ready=true`; zero erros fatais detectados no deploy.
- 176 migrações aplicadas, nenhuma pendente e nenhuma divergência de checksum.
- Backend: 4.075 aprovados, 2 pulados, nenhuma falha. Frontend: 167 aprovados; typecheck e builds
  aprovados. Arquitetura: 49 contratos e verificações de isolamento aprovados.
- Navegador local: 191 cenários únicos aprovados, 13 pulos intencionais. Produção: 26 verificações
  públicas aprovadas em 1.440 e 390 px, sem erros JavaScript, incluindo a imagem de prévia da proposta.

## Conteúdo publicado

Todas as alterações reais que estavam no workspace foram incluídas: atendimentos e ciclos de
responsabilidade, indicadores e SLA, perfis/permissões/equipes, Kanban de oportunidades,
automações, fechamento sem proposta, valores/metas, arquivamento/reabertura, mensagem e página
de proposta, motivos/comentários de recusa, segurança de APIs/mídias/stream e testes integrados.
Os detalhes e a classificação dos problemas estão na
[revisão de integração](revisao-integracao-vorix-2026-10-25.md).

## Procedimento e recuperação

Executado o script oficial `scripts/deploy/deploy-production.sh`, alvo `all`, em `/opt/zuno`
no servidor `209.97.152.212`. Pacote gerado por `git archive`, com bytes canônicos do commit.
SHA-256 conferido no destino:
`0d69e5b3f5726cf069192ee5db660d0c44f5321e3ba17d085d55c62faa4b3fc8`.
Configuração `.env.zuno` preservada; builds sequenciais; migrações antes da troca dos processos.

A primeira tentativa encontrou uma importação do backend em fixtures E2E que não existia no
contexto Docker do frontend. O rollback automático preservou a versão anterior, antes de aplicar
qualquer migração. A correção tornou a fixture independente; o build Linux da segunda tentativa
passou e seu log termina com `DEPLOY_DONE`.

Backups da publicação final, stamp `20261025115156` UTC:

- Código: `/opt/zuno/deploy_backups/pre-6530754f9b123c1158bedd9d82e867ce43ead926-20261025115156.tgz`.
- Banco: `/opt/zuno/deploy_backups/db-pre-6530754f9b123c1158bedd9d82e867ce43ead926-20261025115156.sql.gz`.
- Configuração: `/root/.env.zuno.pre-6530754f9b123c1158bedd9d82e867ce43ead926-20261025115156`.
- Imagens anteriores: tags `rollback-20261025115156`; retenção de três gerações pelo script oficial.
- Log: `/var/log/vorix-deploy-6530754f9b123c1158bedd9d82e867ce43ead926-20261025115156.log`.

## Banco e conferências

Aplicadas `0172_inbox_attendance_cycles`, `0173_access_profiles_and_scope`,
`0173_deal_commercial_lifecycle`, `0174_inbox_sla_policies` e `0175_integration_review`.
As migrações anteriores mantiveram seus checksums. Foram preservados dois atendimentos abertos
no backfill e nenhum encerramento antigo elegível. Conferências encontraram zero atendimentos
abertos duplicados, zero ciclos ativos duplicados, zero funis com resultados inválidos e zero
divergências de empresa nos atendimentos. Os sete índices essenciais verificados estão presentes.
Doze arquivos de aplicação/migração no servidor conferem com os hashes canônicos do commit.

Evidências: [validações](qa/integration-review-20261025/validation.json),
[navegador](qa/integration-review-20261025/production-smoke.json),
[banco](qa/integration-review-20261025/production-db.json) e
[código](qa/integration-review-20261025/production-source.json).
Capturas e logs completos permanecem em `.qa/` local; logs operacionais também no servidor.

## Limites

O aviso preexistente de `production_guard` mantém o resumo de readiness como `degraded`;
`ready=true`, banco, secrets, estado operacional e fila estão aprovados. Configuração preservada.
Espaço final aproximado: 6,3 GB livres; backups mantidos.

Não foram enviados WhatsApps, criadas cobranças ou alteradas contas de clientes durante o smoke.
Os fluxos autenticados foram exercitados com dados controlados nos testes. A política para
atendimentos já atribuídos a usuários desativados permanece a única decisão de negócio pendente;
novas atribuições e acesso dessas pessoas estão bloqueados. Riscos técnicos restantes e o cenário
de renovação em navegador não executado estão discriminados na revisão de integração.

A documentação e as evidências finais são sincronizadas ao servidor em commit posterior,
sem recompilar a aplicação acima: a única diferença é de documentação.
