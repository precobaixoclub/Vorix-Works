# Relatório técnico — Developer Assisted Mode para texto, estratégia, análise e direção criativa

## 1. Objetivo

Em `LOCAL_PRODUCTION`, João, Maria, Sofia, Bianca, Bruno, Vanessa, Diego e Lucas deixam de receber
conteúdo determinístico do `DeterministicFakeIcaroProvider` silenciosamente. Passam a ser apoiados
pela IA desenvolvedora real do VS Code, através do mesmo mecanismo de integração por arquivo +
pausa/retomada de workflow já usado pelo Developer Assisted Mode de imagem (Pedro) e vídeo (Rafa).
Nenhum provider externo (OpenAI/Gemini/Claude API) foi integrado — a IA desenvolvedora É o Claude
Code rodando no VS Code do usuário, lendo prompts e escrevendo respostas em arquivo.

## 2. Arquivos criados

| Arquivo | Papel |
|---|---|
| `src/application/ai/developer-assistance.types.ts` | `DeveloperAssistanceWorkPackage`, `DeveloperAssistanceFieldSchema`, `DeveloperAssistancePendingOutput` e a classe `DeveloperAssistancePendingError` — o contrato central do mecanismo. |
| `src/shared/utils/developer-ai-assistance.ts` | `isDeveloperAssistancePending()` e `buildDeveloperAiPendingResponse()` — helper puro reutilizado pelas 8 Skills (não é uma Skill, ADR 0002 permite). |
| `src/infrastructure/ai/developer-assisted-icaro-provider.ts` | `DeveloperAssistedIcaroProvider implements IcaroBrainPort` — escreve o pacote de trabalho, lê/valida a resposta, devolve `IcaroAIResponse` real ou lança `DeveloperAssistancePendingError`. |
| `tests/developer-assisted-icaro-provider.test.mjs` | 10 testes unitários do provider (isolado, sem CLI). |
| `tests/developer-ai-assistance.test.mjs` | 10 testes de ponta a ponta (Arthur → Caio → Helena → Skills, em processo). |
| `docs/developer-ai-text-assistance-report.md` | Este relatório. |

## 3. Arquivos alterados

**Estado do workflow (genérico, sem conhecer nenhuma Skill):**
- `src/domain/skills/skill.contract.ts` — novo `SkillResponse.status: "needs_developer_ai"`.
- `src/application/workflows/caio.types.ts` — novo `WorkflowExecutionState: "WAITING_DEVELOPER_AI"`.
- `src/application/workflows/caio-log.contract.ts` — nova ação de log `StepWaitingDeveloperAI`.
- `src/application/workflows/caio.contract.ts` — novo método `resumeDeveloperAI(executionId)`.
- `src/application/workflows/caio.executor.ts` — branch de pausa em `executeSkillStep` + implementação de `resumeDeveloperAI` (mecanicamente idêntica a `resumeAssistedGeneration`, mantida separada para estado explícito e distinguível).

**CLI:**
- `src/interfaces/cli/run-command.ts` — `resolveIcaroMode()` (allowlist `ZUNO_ICARO_MODE`), `DeveloperAssistedIcaroProvider` como padrão de produção, `continueZunoExecution` roteando para `resumeDeveloperAI` ou `resumeAssistedGeneration` conforme o estado persistido.
- `src/interfaces/cli/index.ts` — `printDeveloperAiInstructions()`, novo bloco no `printReport`, texto de uso atualizado.
- `src/infrastructure/ai/index.ts` — export do novo provider.

**As 8 Skills (import do helper, tipo de saída ampliado com `DeveloperAssistancePendingOutput`, captura de `DeveloperAssistancePendingError` no ponto de chamada do Ícaro, campo `aiProviderId` adicionado ao lado de `aiSupportUsed`):**
`joao-marketing-strategy` (`.skill.ts`+`.types.ts`), `maria-copywriting` (idem), `sofia-art-direction` (idem), `bianca-social-media-design` (idem), `bruno-video-script` (idem), `vanessa-video-direction` (idem), `diego-video-editing` (idem), `lucas-quality-review` (idem).

**Testes existentes:**
- `tests/cli.smoke.test.mjs` — `withTempCliEnv` fixa `ZUNO_ICARO_MODE=fake` (suíte testa fluxos gerais da CLI, não o conteúdo de texto).
- `package.json` — `content-format-classification.test.mjs` (que faltava do trabalho anterior), `developer-assisted-icaro-provider.test.mjs` e `developer-ai-assistance.test.mjs` adicionados ao script `test`.

**Preservado sem alteração:** Arthur, Helena, `IcaroBrainPort`, Developer Assisted Mode de imagem (Pedro) e vídeo (Rafa), isolamento entre Skills, Eduardo (fora da lista explícita — continua com o comportamento anterior: se não responder a tempo, degrada para heurística, sem pausar).

