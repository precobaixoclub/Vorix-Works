# Relatório técnico — Developer Assisted Mode

Implementação de um modo oficial de geração de imagem para o Pedro que não depende de nenhum provider externo de IA e não finge que existe geração nativa de imagem no Claude Code (confirmado tecnicamente que não existe). Também remove por completo o código inseguro encontrado no início desta sessão (`child_process.spawn` condicionado a variável de ambiente, com fallback oculto de PNG 1×1 fake).

## Como funciona o Developer Assisted Mode

No `LOCAL_PRODUCTION`, este é o caminho oficial para artefatos visuais. Pedro usa Developer Assisted Mode para imagens e Rafa usa o mesmo conceito para vídeo: o Zuno monta prompt técnico e caminho esperado, pausa em `WAITING_ASSISTED_GENERATION`, a IA desenvolvedora salva o arquivo real localmente e o usuário retoma com `npm run zuno -- --mode local-production --continue <executionId>`. Nenhum provider externo é chamado para pixels/frames, nenhum upload é feito e nenhum arquivo local é tratado como URL pública.

Quando Pedro está configurado com `imageGenerationMode: "developer_assisted"` (o padrão da CLI local, `src/interfaces/cli/run-command.ts`):

1. Pedro monta o mesmo `finalPrompt` rico de sempre (`buildFinalImagePrompt` — nenhuma mudança, mesma qualidade de prompt do modo `ai_provider`) a partir do briefing da Bianca e da identidade visual da Clara.
2. Para cada imagem esperada, calcula o caminho relativo (`images/slide-01.png`, `images/slide-02.png`, ...) e a resolução alvo, e verifica via `ArtifactDeliveryPort.readFile` se o arquivo já existe em disco — **nunca** por `child_process`, nunca por execução de comando externo.
3. Se todas as imagens esperadas já existirem e forem PNGs reais e plausíveis, Pedro continua normalmente: cria os artefatos, gera `index.html`, `caption.txt`, `metadata.json` e `carousel.zip` (quando houver carrossel) — exatamente o mesmo pipeline do modo `ai_provider`.
4. Se qualquer imagem ainda não existir (ou existir mas for inválida), Pedro devolve o novo status de domínio `needs_assisted_generation` com o prompt técnico completo, o caminho exato esperado e um comando de retomada. Caio interpreta isso como uma pausa (`WAITING_ASSISTED_GENERATION`), não uma falha — a CLI imprime a instrução no terminal e o workflow fica salvo em disco até ser retomado.

## Como a IA desenvolvedora deve salvar as imagens

A CLI imprime, para cada imagem pendente: o caminho exato (`artifacts/<executionId>/images/slide-NN.png`), a resolução exata esperada (ex.: `1080x1350`) e o prompt técnico completo (briefing da Bianca, identidade visual da marca, textos autorizados, padrão de qualidade obrigatório e restrições negativas). A IA desenvolvedora (quem estiver operando o Claude Code na sessão) deve criar a imagem seguindo esse prompt e salvar **em PNG real**, exatamente nesse caminho e nessa resolução — usando a ferramenta de escrita de arquivo já disponível (`Write`), sem nenhuma integração adicional.

Validação aplicada por Pedro ao encontrar o arquivo (sem nenhuma dependência externa, parsing manual dos bytes do PNG):
- assinatura de arquivo PNG correta (8 bytes fixos);
- chunk `IHDR` presente logo após a assinatura;
- largura/altura lidas diretamente dos bytes do `IHDR`, precisando bater exatamente com a resolução pedida;
- dimensão mínima de 64×64 — rejeita explicitamente qualquer placeholder trivial (como um PNG 1×1 transparente).

Se a validação falhar, Pedro trata como "ainda não pronto" (mesmo status `needs_assisted_generation`, com aviso explicando o motivo) em vez de aceitar o arquivo como se fosse a imagem real.

## Como continuar o workflow depois que a imagem for salva

```bash
npm run zuno -- --continue <executionId>
```

Isso chama `Caio.resumeAssistedGeneration(executionId)`, que reexecuta a mesma etapa (Pedro) do zero — sem receber nenhuma decisão, diferente de `--approve`/`--reject`. Pedro verifica de novo se o(s) arquivo(s) existem e são válidos:
- se sim, o workflow continua normalmente para a etapa seguinte (Revisão/Lucas, depois aprovação humana, depois publicação);
- se não (arquivo ainda ausente ou inválido), o workflow pausa de novo com a mesma instrução — retomar é sempre seguro e pode ser repetido quantas vezes forem necessárias.

O relatório final sempre deixa explícito que a imagem veio de intervenção assistida: `PedroImageGenerationOutput.generationMode === "developer_assisted"` e `providerUsed === "developer-assisted"` (em oposição a `"fake-icaro-provider"`, usado só em testes automatizados, ou o id de um provider real, caso algum exista no futuro). O HTML de entrega inclui esse provider no resumo técnico da execução.

## O que foi removido (achado de segurança desta sessão)

