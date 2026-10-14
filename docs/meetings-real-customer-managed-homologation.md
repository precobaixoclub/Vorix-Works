# Vorix Meetings — homologação real customer-managed

Data: 14/10/2026, America/Sao_Paulo. Estado: **PRIMEIRA TENTATIVA GOOGLE RECUSADA; CHROME OFICIAL PREPARADO; AGUARDANDO NOVO LOGIN MANUAL DA RECORDER A**. A etapa estrutural anterior está registrada em [validação sem Google real](meetings-structural-without-real-google.md).

Nenhum deploy em produção foi feito. `PUBLIC = NO`, `CONTRACTABLE = NO`. Rodada 4 não iniciada.

## Bloqueio observado no primeiro login real

O usuário iniciou a conexão da Recorder A pelo produto e recebeu do Google “Esse navegador ou app pode não ser seguro”. Isso é uma **recusa real de login**, não um health check aprovado nem uma gravação executada. O Google [documenta que pode recusar navegadores controlados por software](https://support.google.com/accounts/answer/7675428?hl=pt-BR). O provisioning usa Playwright; essa é uma hipótese compatível com o bloqueio, sem confirmação do motivo interno específico do Google.

Na inspeção, o browser era headed, JavaScript estava habilitado e não havia `--enable-automation` no processo principal. Portanto, não foi atribuída a causa exclusivamente a essa flag. Não foram feitas mudanças de fingerprint, user-agent, MFA ou verificações do Google.

Estado observado:

- Conta `rec-acc-mv8ky8gv-a3cc104f66`: `customer_managed`, tenant correto, `workspace_id=null`, `disabled`, sem sessão cifrada e sem health check aprovado.
- Provisionamento `rprov-mv8ky8h1-ed94540912`: estava `live` no worker `recorder-homolog-2`.
- Tentativa encerrada pelo botão Cancelar do produto. Sessão passou para `cancelled`; Chromium e Xvfb temporários encerrados. Nenhum ffmpeg ativo. PulseAudio manteve apenas o sink padrão `auto_null`, esperado no worker ocioso.
- Zero reuniões no tenant; conta permanece cadastrada para Reconectar, sem remoção de dados históricos.

A imagem de compatibilidade foi construída com o pacote Chrome estável oficial do Google, versão **155.0.8059.79**, para Linux amd64: `vorix-meetings-recorder:customer-managed-chrome-stable-0148`. Chrome tem [suporte oficial no Debian Linux](https://support.google.com/chrome/answer/95346?co=GENIE.Platform%3DDesktop&hl=pt-BR) e [suporte no Playwright](https://playwright.dev/docs/browsers#google-chrome--microsoft-edge). Essa mudança de distribuição do browser mantém a arquitetura; **não comprova nem garante aceitação do login pelo Google**. O usuário continuará digitando somente no viewer. A confirmação exige novo login manual pelo produto; não serão repetidas automaticamente tentativas de autenticação.

Correção isolada: commit `4e7f7d94cdcef18a7c16524789486581c3da0c53`, contendo somente `docker/meetings-recorder.Dockerfile`. Os argumentos de lançamento e os mecanismos de autenticação não foram alterados. O browser padrão da imagem passa a ser `/usr/bin/google-chrome-stable`; o Chromium da distribuição permanece disponível para diagnóstico. Gate backend repetido com 71 aprovados/um externo omitido, typecheck/build/arquitetura PASS. Frontend repetido com 87 aprovados e typecheck/build PASS. A conclusão desses gates não aprova login Google.

Os dois workers foram substituídos somente após verificar ausência de gravações e provisionamentos ativos. API, frontend, banco e processamento foram preservados. Containers anteriores parados em `vorix-recorder-before-chrome-1-20261014` e `vorix-recorder-before-chrome-2-20261014`, disponíveis para rollback. Workers atuais healthy, usando Chrome oficial via `MEETINGS_CHROMIUM_PATH=/usr/bin/google-chrome-stable`. Probe anônimo da factory recebeu frame e foi encerrado, sem login. Em seguida, Reconectar foi aberto para a conta A existente pela interface, sem pedir novamente seu e-mail; viewer recebeu a tela de login e aguarda ação humana. Nada foi preenchido automaticamente no Google.

Evidências: `evidence/real-google/login-block-before-cancel.log`, `login-block-state.log`, `chrome-compatibility-build.log`, `chrome-version.log` e `chrome-login-readiness.json` no diretório de homologação. Senha/MFA/cookies/storageState não foram consultados para o diagnóstico.

## Retomada autorizada da homologação real

O novo pedido autoriza exclusivamente homologação Google/Meet real, preservando arquitetura e bloqueio comercial. A sequência aguarda uma ação humana por vez: primeiro conectar Recorder A pelo produto, depois validar seu estado e solicitar Recorder B. Não foram solicitados e-mails, senha ou MFA no chat.

Preflight repetido nesta retomada:

- Os serviços principais estão ativos; API e dois recorders estão healthy. Frontend e API acessíveis.
- `npm run db:migrate` executado pelo fluxo oficial contra `vorix_homolog`: nada a aplicar. Nenhuma migration aplicada foi alterada.
- Banco/JWT/storage compartilhados confirmados sem imprimir segredos; escrita pela API e leitura pelos dois recorders aprovadas.
- Endpoints de provisionamento internos acessíveis; portas dos recorders não publicadas. Relay sem autenticação recusado com 4401.
- Chromium headed, Xvfb e sink exclusivo confirmados. Browser/display/sink do probe encerrados.
- Factory real `PlaywrightRemoteLoginBrowserFactory` abriu a página pública de login Google e recebeu frame 1024×720; nenhuma identidade ou credencial foi digitada. Esse probe foi fechado, sem sessão autenticada. A recepção do frame comprova abertura/renderização, não aprova login, health check autenticado ou aceitação de automação pelo Google.
- Login normal do administrador fictício Vorix e tela de contas aprovados; plano 2, saudáveis 0, disponíveis 0, contas Google conectadas 0.
- Janela Chrome visível e isolada do perfil pessoal aberta no produto, já autenticada no Vorix. Formulário “Conectar conta de gravação” aberto, nome “Recorder A — homologação real” preenchido e e-mail vazio. O e-mail esperado é obrigatório nesse formulário; será informado pelo usuário diretamente no produto antes de abrir o viewer Google. Não foi criada conta fictícia para contornar essa etapa.

Ação pendente: usuário informa a identidade dedicada A no formulário do produto, clica Continuar e faz login manual na página Google transmitida pelo viewer. Senha/MFA/challenge permanecem nesse viewer; não serão solicitados no chat. O primeiro teste requer conta humana, A e B com identidades diferentes. Ainda não houve login autenticado ou gravação real; os critérios abaixo continuam sem aprovação real.

Evidências desta retomada: `/root/vorix-homolog/customer-managed-20261014/evidence/real-google/`: `migrations-preflight.log`, `runtime-preflight.log`, `infra-preflight.log`, `google-login-readiness.json` e `admin-ui-preflight.json`. Não há snapshots de cookies/storageState ou credenciais nessas evidências. O preflight inicial não exigiu correção; a tentativa de compatibilidade após recusa está documentada acima.

## Bloqueio histórico resolvido com autorização

O fluxo oficial `npm run db:migrate` foi executado em container Linux, na rede de homologação, contra `vorix_homolog`. A `0147` já estava aplicada e foi aceita pelo runner. A `0148` falhou ao adicionar `recorder_accounts_workspace_tenant_fk`; sua transação foi revertida. Migrations já aplicadas e seus checksums não foram alterados.

Na verificação inicial não havia reuniões nem execuções de gravação; as consultas de duplicação de gravações ativas retornaram zero linhas. Foi encontrada uma conta removida e uma sessão cancelada que referenciavam um workspace apagado:

| Campo | Valor |
| --- | --- |
| recorderAccountId | `rec-acc-mv8et2he-gxmax9` |
| meetingId | ausente / NULL |
| recordingId | ausente / NULL |
| status | `disabled` |
| removedAt | `2026-10-14T17:54:38.129263Z` |
| tenantId | `tenant-homolog-prov` |
| workspaceId restaurado como arquivado | `ws-prov-mv8et2f1` |
| provisioningSessionId | `rprov-mv8et2hx-ormxrv` |
| provisioningStatus | `cancelled` |

O usuário autorizou restaurar somente o workspace histórico como arquivado, no mesmo tenant. O plano [meetings-homolog-data-repair-plan.sql](meetings-homolog-data-repair-plan.sql) foi executado; conta removida e sessão cancelada foram preservadas sem alterações. Em seguida, `npm run db:migrate` aplicou a `0148` com sucesso; a segunda execução respondeu “Nada a aplicar — schema já está em dia”. A `0147` permaneceu aplicada e com checksum aceito. Nenhuma migration já aplicada foi alterada.

## Ambiente e preparação

- Ubuntu 24.04.5 LTS no WSL2, kernel `6.6.114.1-microsoft-standard-WSL2`.
- Docker local; PostgreSQL 16.15 no container `vorix-homolog-pg`, banco `vorix_homolog`, rede `vorix-homolog`.
- Recorder anterior preservado e parado em `vorix-recorder-before-0148-20261014`, para rollback; nenhum dado apagado.
- Recorders iniciais: `vorix-recorder-1` e `vorix-recorder-2`, com imagem `vorix-meetings-recorder:customer-managed-0148`, aprovados no preflight. A imagem posterior com Chrome oficial está documentada na tentativa de compatibilidade.
- API `vorix-homolog-api`, healthy, em `http://localhost:3000`; `/health` retorna HTTP 200 inclusive pelo Windows.
- Frontend `vorix-homolog-web`, imagem `vorix-meetings-web:customer-managed-0148`, em `http://localhost:3001`; página `/login` retorna HTTP 200 pelo Windows.
- Processamento `vorix-homolog-meetings-processing`, imagem `vorix-meetings-processing:customer-managed-0148`, executando `transcribe,analyze`; faster-whisper importado com sucesso no ambiente Python Linux. Modelo `base`, CPU/int8, baixado e carregado no cache persistente `/root/vorix-homolog/customer-managed-20261014/whisper-cache`. Isso não aprova a transcrição de uma gravação real, que ainda não ocorreu.
- Código de homologação em `/root/vorix-homolog/customer-managed-20261014/source`.
- Storage persistente em `/root/vorix-homolog/customer-managed-20261014/storage`, fora de diretórios temporários, montado em `/data/objects` na API, nos dois recorders e no processamento. Conteúdo anterior preservado. Um marcador de diagnóstico escrito pela API foi lido pelos dois recorders e removido ao final; nenhum arquivo de gravação foi fabricado.
- Configuração de banco/JWT herdada do recorder de homologação, em arquivo protegido fora do repositório. Nenhum segredo foi incluído neste relatório.
- Endpoints internos configurados: `ws://vorix-recorder-1:7088` e `ws://vorix-recorder-2:7088`. Nenhuma porta dos recorders está publicada. A API alcança os dois endpoints pela rede Docker; o cliente usa exclusivamente o relay autenticado da API. Uma tentativa sem autenticação válida foi recusada com código WebSocket 4401.
- Banco e JWT compartilhados foram verificados por comparação em memória, sem imprimir os segredos.
- Preparados [compose de homologação](../docker/meetings-homolog.compose.yml) e [imagem de processamento](../docker/meetings-homolog-processing.Dockerfile). Como o plugin Compose não está instalado no WSL, os serviços foram iniciados com comandos Docker equivalentes; nenhum serviço de produção foi usado.
- Chromium 155, Xvfb, PulseAudio, ffmpeg e ffprobe 5.1.9 confirmados. Um probe com Chromium visível no Xvfb e sink exclusivo validou PID positivo via CDP; browser, display e sink do probe foram encerrados. O probe não fez login Google nem produziu gravação.

O usuário confirmou que os e-mails iniciais eram exemplos e depois pediu concluir esta etapa exclusivamente com fixtures, sem fornecer e-mails reais nem fazer cadastro manual. A validação estrutural foi concluída em banco separado de fixtures, e um administrador Vorix fictício foi criado automaticamente no ambiente principal com concessão interna de Meetings e plano 2. Nenhuma conta Google foi criada ou conectada; não houve login/MFA Google real nem captura. Não são necessários e-mails reais ou novas ações do usuário para a etapa estrutural.

## Bug encontrado e correção isolada

Uma verificação no Chromium real mostrou `typeof browser.process === "undefined"`. Portanto, a implementação anterior não preenchia `browserPid`. `SystemInfo.getProcessInfo`, pelo CDP do Playwright, retornou um PID de browser inteiro e positivo.

A correção passa a obter esse PID pelo CDP, fecha a sessão CDP e valida o valor antes de registrar os processos. Commit separado: **`a3359d4b71ceff37aa4230605edbba89bf06de90`**, `fix(meetings-recorder): record Chromium PID through Playwright CDP`. O commit contém somente o arquivo do runtime do recorder; não inclui as alterações anteriores de arquitetura. Nenhum commit anterior foi reescrito.

O teste abriu e fechou Chromium sem autenticação. Isso comprova a disponibilidade do browser/CDP e o problema de PID; **não comprova login Google, gravação, áudio, player ou transcrição de um Meet**.

## Gates desta rodada, executados no Linux

| Gate | Resultado |
| --- | --- |
| Backend typecheck | PASS |
| Backend build | PASS |
| architecture:check | PASS; 49 contratos e verificações de isolamento |
| test:meetings | PASS; 71 aprovados, zero falhas, um teste PostgreSQL externo omitido |
| Frontend typecheck | PASS |
| Frontend tests | PASS; 87 aprovados em 12 arquivos |
| Frontend build | PASS; imagem Docker construída |

Os testes automatizados e o teste PostgreSQL da rodada anterior não foram usados como prova de Google Meet real. A primeira tentativa do gate de arquitetura desta rodada falhou porque o container de validação não tinha os arquivos `web/`; a configuração de montagem foi corrigida e o gate completo foi repetido com sucesso. Essa falha de montagem não foi omitida nem tratada como PASS.

Evidências locais protegidas: `/root/vorix-homolog/customer-managed-20261014/evidence/`, incluindo o primeiro erro preservado em `migrations-first.log`, os sucessos em `migrations-approved-first.log` e `migrations-approved-second.log`, `approved-workspace-repair.log`, `shared-infra.json`, `headed-runtime-probe.log`, `unauthenticated-relay.log`, `backend-gates.log`, `frontend-gates.log`, `recorder-build.log`, `web-build.log` e `processing-build.log`.

## Relatório de aceitação solicitado

**Convenção:** nos critérios abaixo, `FAIL (NOT_TESTED)` significa que o critério não pode ser aprovado porque não foi executado. Não significa que um teste Google executado falhou. `NOT_MEASURED` evita inventar capacidade ou consumo. Nenhum critério REAL recebe PASS sem evidência real.

```text
MIGRATIONS_0147_0148 = PASS
TEST_STORAGE_PATH = /root/vorix-homolog/customer-managed-20261014/storage
RECORDER_CONTAINER_RUNTIME = PASS
SELF_SERVICE_ACCOUNT_A = FAIL (GOOGLE_BROWSER_REJECTED; nova tentativa de compatibilidade pendente)
SELF_SERVICE_ACCOUNT_B = FAIL (NOT_TESTED)
PASSWORD_NEVER_STORED_REAL = FAIL (NOT_TESTED: não houve login Google)
PROVISIONING_TENANT_ISOLATION_REAL = FAIL (NOT_TESTED)
PROVISIONING_REPLAY_PROTECTION_REAL = FAIL (NOT_TESTED)
PROVISIONING_ABANDONMENT = FAIL (NOT_TESTED)
REAUTH_REQUIRED_REAL = FAIL (NOT_TESTED)
SELF_SERVICE_RECONNECT = FAIL (NOT_TESTED)
SESSION_HEALTH_CHECK_REAL = FAIL (NOT_TESTED)
PLAN_CAPACITY = 2
TENANT_HEALTHY_CAPACITY = 0 (ambiente principal, nenhuma conta Google conectada)
TENANT_AVAILABLE_CAPACITY = 0 (ambiente principal, nenhuma conta Google conectada)
REAL_BOT_LOGIN = FAIL (GOOGLE_BROWSER_REJECTED; não houve login autenticado)
JOIN_GOOGLE_MEET = FAIL (NOT_TESTED)
WAITING_ADMISSION = FAIL (NOT_TESTED)
REAL_VIDEO_CAPTURE = FAIL (NOT_TESTED)
REAL_AUDIO_CAPTURE = FAIL (NOT_TESTED)
AUDIO_NON_SILENT = NO (NOT_TESTED)
REAL_FRAME_VALIDATED = NO (NOT_TESTED)
FFPROBE_VIDEO = FAIL (NOT_TESTED)
FFPROBE_AUDIO = FAIL (NOT_TESTED)
PLAYER_REAL_RECORDING = FAIL (NOT_TESTED)
REAL_TRANSCRIPTION_FROM_CAPTURE = FAIL (NOT_TESTED)
TRANSCRIPT_PROOF_PHRASE = FAIL (NOT_TESTED)
AI_FROM_CAPTURED_TRANSCRIPT = FAIL (NOT_TESTED)
AI_PROVIDER = NOT_TESTED
REAL_RECORDING = FAIL (NOT_TESTED)
IDENTITY_CONFLICT_REAL = FAIL (NOT_TESTED)
ALTERNATIVE_RECORDER_AUTO_SELECTION_REAL = FAIL (NOT_TESTED)
IDENTITY_CONFLICT_NO_ALTERNATIVE_REAL = FAIL (NOT_TESTED)
INFERRED_IDENTITY_NO_FALSE_BLOCK = FAIL (NOT_TESTED)
EXPLICIT_IDENTITY_PRECEDENCE_REAL = FAIL (NOT_TESTED)
CONCURRENT_RECORDINGS = FAIL (NOT_TESTED)
TWO_RECORDERS_NO_COLLISION = FAIL (NOT_TESTED)
TRANSCRIPTS_NO_AUDIO_CROSSOVER = FAIL (NOT_TESTED)
PLAN_CONCURRENCY_LIMIT_REAL = FAIL (NOT_TESTED)
NO_RECORDER_ACCOUNT_AVAILABLE_REAL = FAIL (NOT_TESTED)
ADMISSION_TIMEOUT = FAIL (NOT_TESTED)
INVALID_MEET = FAIL (NOT_TESTED)
FFMPEG_FAILURE_RECOVERY = FAIL (NOT_TESTED)
CHROMIUM_FAILURE_RECOVERY = FAIL (NOT_TESTED)
API_RESTART_DURING_RECORDING = FAIL (NOT_TESTED)
PROCESS_CLEANUP = FAIL (NOT_TESTED: cenários de gravação real não iniciados)
RESOURCE_MEASUREMENT_ONE_RECORDING = FAIL (NOT_TESTED)
RESOURCE_MEASUREMENT_TWO_RECORDINGS = FAIL (NOT_TESTED)
RESOURCE_PER_RECORDING_APPROX = NOT_MEASURED
SELF_SERVICE_PROVISIONING = PARTIAL (fluxo chegou ao Google; login recusado)
CLI_ONLY_REQUIRED_FOR_CUSTOMER = NO (fluxo implementado; ainda sem homologação real)
CUSTOMER_DEPENDS_ON_VORIX_OPERATOR = NO (fluxo implementado; ainda sem homologação real)
COMMERCIAL_OBJECT_STORAGE = PENDING
BUILD = PASS
TYPECHECK = PASS
TESTS = PASS
PUBLIC = NO
CONTRACTABLE = NO
READY_FOR_RELEASE_ROUND = NO
NEW_FIX_COMMIT_SHA = 4e7f7d94cdcef18a7c16524789486581c3da0c53
REMAINING_BLOCKERS = Google recusou o navegador no primeiro login real;
                    validar compatibilidade e login/MFA/health check real, Meets controlados,
                    captura/player/transcrição e simultaneidade reais.
```

Bloqueio de dados resolvido; estrutura concluída e homologação real autorizada. A primeira tentativa de login foi recusada pelo Google; os testes dependentes de autenticação permanecem pendentes. Nenhuma liberação comercial foi realizada.