## 4. Novo estado de workflow

```
WORKFLOW_EXECUTION_STATES = [..., "WAITING_ASSISTED_GENERATION", "WAITING_DEVELOPER_AI", ...]
SkillResponse.status = "needs_developer_ai"
```

Mecanicamente idêntico a `WAITING_ASSISTED_GENERATION` (mesmo padrão de pausa/retomada), mas
semanticamente distinto: nenhum artefato binário está envolvido, só texto/JSON. `resumeDeveloperAI`
apenas volta a etapa para `PENDING` e reexecuta — a própria Skill decide, ao rechamar o Ícaro, se já
pode completar.

## 5. Formato do pacote de trabalho

Escrito em `artifacts/<executionId>/icaro/<taskId>-<specialistId>.package.json`:

```json
{
  "executionId": "...", "stepId": "...", "taskId": "...",
  "specialistId": "joao-marketing-strategy",
  "taskType": "analysis",
  "prompt": "<prompt completo que a própria Skill já constrói — inclui contexto de marca, briefing anterior e o FORMATO OBRIGATÓRIO DO JSON>",
  "context": { "clientId": "...", "channel": "..." },
  "constraints": ["Retornar apenas JSON válido.", "..."],
  "responseSchema": [ { "field": "angle", "type": "string", "required": false, "description": "..." }, ... ],
  "workPackagePath": "icaro/step-0003-joao-marketing-strategy.package.json",
  "expectedResponsePath": "icaro/step-0003-joao-marketing-strategy.response.json",
  "instruction": "Produza a resposta real desta tarefa...",
  "resumeCommand": "npm run zuno -- --continue <executionId>",
  "createdAt": "...",
  "validationErrors": ["presente só quando a tentativa anterior foi rejeitada"]
}
```

`responseSchema` é um registro por especialista (`SPECIALIST_SCHEMAS` em
`developer-assisted-icaro-provider.ts`) derivado dos tipos `XEnhancement`/`MariaStructuredCopy` que
cada Skill já declara — não é JSON Schema formal, é a mesma convenção textual campo→tipo→obrigatório
já usada nos comentários do projeto. Especialistas fora do registro (qualquer Skill futura que use
`IcaroBrainPort`) caem num fallback genérico: qualquer objeto JSON não vazio com pelo menos um
campo de conteúdo real é aceito — a extensibilidade pedida ("qualquer futura Skill") não exige
alterar o provider.

## 6. Como a IA desenvolvedora deve responder

1. Ler `icaro/<taskId>-<specialistId>.package.json`.
2. Escrever um JSON em `icaro/<taskId>-<specialistId>.response.json` seguindo `responseSchema`
   (campos extras são ignorados, campos ausentes ficam `undefined` — cada Skill já tolera isso).
3. Rodar `npm run zuno -- --continue <executionId>`.

Validação mínima e deliberadamente permissiva em `validateStructuredResponse()`: JSON precisa ser
um objeto não vazio; quando há schema conhecido, precisa preencher todo campo `required: true` (só
a Maria tem — `title`/`caption`) e pelo menos um campo reconhecido do schema. Nunca mais rígido do
que a própria Skill solicitante. Resposta inválida não falha o workflow: gera um novo pacote com
`validationErrors` populado e o workflow permanece em `WAITING_DEVELOPER_AI` (retomada idempotente).

## 7. Como funciona `--continue`

Sem mudança de UX — o mesmo comando já usado para imagem/vídeo. Internamente,
`continueZunoExecution` lê o `state` persistido e chama `caio.resumeDeveloperAI()` (texto) ou
`caio.resumeAssistedGeneration()` (imagem/vídeo). Ambos reexecutam a mesma etapa; a Skill
rechama `IcaroBrainPort.request()`, o provider relê o arquivo de resposta e decide completar ou
pausar de novo.

## 8. Origem do conteúdo no relatório final

Cada uma das 8 Skills agora grava `output.aiProviderId` (`"developer-ai-assisted"` quando a IA
desenvolvedora respondeu, `"fake-icaro-provider"` só quando `ZUNO_ICARO_MODE=fake` está definido
explicitamente, `undefined` quando não houve apoio de IA). `ZUNO_ICARO_MODE` segue a mesma allowlist
estrita de `ZUNO_VIDEO_RENDER_MODE`, mas com padrão invertido: `"developer_assisted"` é o padrão real
de produção; `"fake"` só é usado quando definido explicitamente (testes/demonstração).

## 9. Testes criados (20 novos, 555 no total)

