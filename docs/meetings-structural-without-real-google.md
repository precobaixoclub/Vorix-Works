# Vorix Meetings — validação estrutural sem Google real

14/10/2026, America/Sao_Paulo. Escopo atualizado pelo usuário: implementar e validar com fixtures controladas, sem solicitar e-mails ou cadastro manual, sem login/MFA Google real, sem Meet ou gravação real.

Atualização posterior: o usuário autorizou a homologação real, e a primeira tentativa de login foi recusada pelo Google como navegador/app possivelmente inseguro. A tentativa de compatibilidade com Chrome oficial está no [relatório de homologação real](meetings-real-customer-managed-homologation.md). Os resultados abaixo pertencem à etapa estrutural e não comprovam aceitação do login Google.

```text
IMPLEMENTATION_COMPLETE_WITHOUT_REAL_GOOGLE = YES
READY_FOR_REAL_GOOGLE_SMOKE = YES
SELF_SERVICE_IMPLEMENTED = PASS
REMAINING_BLOCKERS = somente homologação real, quando autorizada pelo usuário:
                    contas Google reais, login/MFA/challenge, health check real,
                    Meets controlados, captura/player/transcrição e simultaneidade reais.
PUBLIC = NO
CONTRACTABLE = NO
COMMERCIAL_OBJECT_STORAGE = PENDING
SELF_SERVICE_PROVISIONING_REAL = NOT_TESTED
REAL_RECORDING = NOT_TESTED
```

`READY_FOR_REAL_GOOGLE_SMOKE` indica que implementação, infraestrutura e testes estruturais estão prontos. Não indica aprovação comercial nem aprovação de qualquer cenário Google real. Os recorders e a API permanecem no ambiente WSL2 de homologação, sem deploy em produção. Nenhum e-mail real é necessário para esta etapa, e nenhuma nova solicitação de e-mails foi feita depois da alteração de escopo.

## Evidência estrutural

| Requisito | Evidência | Resultado |
| --- | --- | --- |
| Self-service e telas | Login Vorix pelo formulário normal; Conectar/Reconectar pelo produto; canvas recebe frames do simulador local e encaminha teclado/MFA fictícios pelo relay | PASS |
| APIs e autenticação | API do produto com `AUTH_MODE=jwt`, assinaturas/sessões reais e PostgreSQL; cadastro dos usuários fictícios via endpoint normal | PASS |
| RBAC | Editor não administra contas; administrador autorizado usa o fluxo normal | PASS |
| Tenant isolation | Token válido de outro tenant não acessa conta ou viewer; usuário diferente do mesmo tenant não reutiliza sessão | PASS |
| Sessão temporária e relay | Sessões vinculadas a usuário/tenant; WebSocket API → provisioner; token de uso único, replay recusado, expiração e abandono encerram browser | PASS |
| Criptografia | Cookie fictício só aparece após descriptografar; ciphertext não expõe o cookie; nenhum password/MFA fictício encontrado em banco, auditoria ou logs da API/provisioner | PASS |
| Health check e reconexão | Simulação de login expirado produz `reauth_required`; falha preserva ciphertext anterior; novo login + health check simulado validado substituem estado e retornam `active` | PASS |
| Capacidade | Com plano 2 e duas contas fictícias saudáveis: `planCapacity=2`, `tenantHealthyCapacity=2`, `tenantAvailableCapacity=2`, verificados pela API e pela tela | PASS |
| Identidade e alternativa | Identidade explícita exclui A; seleção automática reserva B; auditoria registra conflito. Inferência, precedência e ausência de alternativa têm cobertura na suíte Meetings | PASS |
| Scheduler | Avaliação do agendamento cria admissão/fila usando identidade confirmada, no PostgreSQL de fixtures | PASS |
| Reserva atômica | Solicitações paralelas no PostgreSQL respeitam limite 1; uma admissão passa e a outra retorna `CONCURRENCY_LIMIT_REACHED`. Suíte também valida índices contra duplicação e motivos de indisponibilidade | PASS |
| Migrations | `0147` aceita com checksum existente; `0148` aplicada após reparação histórica autorizada; repetição oficial retorna nada a aplicar | PASS |
| Build/typecheck/arquitetura | Backend e frontend no Linux, 49 contratos e isolamento arquitetural | PASS |

## Testes e separação da simulação

- `test:meetings`: 71 aprovados, zero falhas, um teste PostgreSQL externo omitido na rodada Linux. O teste de concorrência PostgreSQL externo já passou separadamente na revisão anterior.
- Frontend: 87 aprovados em 12 arquivos; build Docker e typecheck aprovados.
- Novo teste de browser: **8 aprovados, zero falhas**, executado contra API/Next.js/relay reais e PostgreSQL 16, com autenticação JWT normal.
- Scripts JavaScript verificados com `node --check`, scripts Bash com `bash -n`, diff sem erros de whitespace.

