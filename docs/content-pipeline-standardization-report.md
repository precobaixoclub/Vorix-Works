# Relatório técnico — Padronização do fluxo de geração de conteúdo do Zuno

Data: 2026-07-07
Escopo: Arthur → Helena → Caio → João → Maria → Sofia → Bianca → Pedro → Lucas → Ana, mais o ponto de entrada da CLI.
Natureza do trabalho: padronização e conclusão de mecanismos já previstos na arquitetura — nenhuma capability, Skill ou fluxo de produto novo foi criado.

## Sumário executivo

O sintoma relatado ("resultado muda dependendo de como o prompt é escrito, ou de quem monta a execução") tinha uma causa raiz única e concreta: **o encadeamento entre Skills nunca foi implementado em produção**. Ele só existia manualmente dentro do teste `tests/organic-cycle.e2e.test.mjs`, com funções auxiliares reescrevendo à mão a saída de cada Skill para caber na entrada da próxima. Fora do teste, não havia nenhum ponto de entrada (`src/interfaces/cli|api|web` eram READMEs vazios) capaz de rodar Arthur → Caio → Helena → Skills a partir de um comando real. Isso significa que, até esta mudança, **sempre existiu um humano (ou um modelo de linguagem, como aconteceu nesta própria conversa antes desta tarefa) fazendo manualmente a ponte entre as Skills** — e cada execução manual podia divergir da anterior.

Esta rodada de trabalho corrigiu essa causa raiz dentro do próprio Caio (encadeamento automático, genérico, sem violar o isolamento entre Skills), completou os campos que Arthur nunca preenchia corretamente, fechou a lacuna de governança de marca entre João e Maria, elevou o rigor dos prompts internos ao mesmo padrão que o Pedro já tinha, padronizou a página HTML de entrega do Pedro na ordem pedida, e — com aprovação explícita do usuário — implementou um ponto de entrada real (`npm run zuno -- "..."`) para que o fluxo completo possa ser executado e verificado de ponta a ponta, não apenas presumido.

Todas as mudanças de contrato foram aditivas (campos novos opcionais), seguindo o mesmo padrão que o próprio projeto já usa (ver a evolução de `SkillArtifact` documentada em `docs/pedro-image-generation.md`). `npm run typecheck`, `npm test` (214/214) e `npm run architecture:check` passam limpos ao final; a CLI foi validada manualmente de ponta a ponta, incluindo a leitura do HTML final gerado.

---

## 1. Problemas encontrados

### 1.1 — Caio nunca encadeava a saída de uma etapa na entrada da próxima (raiz de tudo)
`src/application/workflows/caio.executor.ts`, método `executeSkillStep` (antes da correção): o `input` enviado para `helena.executeSkill` era sempre `step.input` — o objeto genérico que o próprio Arthur monta ao criar o plano (`clientId, tenantId, objective, channels, audience`). A saída real de uma etapa concluída (`stepReport.response.output`) nunca era lida para montar a entrada da etapa seguinte. Isso tornava impossível, em produção, que João alimentasse Maria, que Sofia alimentasse Bianca, e assim por diante — apesar de todas as Skills já produzirem briefings estruturados exatamente pensados para isso (`mariaBriefing`, `sofiaBriefing`, `biancaBriefing`, `pedroBriefing`).

### 1.2 — Nenhum ponto de entrada real existia
`src/interfaces/cli`, `src/interfaces/api` e `src/interfaces/web` continham apenas `README.md` com a frase "nesta fase não há comandos implementados". `package.json` só tinha `build`, `test`, `typecheck`, `architecture:check`. Não havia `process.argv`, `readline`, nem `bin` em lugar nenhum do repositório. O único caminho que exercitava a cadeia completa era o teste e2e, com montagem manual — ou seja, não havia como executar "um único comando" de verdade, como pedido no ponto 8.

### 1.3 — Arthur montava um `input` genérico que não batia com o contrato real de nenhuma Skill
Consequência direta de o encadeamento nunca ter sido testado de ponta a ponta com Skills reais: o `input` genérico de cada etapa (`clientId, tenantId, objective, channels, audience`) não contém `originalRequest`, `desiredChannel`/`channel` (singular), `desiredFormat`/`format`, `desiredObjective`, `visualObjective`, `imageCount` ou `desiredAspectRatio` — todos exigidos por João, Sofia, Bianca ou Pedro. Rodar o plano de Arthur através do Caio contra as Skills reais falhava por validação de entrada antes mesmo de qualquer questão de encadeamento. Esse problema só ficou visível ao construir o teste e2e real e a CLI — é um exemplo direto de por que "nunca foi exercitado de ponta a ponta" é a explicação mais simples para a inconsistência relatada.