No início desta sessão, uma edição de documentação (`src/interfaces/cli/README.md`) apareceu descrevendo um mecanismo que eu não havia escrito. Investigando, encontrei código real implementando esse mecanismo, também não escrito por mim:

- `src/infrastructure/ai/native-developer-image-generator.ts` — implementava `CommandNativeDeveloperImageGenerator`, que executava `child_process.spawn(command, { shell: true })` com o comando lido de `process.env.ZUNO_NATIVE_IMAGE_GENERATOR_COMMAND`.
- `src/infrastructure/ai/deterministic-fake-icaro-provider.ts` — havia sido modificado para tentar esse mecanismo antes de cair num **fallback oculto que devolvia um PNG estático de 1×1 pixel transparente**, disfarçado de "imagem gerada" via `warnings` genéricos.
- `tests/native-image-integration.test.mjs` e a entrada correspondente em `package.json` — testavam esse mecanismo.

Isso representava uma superfície de execução de comando arbitrário (mesmo que inerte por padrão, já que a variável nunca era definida em nenhum lugar do projeto) e violava a regra de nunca apresentar um fake como imagem real. Removido por completo nesta sessão e substituído pelo Developer Assisted Mode, que não executa nenhum comando externo — apenas lê arquivos que já existem em disco via `ArtifactDeliveryPort`.

## Arquivos criados

- `docs/developer-assisted-mode-report.md` — este relatório.

## Arquivos removidos

- `src/infrastructure/ai/native-developer-image-generator.ts` — mecanismo inseguro de `child_process.spawn`.
- `tests/native-image-integration.test.mjs` — testava exclusivamente o mecanismo removido.

## Arquivos alterados

**Contratos de domínio/aplicação:**
- `src/domain/skills/skill.contract.ts` — novo status `needs_assisted_generation` em `SkillResponse`.
- `src/application/ports/artifact-delivery.port.ts` — novo método `readFile` (leitura, sem criar nada).
- `src/application/events/zuno-event.contract.ts` — novo evento `ImageGenerationAwaitingAssistedInput`.

**Workflows (Caio):**
- `src/application/workflows/caio.types.ts` — novo estado `WAITING_ASSISTED_GENERATION`.
- `src/application/workflows/caio.contract.ts` — novo método `resumeAssistedGeneration`.
- `src/application/workflows/caio-log.contract.ts` — nova ação de log `StepWaitingAssistedGeneration`.
- `src/application/workflows/caio.executor.ts` — pausa em `needs_assisted_generation` (análogo a `human_gate`) e implementação de `resumeAssistedGeneration`.

**Infraestrutura:**
- `src/infrastructure/artifacts/local-artifact-delivery.ts` — implementação de `readFile`.
- `src/infrastructure/ai/deterministic-fake-icaro-provider.ts` — revertido para fake puro, sem o mecanismo inseguro removido.
- `src/infrastructure/ai/index.ts` — removida a exportação do módulo excluído.

**Skill (Pedro):**
- `src/skills/pedro-image-generation/pedro-image-generation.types.ts` — `PedroImageGenerationMode`, `PedroAssistedImageRequest`, `PedroAssistedGenerationOutput`, campo `generationMode` no output completo.
- `src/skills/pedro-image-generation/pedro-image-generation.skill.ts` — `imageGenerationMode` na configuração; `runAssistedGeneration` (novo); `finalizeGeneration` (extraído, comum aos dois modos); validador de PNG sem dependências (`validatePngBytes`); construtores de prompt/caminho/comando de retomada para o modo assistido.
- `src/skills/pedro-image-generation/pedro-log.contract.ts` — ações `AssistedGenerationRequested`, `AssistedImageValidationFailed`, `AssistedImageAccepted`.
- `src/skills/pedro-image-generation/pedro.manifest.ts` e `skill.manifest.json` — descrição, outputs e responsabilidades atualizados para os dois modos.

**CLI:**
- `src/interfaces/cli/run-command.ts` — `imageGenerationMode: "developer_assisted"` no runtime; nova função `continueZunoExecution`.
- `src/interfaces/cli/index.ts` — flag `--continue`; impressão das instruções de geração assistida (prompt, caminho, resolução, comando de retomada).

**Documentação:**
- `src/infrastructure/ai/README.md` — reescrito: três origens de imagem (fake/teste, provider real ainda inexistente, developer_assisted), histórico do código removido.
- `src/interfaces/cli/README.md` — seção completa "Developer Assisted Mode" com o fluxo de uso.
- `docs/pedro-image-generation.md` — seção "Developer Assisted Mode" documentando `runAssistedGeneration`, validação de PNG e diferenciação no relatório.
- `docs/caio-workflow-executor.md` — seções sobre a pausa por geração assistida e `resumeAssistedGeneration`.
- `README.md` (raiz) — descrição de Pedro atualizada para citar os dois modos.

**Build/testes:**
- `package.json` — removida a referência ao arquivo de teste excluído.
- `tests/pedro-image-generation.test.mjs` — encoder PNG mínimo (só `node:zlib`) + 7 testes novos do modo assistido.
- `tests/caio.workflow-executor.test.mjs` — 4 testes novos de pausa/retomada.
- `tests/cli.smoke.test.mjs` — reescrito para o novo fluxo padrão (Developer Assisted Mode antes da aprovação humana) + 1 teste novo de retomada prematura.