O simulador está em `tests/fixtures/meetings-structural-provisioner.mjs`. Sua página diz explicitamente “SIMULADOR LOCAL — SOMENTE FIXTURES”. Só aceita contas terminadas em `.invalid` e permite navegação do browser apenas ao servidor local da fixture; requisições externas são abortadas. Health check, cookie e formulário de MFA são **fictícios**. A API, o frontend, a autenticação, o banco, a criptografia, a reserva e o relay usam a implementação do produto.

Banco de simulação: `vorix_structural_fixture_20261014`, separado de `vorix_homolog`. Endpoints de teste: API `localhost:3300`, frontend `localhost:3301`, controle local da fixture `localhost:3310`. Nenhum worker de captura real ou processamento de produção consome jobs desse banco. Solicitações de gravação nos testes verificam admissão/fila e são canceladas, sem abrir Google Meet ou iniciar captura.

A expiração do teste de browser é acelerada em dados de fixture para dois segundos; a grace de abandono do simulador é dois segundos. O produto conserva TTL de dez minutos e grace de noventa segundos. Esses ajustes de fixture não alteram configuração comercial ou de produção.

## Ambiente pronto para futura decisão de smoke

- Frontend principal: `http://localhost:3001`.
- API principal: `http://localhost:3000`, healthy.
- `vorix-recorder-1` e `vorix-recorder-2`: imagem atual, healthy; WebSockets internos sem portas publicadas.
- Banco/JWT/storage compartilhados entre API e recorders, verificados sem imprimir segredos.
- Storage persistente: `/root/vorix-homolog/customer-managed-20261014/storage`.
- Processamento Linux com ffmpeg, ffprobe, faster-whisper e modelo `base` CPU/int8 pronto no cache persistente.
- Administrador Vorix **fictício** criado automaticamente: `structural-admin@vorix-fixture.invalid`; credencial pública de teste definida em `scripts/meetings/prepare-homolog-fixture-admin.mjs`. Não é uma conta Google e não deve ser utilizada fora da homologação.
- Tenant do administrador: `tenant-mv8iyzl6-yzzabb`; workspace: `workspace-mv8iyzt7-jluzhy`; papel `admin`; Meetings concedido internamente, plano 2.
- Acesso desse administrador e tela de contas validados no browser real. Capacidade inicial medida: plano 2, saudáveis 0, disponíveis 0; **nenhuma conta Google conectada**.

A última verificação do banco principal confirmou zero contas visíveis de gravação, zero reuniões e zero sessões abertas de provisionamento. O workspace histórico foi restaurado como arquivado com autorização; conta removida e sessão cancelada permaneceram preservadas. Nenhuma migration aplicada foi modificada.

Encerramento da etapa: 19 browsers de fixture abertos e 19 fechados, zero ativos. Os três serviços exclusivos de simulação foram parados, preservando banco e evidências. API, frontend principal, dois recorders e processamento continuam disponíveis no ambiente de homologação; API e recorders estão healthy. Os scripts abaixo reiniciam os serviços de fixture para repetição.

## Repetição automatizada

No WSL2 preparado, a partir da raiz do repositório:

```bash
bash scripts/meetings/prepare-structural-fixtures.sh
bash scripts/meetings/build-structural-fixture-web.sh
bash scripts/meetings/test-structural-fixtures.sh
```

Pré-requisitos: rede/container PostgreSQL de homologação existentes, imagens atuais `vorix-meetings-recorder:customer-managed-0148` e `vorix-meetings-homolog-tools:0148`, snapshot Linux do código e arquivo protegido `secrets/runtime.env` no diretório de homologação. `MEETINGS_HOMOLOG_ROOT` permite indicar outro diretório preparado. O teste Node exige o endpoint `/fixture-only/scope` e verifica que o banco começa com `vorix_structural_fixture_`, recusando execução contra o ambiente principal.

O teste está em `tests/meetings-self-service-browser.test.mjs` e foi incluído na lista de `npm test`. Sem configuração explícita de fixture, é omitido; nenhuma conexão externa ou login Google é acionado automaticamente pela suíte padrão.

Evidências: `/root/vorix-homolog/customer-managed-20261014/structural-fixtures/evidence/browser-tests.log`, logs de build/migrations de fixture e evidências principais `controlled-admin-ui.json`, `controlled-admin-fixture.json`, `migrations-approved-first.log` e `migrations-approved-second.log`.

Estado final registrado em `structural-fixtures/evidence/final-metrics.json` e `evidence/final-main-state.json` no mesmo diretório de homologação.

Correção isolada de runtime já entregue: commit `a3359d4b71ceff37aa4230605edbba89bf06de90`, PID Chromium obtido via CDP. A nova cobertura de browser usa fixtures e não reabre a arquitetura.

Etapa concluída sem Google real. Parada no limite definido pelo usuário; homologação real só será iniciada quando ele decidir.

Atualização posterior de 14/10/2026: o usuário autorizou publicar a aplicação local em produção. API, telas e schema de Meetings foram implantados com as demais alterações da aplicação; recorders/processamento permanecem na homologação WSL2. Gravação real continua desabilitada em produção, sem contas de gravação ou sessões abertas. Esse deploy não aprova homologação Google ou liberação comercial. [Relatório de produção](production-deploy-20261014.md).