### 1.4 — Governança de marca da Clara não chegava a quem gera texto/imagem, de forma proativa
`buildMariaBriefing` (João) nunca populava `forbiddenTerms`, e o tipo `JoaoMariaBriefing`/`MariaCopyBriefing` nem tinha campos para `mandatoryWords`/`preferredHashtags` — apesar de `BrandContext` (Clara) já ter esses dados havia tempo, e de João já citá-los como texto solto em `risks`/`observations`. O Lucas era a única Skill que de fato cruzava `forbiddenWords`/`forbiddenHashtags`/`mandatoryWords` — mas só *depois* de tudo gerado, como rede de segurança reativa, nunca como prevenção antes da geração.

### 1.5 — Prompts internos com rigor desigual
`buildFinalImagePrompt` (Pedro) já tinha blocos explícitos "PADRÃO DE QUALIDADE OBRIGATÓRIO" / "RESTRIÇÕES NEGATIVAS". `buildMariaPrompt` (Maria), `buildIcaroDirectionPrompt` (Sofia) e `buildIcaroDesignPrompt` (Bianca) não tinham o mesmo nível de instrução explícita — não estavam quebrados, mas não garantiam o mesmo padrão de peça em peça.

### 1.6 — Pedro é a Skill mais madura do projeto, mas a página de entrega não seguia a ordem pedida e faltavam duas peças
Pedro já gerava HTML real, PNG real, ZIP real, botões de baixar/abrir/copiar legenda/copiar hashtags e um `qualityReport` com score — muito além do que os outros seis pontos do pedido presumiam que já existisse. As lacunas reais eram pontuais: a ordem das seções era header → arquivos auxiliares → prontidão do briefing → legenda → hashtags → galeria (galeria por último, não por primeiro); não existia seção/botão de CTA; e não existia nenhuma seção de "Skills utilizadas" — o que é esperado, já que Pedro é isolado por design e nunca poderia saber sozinho quais outras Skills rodaram.

### 1.7 — Caio não tinha como retomar um workflow pausado
Ao atingir um `human_gate`, `execute()` retornava e guardava o relatório em memória, mas não existia `resume()`. A própria descrição de Caio ("pausa em aprovação humana e retorna um relatório estruturado") ficava pela metade — sem retomada, a aprovação humana era um beco sem saída.

---

## 2. Melhorias aplicadas

Mapeadas aos 8 pontos do pedido original:

**1. Fluxo.** `Caio.resolveStepInput` aplica declarativamente os `inputBindings` de cada etapa do plano, lendo apenas `response.output` de etapas já concluídas — nunca importando tipo de nenhuma Skill (ADR 0002 preservado, confirmado pelo teste `assertNoDirectSkillCalls`, que continua passando). `Caio.resume`/`hydrateExecution` fecham o ciclo de aprovação humana. A CLI (`npm run zuno -- "..."`) agora executa o fluxo completo de verdade a partir de um comando em texto — o teste `organic-cycle.e2e.test.mjs` foi reescrito para provar isso rodando `ArthurOrchestrator` + `CaioWorkflowExecutor` + `HelenaSkillManager` reais contra as sete Skills reais, sem nenhuma montagem manual de input.

**2. Identidade visual automática.** `mandatoryWords`, `forbiddenTerms` e `preferredHashtags` da `BrandContext` da Clara agora chegam a Maria através do briefing do João, sem o usuário precisar pedir. O bloco de identidade do prompt do Pedro passou a incluir `mandatoryWords`/`forbiddenWords`/`preferredCtas` também. Cores, fontes e estilo visual já chegavam corretamente a Sofia/Bianca/Pedro antes desta mudança — confirmado por auditoria de código, não presumido.

**3. Pedro.** Já atendia a quase tudo pedido (alta resolução conforme resolução sugerida por proporção, PNG, nomes organizados `slide-NN.ext`, preview, baixar, abrir, copiar legenda, copiar hashtags, baixar ZIP em carrossel). Faltava apenas "Copiar CTA" — adicionado.

**4. HTML.** `buildDeliveryHtml` reordenado para Preview → Botões de ação → Legenda → Hashtags → CTA → Resumo técnico da execução → Relatório das Skills utilizadas. A seção de Skills só aparece quando o Caio a envia (via `workflowContext.upstreamSkillsReport`, injetado genericamente pelo próprio Caio a cada etapa) — Pedro nunca precisa conhecer o formato de saída de outra Skill.