## Testes criados

**Pedro (`tests/pedro-image-generation.test.mjs`, 7 novos):**
- `needs_assisted_generation` com prompt técnico e caminho esperado quando a imagem não existe, sem chamar o Ícaro.
- Rejeição de PNG de resolução implausível (placeholder tipo 1×1) — continua aguardando, log `AssistedImageValidationFailed`.
- Rejeição de PNG com resolução diferente da esperada — continua aguardando.
- Conclusão normal quando a imagem real já existe em disco, com `generationMode`/`providerUsed` corretos e HTML citando `developer-assisted`.
- Erro estruturado dedicado (`ASSISTED_MODE_REQUIRES_ARTIFACT_DELIVERY`) quando o modo assistido é usado sem `ArtifactDeliveryPort`.
- Confirmação estática de que o arquivo da Skill não importa `child_process`, não usa `spawn(`/`execSync(` e não referencia a variável de ambiente removida.

**Caio (`tests/caio.workflow-executor.test.mjs`, 4 novos):**
- Pausa em `WAITING_ASSISTED_GENERATION` sem executar etapas posteriores, com log e evento (`reason: "assisted_generation"`).
- `resumeAssistedGeneration` reexecuta a etapa e completa o workflow quando a Skill agora completa.
- `resumeAssistedGeneration` pausa de novo com a mesma etapa quando o artefato ainda não existe (retomada idempotente).
- `resumeAssistedGeneration` rejeita execução inexistente e workflow que não está aguardando geração assistida (incluindo o caso de estar aguardando aprovação humana em vez disso).

**CLI (`tests/cli.smoke.test.mjs`, reescrito):**
- Fluxo completo real via processo filho: comando → `WAITING_ASSISTED_GENERATION` → escreve um PNG real gerado só com `node:zlib` no caminho impresso pela CLI → `--continue` → `WAITING_HUMAN_APPROVAL` → `--approve` → `COMPLETED`, com o HTML final conferido (`developer-assisted` presente).
- `--continue` antes do arquivo existir pausa de novo com a mesma instrução.
- Usage (`--help`) menciona `--continue`.

## Resultado de typecheck, test e architecture:check

- `npx tsc --noEmit` — sem erros.
- `npm test` — **253/253 testes passando**. Partindo de 242 no início desta sessão: +6 testes novos em Pedro, +4 em Caio, +1 em CLI (5 no total do arquivo, era 4) = 253. Os 3 testes de `tests/native-image-integration.test.mjs` (mecanismo inseguro, adicionado fora desta sessão) foram removidos junto com o arquivo.
- `npm run architecture:check` — build completo + descoberta real das sete Skills em `dist/skills`, cada capability resolvendo para a Skill correta.
- **Validação manual end-to-end** (fora dos testes automatizados, simulando exatamente o papel da IA desenvolvedora): rodei a CLI de verdade, recebi a instrução no terminal, escrevi um PNG real e válido (1080×1350, cor de marca `#C97F91`) no caminho exato impresso, rodei `--continue` e confirmei que o workflow avançou para `WAITING_HUMAN_APPROVAL`, aprovei e confirmei no `index.html` final a presença de `developer-assisted` e da imagem real de 7.350 bytes.

## Limitações atuais

- O modo `developer_assisted` depende inteiramente de um humano ou da IA desenvolvedora estar presente na sessão para criar o arquivo — não há geração automática nesta fase (por design, dado que não existe provider real configurado nem geração nativa disponível).
- A validação de PNG lê largura/altura do `IHDR`, mas não decodifica nem inspeciona o conteúdo visual da imagem — não há verificação de qualidade estética, apenas de que é um PNG real, com a resolução certa e não trivialmente pequeno.
- `resolutionForAspectRatio` só mapeia proporções conhecidas (`1:1`, `4:5`, `9:16`, `16:9`); uma proporção fora dessa lista cai no fallback `1080x1080` tanto no modo assistido quanto no `ai_provider` — comportamento inalterado por esta sessão, não é uma limitação nova.
- Carrosséis em modo assistido exigem que a IA desenvolvedora salve **todas** as imagens esperadas antes de `--continue` completar — não há conclusão parcial (o mesmo padrão de "tudo ou nada" que Pedro já aplicava para o modo `ai_provider`).

## Próximos passos (fora do escopo desta sessão)

- Se o usuário decidir integrar um provider real de IA de imagem no futuro, o modo `ai_provider` já está pronto para recebê-lo — só falta a implementação concreta de `AIProviderPort` (`kind: "image"`).
- Considerar um comando de conveniência que abra o diretório de imagens esperado automaticamente (ex.: `--open-assisted-folder <executionId>`), se isso vier a ser um passo repetitivo no uso real.
- Considerar validação de conteúdo perceptual (ex.: detectar imagem majoritariamente vazia/monocromática) como sinal adicional de que a IA desenvolvedora esqueceu de desenhar algo — hoje só a resolução é validada.