`tests/developer-assisted-icaro-provider.test.mjs` (10): pacote gerado + erro de pausa na 1ª
chamada; pacote contém prompt/contexto/schema; resposta válida completa com
`provider.id: "developer-ai-assisted"`; JSON inválido rejeitado; campo obrigatório da Maria
ausente rejeitado; objeto vazio rejeitado; resposta de outra `executionId` não é aceita (isolamento);
4 temas geram pacotes/prompts distintos; especialista desconhecido (Skill futura) funciona;
`executionId`/`taskId` ausentes falham alto (config, não pausa).

`tests/developer-ai-assistance.test.mjs` (10, ponta a ponta): LOCAL_PRODUCTION não usa fake
silenciosamente; pausa exatamente em `WAITING_DEVELOPER_AI`; pacote de trabalho completo + retomada
válida; JSON inválido mantém pausa com erro explicado; retomar sem responder é idempotente; RSVP,
álbum, cronograma e taxa zero geram prompts distintos; `aiProviderId` aparece como
`developer-ai-assisted` no relatório final; modo fake só funciona com `ZUNO_ICARO_MODE=fake`
explícito; imagem assistida (Pedro) sem regressão combinada com texto; tema de Maria reflete o
pedido atual, não um tema anterior.

`npm run typecheck`, `npm test` (555/555) e `npm run architecture:check` — todos verdes.

## 10. Validação real (CLI real, sem mocks)

Executadas 4 campanhas completas via `node dist/interfaces/cli/index.js` contra os dados reais do
projeto (`.zuno-data`/`artifacts`), com a IA desenvolvedora (eu mesmo, nesta sessão) lendo cada
pacote de trabalho real e escrevendo respostas reais e distintas — sem nenhuma linha de código
alterada durante a validação:

| Tema | Execução | João (angle) | Maria (title) | Sofia (visualConcept) |
|---|---|---|---|---|
| Taxa zero | `...-mrgjk2nu-u126wp` | "O dinheiro do presente é sagrado..." | "Taxa zero: o presente chega inteiro" | "Envelope de presente... trilha de moedas Pix..." |
| RSVP | `...-mrgjohh4-1rxdea` | "O relógio do RSVP está correndo..." | "Já confirmou presença? ⏰" | "Convite clássico... campo confirmo presença..." |
| Álbum colaborativo | `...-mrgjs5ou-47dasz` | "As melhores fotos... não são as do fotógrafo..." | "As fotos que o fotógrafo não viu" | "Mosaico vivo de fotos de celular..." |
| Cronograma | `...-mrgjun1s-jwjsuk` | "O convidado que sabe o horário exato..." | "A que horas começa mesmo? 🕐" | "Linha do tempo horizontal... itinerário de viagem..." |

Todas as 4 execuções chegaram a `COMPLETED`, com imagem gerada (Developer Assisted Mode de imagem,
inalterado), revisão do Lucas e aprovação humana. Todos os passos de texto registraram
`aiProviderId: "developer-ai-assisted"`. Nenhum tema reaproveitou ângulo, copy ou conceito visual de
outro — confirma que cada peça mantém seu tema próprio até Maria e Sofia.

## 11. Limitações remanescentes

- **`npm run zuno -- "..."` mangla texto com espaços em alguns ambientes Windows** (transformados em
  `^`) — artefato do wrapper `npm.cmd`/`cmd.exe`, não do código do Zuno; `node dist/interfaces/cli/index.js "..."` direto não tem esse problema. Não é uma regressão desta feature.
- **Eduardo permanece fora deste mecanismo** (não estava na lista de Skills do pedido); se
  `this.icaro` lançar `DeveloperAssistancePendingError`, o catch genérico de Eduardo trata como
  falha comum de IA e degrada para heurística — não pausa. Comportamento seguro, mas assimétrico
  em relação às 8 Skills cobertas.
- **`responseSchema` não é exaustivo para Skills com muitos campos opcionais** (ex.: Bianca tem
  25+ campos em `BiancaDesignEnhancement`; o pacote documenta um subconjunto representativo). A
  validação aceita qualquer campo reconhecido preenchido, então isso não bloqueia respostas
  legítimas — só significa que a lista de campos no pacote não é 100% completa.
- **Maria pode gastar tentativas do seu loop de qualidade em respostas repetidas**: se a resposta
  da IA desenvolvedora não atingir a nota mínima de qualidade, Maria tenta de novo, mas o provider
  devolve o mesmo conteúdo já validado (arquivo já existe) — resulta em `deliveredBestEffort: true`
  sem nunca pausar de novo. Comportamento pré-existente do loop de qualidade da Maria, não alterado
  por esta feature.
- **`--list` não distingue o motivo da pausa** (aprovação humana, geração assistida ou IA
  desenvolvedora) — mostra só o `executionId`, igual já fazia antes desta feature.