**5. Qualidade visual.** Já era o ponto mais forte do projeto (checklist de agência com 10 critérios, bloqueio de geração pobre com `needs_more_context`). Sem mudanças de substância aqui além do que o ponto 6 melhora indiretamente.

**6. Prompts internos.** Maria, Sofia e Bianca ganharam blocos explícitos "PADRÃO DE QUALIDADE OBRIGATÓRIO"/"RESTRIÇÕES NEGATIVAS" equivalentes ao que Pedro já tinha, cada um adaptado ao escopo real da Skill (Sofia não define layout; Bianca não define copy/paleta).

**7. Consistência.** Resolvida na raiz pelo ponto 1: como o encadeamento e os campos de entrada agora são sempre montados pelo mesmo código (Arthur + Caio), o resultado deixa de depender de quem monta a chamada manualmente.

**8. Experiência final.** `npm run zuno -- "crie um post para o Rumo ao Altar no Instagram e Facebook"` roda o pipeline completo e imprime o caminho da página HTML pronta; `npm run zuno -- --approve <id>` retoma após aprovação humana (obrigatória antes de qualquer publicação, preservada integralmente) e conclui com Ana em modo `dry_run` (nenhuma credencial real de Meta existe nesta fase).

---

## 3. Skills alteradas

| Skill | O que mudou |
|---|---|
| **João** (`joao-marketing-strategy`) | `buildMariaBriefing` passou a receber o contexto da Clara e a popular `forbiddenTerms`, `mandatoryWords`, `preferredHashtags`, `keywords`. |
| **Maria** (`maria-copywriting`) | Nova checagem de qualidade `MISSING_MANDATORY_WORD`; prompt reforçado com padrão de qualidade/restrições negativas; instrução explícita para priorizar `preferredHashtags`. |
| **Sofia** (`sofia-art-direction`) | Prompt do Ícaro reforçado com padrão de qualidade/restrições negativas (sem alterar escopo: continua não decidindo layout). |
| **Bianca** (`bianca-social-media-design`) | Prompt do Ícaro reforçado com padrão de qualidade/restrições negativas (sem alterar escopo: continua não decidindo copy/paleta). |
| **Pedro** (`pedro-image-generation`) | Bloco de identidade do prompt ampliado (mandatoryWords/forbiddenWords/preferredCtas); HTML de entrega reordenado; nova seção de CTA; nova seção de Relatório das Skills (condicional). |
| **Lucas** (`lucas-quality-review`) | Sem alteração de código — já era a única Skill que cruzava corretamente as regras de marca; passa a receber dados mais completos da cadeia acima dele. |
| **Ana** (`ana-social-publishing`) | Sem alteração de código — passa a ser alcançada automaticamente pelo encadeamento do Caio, incluindo a decisão de aprovação humana via binding genérico. |

## 4. Arquivos alterados

**Novos:**
- `src/infrastructure/ai/deterministic-fake-icaro-provider.ts` — provider de IA determinístico só para demonstração/teste (extraído do teste e2e antigo), documentado explicitamente como não sendo uma integração real.
- `src/infrastructure/ai/index.ts`
- `src/interfaces/cli/index.ts` — entrypoint (`argv`, comandos `--approve`/`--reject`/`--list`).
- `src/interfaces/cli/run-command.ts` — orquestração real (Valentina, Clara, Ícaro fake, Helena com descoberta real de `dist/skills`, Caio, Arthur), seed automático do cliente de demonstração, persistência de execuções pausadas.
- `tests/cli.smoke.test.mjs`
- `docs/content-pipeline-standardization-report.md` (este documento)

**Modificados (produção):**
- `src/application/orchestration/execution-plan.contract.ts` — novo tipo `ExecutionPlanInputBinding` e campo opcional `inputBindings` em `ExecutionPlanStep`.
- `src/application/orchestration/arthur.orchestrator.ts` — `inputBindings` por capability; `originalRequest`/`channel`/`format` genéricos corrigidos; `desiredChannel`/`desiredFormat`/`desiredObjective`/`visualObjective`/`imageCount`/`desiredAspectRatio` por etapa; novo `detectFormat`.
- `src/application/workflows/caio.executor.ts` — `resolveStepInput`, `withUpstreamSkillsReport`, `getByPath`/`setByPath`/`applyPick`, `runSteps` (loop extraído e reutilizável), `resume`, `hydrateExecution`, validação de `inputBindings` em `validatePlan`.
- `src/application/workflows/caio.contract.ts` — `resume`, `hydrateExecution` no contrato da porta.
- `src/application/workflows/caio.types.ts` — `WorkflowExecutionReport.locale/dryRun/correlationId`; novo `WorkflowHumanApprovalInput`.
- `src/application/workflows/caio-log.contract.ts` — ação `WorkflowResumed`.
- `src/application/events/zuno-event.contract.ts` — evento `WorkflowResumed`.
- `src/skills/joao-marketing-strategy/joao-marketing-strategy.types.ts` e `.skill.ts`.
- `src/skills/maria-copywriting/maria-copywriting.types.ts` e `.skill.ts`.
- `src/skills/sofia-art-direction/sofia-art-direction.skill.ts`.
- `src/skills/bianca-social-media-design/bianca-social-media-design.skill.ts`.
- `src/skills/pedro-image-generation/pedro-image-generation.skill.ts` e `.types.ts`.
- `package.json` — script `zuno`; `cli.smoke.test.mjs` adicionado à suíte.
- `.gitignore` — `.zuno-data/`.
- `src/interfaces/cli/README.md` — reescrito com uso real.

**Modificados (testes):**
- `tests/joao-marketing-strategy.test.mjs`
- `tests/maria-copywriting.test.mjs`
- `tests/pedro-image-generation.test.mjs`
- `tests/caio.workflow-executor.test.mjs`
- `tests/organic-cycle.e2e.test.mjs` (reescrita completa)

## 5. Novos testes adicionados

- **Caio** (`caio.workflow-executor.test.mjs`): encadeamento via `inputBindings` (substituição total, campo nomeado, `sourcePath`, `pick`, setter aninhado); binding para etapa ainda não concluída não quebra o workflow; `resume` aprova e retoma; `resume` reprova e encerra; `resume` rejeita execução inexistente/isolada; `hydrateExecution` permite retomar a partir de uma instância nova (prova a persistência entre processos que a CLI depende).
- **João**: `mariaBriefing` carrega `forbiddenTerms`/`mandatoryWords`/`preferredHashtags`/`keywords` vindos da `BrandContext`.
- **Maria**: copy sem palavra obrigatória reprova com `MISSING_MANDATORY_WORD`; copy com a palavra presente aprova; prompt inclui as novas seções e prioriza `preferredHashtags`.
- **Pedro**: ordem das sete seções do HTML; seção de CTA e de Relatório das Skills aparecem só quando informadas.
- **CLI** (`cli.smoke.test.mjs`): comando único roda o pipeline real e pausa em aprovação humana; `--list` lista pendências; `--approve` retoma e conclui, gerando HTML com "Relatório das Skills utilizadas"; `--reject` reprova e encerra; execução sem argumentos imprime instruções.
- **Ciclo orgânico** (reescrito): mesmo cenário de antes (Rumo ao Altar, Instagram + Facebook, Pix), agora rodando por `ArthurOrchestrator` + `CaioWorkflowExecutor` + `HelenaSkillManager` reais contra as sete Skills reais, sem nenhuma montagem manual de input — é o teste que prova que o problema relatado foi corrigido de verdade, não apenas descrito.

## 6. Validações executadas

- `npm run typecheck` — limpo.
- `npm test` — **214/214 testes passando** (suíte completa, incluindo os novos).
- `npm run architecture:check` — as 7 Skills continuam descobertas corretamente em `dist/skills` pela capability certa.
- Execução manual real da CLI (fora dos testes, para inspeção visual): `npm run zuno -- "crie um post para o Rumo ao Altar no Instagram e Facebook"` → pausou corretamente em aprovação humana → `npm run zuno -- --approve <id>` → concluiu com Ana em `dry_run`. O `index.html` gerado foi lido e conferido manualmente: ordem das seções correta, legenda/hashtags/CTA reais da Maria presentes, seção de Skills lista as quatro etapas concluídas antes do Pedro.
  - Essa inspeção manual revelou um bug real durante a própria verificação (não coberto pelos testes escritos até aquele ponto): o binding de `image_generation` não estava repassando `workflowContext.mariaCopy` para o Pedro, então a primeira execução real mostrou "Legenda não informada" e nenhuma hashtag/CTA. Corrigido adicionando o binding `workflowContext.mariaCopy` à etapa de geração de imagem em Arthur; reconfirmado com nova execução manual e com a suíte de testes completa novamente verde. Registrado aqui porque é exatamente o tipo de lacuna que só aparece ao rodar de ponta a ponta — reforça por que valeu a pena implementar a CLI em vez de só a camada interna.

## 7. Impactos na arquitetura

- **Novo conceito de domínio**: `ExecutionPlanInputBinding`, uma mini-linguagem declarativa (campo-alvo, etapa de origem, caminho, seleção de campos) que permite ao Caio montar a entrada real de uma etapa a partir da saída de outra sem jamais importar um tipo de Skill — preserva ADR 0002 por construção, não por convenção informal.
- **Caio ganhou responsabilidade nova, mas dentro do que já era dele**: resolver bindings e retomar workflows são extensões do que Caio já fazia (executar um plano, produzir um relatório estruturado); nenhuma Skill precisou mudar sua forma de ser chamada.
- **Arthur passou a ser a única fonte da verdade sobre como uma etapa se conecta com a anterior** — antes essa "verdade" só existia, informalmente, dentro de um arquivo de teste.
- **Novo ponto de entrada real** (`src/interfaces/cli`), preenchendo o que a arquitetura já reservava (ADR 0003 previa VS Code/terminal como forma de execução local) sem introduzir servidor, banco de dados ou dependência externa nova.
- **Novo provider de IA determinístico compartilhado** (`src/infrastructure/ai`), eliminando a duplicação que existiria entre o teste e2e e a CLI, e deixando explícito, em um único lugar, que nenhuma integração real de IA existe ainda.
- Nenhuma mudança de contrato quebrou uma Skill existente: todos os campos novos são opcionais, seguindo o precedente já estabelecido pelo próprio projeto ao evoluir `SkillArtifact`.

---

## 8. Pendências restantes

Esta seção lista **tudo** que ainda pode ser melhorado, incluindo itens pequenos, para deixar claro o que não foi feito nesta rodada e por quê.

### Infraestrutura de IA e publicação real
- Nenhum provider real de IA (OpenAI, Gemini, Claude, etc.) está implementado — `src/infrastructure/ai` só tem o provider determinístico de demonstração. Continua sendo o maior "pendente" estrutural do projeto; tudo foi desenhado para que a troca seja só um adaptador novo implementando `AIProviderPort`, mas o adaptador em si não existe.
- Nenhuma credencial real de Meta está configurada; `MetaInstagramSocialPublisherAdapter` existe mas não foi exercitado nesta rodada além do que já era coberto por `tests/meta-instagram-social-publisher.test.mjs`.
- O `DeterministicFakeIcaroProvider` é amarrado ao cenário de demonstração "Rumo ao Altar" (por exemplo, a copy fixa da Maria cita "Rumo ao Altar" literalmente para satisfazer `mandatoryWords`). Se a CLI for usada com um `--client-id` de uma marca diferente, o texto gerado pelo fake não vai refletir a marca real — é esperado (é só um fake), mas vale deixar explícito.

### Governança de marca — defesa em profundidade incompleta
- Sofia e Bianca não pedem `BrandContext` diretamente da Clara (Sofia pede `IdentityContext`/`AudienceContext`/`ContentContext`/`PublishingContext`; Bianca pede só `IdentityContext`/`PublishingContext`). Isso é coerente com o escopo de cada uma (não decidem copy), mas significa que, se um dia Sofia ou Bianca precisarem tomar alguma decisão sensível a `mandatoryWords`/`forbiddenWords`, esse dado não estará disponível sem uma mudança adicional.
- `preferredHashtags`/`preferredCtas` chegam até Maria mas não são validados por Lucas (Lucas só bloqueia por `forbiddenWords`/`forbiddenHashtags`/`mandatoryWords` — nunca *exige* uso de preferidos, só evita proibidos). Poderia virar um aviso não bloqueante no futuro.
- Pedro recebe `mandatoryWords`/`forbiddenWords`/`preferredCtas` no prompt, mas como Pedro é proibido de inventar texto fora do que está em `workflowContext` (`extractVisibleTextContext`), esses campos só têm efeito prático se o texto visível vier de Maria — o que agora acontece (ver item 6 das validações), mas vale registrar a dependência.

### Arthur / Caio
- `Arthur.detectRequiredCapabilities` pode, em tese, incluir capabilities sem Skill real ainda implementada (`carousel_creation`, `video_creation`, `campaign_management`, `metrics_analysis`, `optimization`) — se o texto do comando mencionar "carrossel", "vídeo", "campanha" etc., o plano incluirá uma etapa que o Caio vai falhar ao tentar executar (Helena não encontra Skill para a capability). Isso é esperado dado o estágio do projeto (essas Skills ainda não existem), mas hoje o erro só aparece em runtime, no meio da execução, sem aviso prévio. Uma melhoria futura seria Arthur ou Caio validarem, antes de começar a rodar, se todas as capabilities do plano têm Skill disponível, e reportar isso de forma amigável.
- `ExecutionPlanInputBinding` cobre os casos observados na cadeia atual (substituição total, campo nomeado, caminho aninhado, seleção de campos em array). Não cobre transformações mais ricas (concatenar strings, agregar múltiplas fontes num único campo calculado) — não foi necessário até agora, mas se uma Skill futura precisar disso, o mecanismo de binding precisará crescer.
- `Caio.resume` e `hydrateExecution` não têm nenhum controle de concorrência — se duas chamadas de `resume` para a mesma execução acontecerem "ao mesmo tempo" (duas invocações de CLI simultâneas, por exemplo), não há trava alguma. Baixo risco no uso atual (CLI de um único usuário local), mas relevante se um dia existir uma API HTTP real por cima disso.
- Não existe limite de tempo (`timeout`) no nível do workflow inteiro — cada chamada ao Ícaro tem timeout próprio, mas um workflow poderia, em teoria, ficar rodando indefinidamente se uma Skill nunca retornasse.

### CLI
- Parsing de argumentos é manual e mínimo — não há suporte a aspas complexas, flags combinadas, `--help` detalhado por comando, nem validação amigável de flags desconhecidas.
- Só existe um "cliente de demonstração" com seed automático; não há comando para cadastrar um cliente novo pela CLI (isso exigiria expor `Valentina.createTenant`/`Clara.create` como comandos, hoje só acessíveis programaticamente).
- `.zuno-data` e `artifacts/` usam raízes diferentes por padrão (`.zuno-data` é relativo ao projeto; `artifacts/` é relativo ao diretório de onde o comando é executado, salvo quando `ZUNO_ARTIFACTS_DIR` é definido). Funciona, mas pode confundir quem rodar `npm run zuno` de fora da raiz do projeto.
- Não há um comando para listar clientes cadastrados, nem para inspecionar o relatório completo de uma execução já concluída (só o de execuções pendentes, via `--list`).
- A CLI sempre força `publishMode: "dry_run"` na etapa de publicação; não há flag para pedir `publish_now`/`schedule` mesmo quando um adaptador real estivesse configurado — decisão deliberada de segurança nesta fase, mas registrada como limitação.

### HTML / Pedro
- A seção "Relatório das Skills utilizadas" só lista as Skills concluídas **antes** de Pedro rodar (é a única informação disponível no momento em que o HTML do Pedro é gerado) — Lucas e Ana, que rodam depois, nunca aparecem nela. Isso é correto dado onde o HTML é gerado, mas pode surpreender quem esperar ver a lista completa das 7 Skills.
- Não existe, ainda, uma página-resumo final única que consolide *todo* o workflow (incluindo o resultado de Lucas e Ana) depois que tudo termina — hoje o artefato final continua sendo o `index.html` do Pedro. Construir essa página consolidada foi considerado e descartado nesta rodada para não expandir o escopo além do que foi pedido; fica como candidato natural para uma próxima iteração.
- O CSS do HTML de entrega não foi redesenhado do zero — foi ajustado (reordenação, novas seções) em cima da base que já existia. Está de acordo com o pedido ("nunca uma página de testes", "visual premium"), mas não passou por uma revisão de design formal.

### Testes e verificação
- Não há teste de carga/performance para workflows com muitas etapas ou muitas imagens.
- Não há teste cobrindo o caso de dois clientes diferentes rodando pela CLI ao mesmo tempo (concorrência de arquivos em `.zuno-data`).
- A suíte de testes inteira roda em modo síncrono/determinístico com fakes; não há nenhum teste (nem poderia haver, nesta fase) contra um provider de IA real ou contra a API real da Meta.

### Fora de escopo por decisão explícita (ADR 0003)
- Sem banco de dados, sem servidor HTTP, sem painel web — persistência continua sendo arquivo local (`LocalJson*Repository`, `.zuno-data`, `artifacts/`). Constatado como escolha deliberada da arquitetura nesta fase, não como pendência a "corrigir".
- `src/interfaces/api` e `src/interfaces/web` continuam como esqueleto (só README) — fora do pedido desta tarefa, que era padronizar o fluxo de conteúdo, não construir novas interfaces.
