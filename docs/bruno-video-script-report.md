# Relatório técnico — Bruno, primeiro especialista da pipeline de vídeo

Este relatório documenta a implementação do Bruno, Especialista em Estratégia e Roteirização de Vídeos Curtos, a oitava Skill real do Zuno e o primeiro componente de uma pipeline de vídeo própria e ainda independente: João → Bruno → Vanessa → Diego → Rafa → Lucas → Ana. Nenhuma etapa depois de Bruno foi implementada nesta rodada, por instrução explícita do pedido.

## Arquitetura da Skill

Bruno segue exatamente o mesmo padrão arquitetural das sete Skills existentes (João, Maria, Sofia, Bianca, Pedro, Lucas, Ana):

- **Manifesto** (`bruno.manifest.ts` + `skill.manifest.json`) declara `capabilities: ["video_script"]`, `dependencies` (`ValentinaTenantPort` obrigatório, `ClaraKnowledgePort` obrigatório, `IcaroBrainPort` opcional) e uma `responsibilityBoundary` explícita com o que Bruno pode e não pode fazer.
- **Tipos** (`bruno-video-script.types.ts`) definem o contrato de entrada/saída próprio de Bruno, incluindo `BrunoJoaoStrategySummary` — um tipo que **espelha por convenção** o formato real de `JoaoMarketingStrategyCore`, sem importar nada do João, preservando o isolamento entre Skills (ADR 0002).
- **Contrato de log** (`bruno-log.contract.ts`) define as ações de log próprias de Bruno (`RequestReceived`, `ValidationFailed`, `ClientResolved`, `ClientNotFound`, `ContextConsulted`, `ContextIncomplete`, `ScriptStarted`, `AISupportRequested`, `AISupportApplied`, `AISupportSkipped`, `AISupportFailed`, `ScriptFinalized`, `VanessaBriefingCreated`, `Error`).
- **Implementação** (`bruno-video-script.skill.ts`) segue a mesma estrutura de classe + funções puras auxiliares (`buildBaselineScript`, `buildIcaroScriptPrompt`, `parseScriptEnhancement`, `mergeScriptEnhancement`, `buildVanessaBriefing`) já usada por João e Sofia.
- **Barrel** (`index.ts`) exporta tudo e reexporta `createBrunoVideoScriptSkill` como `createSkill`, a convenção que `FileSystemSkillModuleLoader` espera para descoberta automática.

Bruno conhece apenas três abstrações: `ValentinaTenantPort` (identificação do cliente), `ClaraKnowledgePort` (marca, público, conteúdo, publicação) e, de forma opcional, `IcaroBrainPort`. Bruno nunca importa um Provider de IA concreto, nunca acessa storage diretamente e nunca chama outra Skill.

## Decisões arquiteturais

**1. Roteiro é inteiramente determinístico; o Ícaro é só um polimento textual opcional.** Ao contrário de uma tentação óbvia de "pedir o roteiro inteiro para a IA", toda a estrutura que carrega risco de qualidade objetiva — divisão em cenas, tempo por cena, texto falado/na tela, B-roll, enquadramento, movimento de câmera, ritmo, pausas, transições, efeitos sonoros — é construída por heurística pura em `buildScenes`/`buildNarrativeStructure`/etc., a partir da estratégia do João. O Ícaro, quando configurado, só pode aprimorar cinco campos de prosa (`narrativeStructure`, `hook`, `overallRhythm`, `musicSuggestions`, `finalCta`) — nunca as cenas. Isso garante que "Bruno funciona totalmente sem Ícaro" (requisito explícito do pedido) não seja apenas um fallback degradado, mas o modo de operação plenamente funcional e íntegro por padrão. A validação em CLI confirmou isso na prática: com o `DeterministicFakeIcaroProvider` da CLI (que não devolve o JSON esperado por Bruno), a execução caiu graciosamente em `AISupportFailed` e produziu um roteiro completo e correto mesmo assim.

**2. Cenas são geradas proporcionalmente à duração total, não fixas.** `buildScenes` distribui pesos (20% gancho, 60% dividido entre até 3 mensagens-chave de desenvolvimento, 20% CTA final) sobre `totalDurationSeconds`, ajustando a última cena para que a soma bata exatamente com o total. Isso evita tanto um roteiro genérico de duração fixa (ignorando `desiredDurationSeconds`) quanto cenas de duração incoerente entre si.

**3. `video_script` é uma pipeline nova e paralela, não uma extensão da pipeline de imagens.** Esta foi a decisão mais delicada da integração com Arthur. O pedido pedia reconhecimento da capability "sem alterar o funcionamento atual da pipeline de imagens". A pipeline de imagens (`art_direction`/`social_media_design`/`image_generation`) é decidida por `channels` visuais (instagram, tiktok, youtube etc.) e por palavras-chave como "imagem"/"arte"/"visual"/"criativo"/"post"/"publicacao" — nenhuma dessas condições foi tocada. `video_script` foi adicionado como uma condição **inteiramente nova e independente**, disparada apenas por "roteiro"/"roteirizar"/"roteirização", sem sobrepor nem reaproveitar nenhuma condição existente. A etapa "Roteiro de vídeo" resultante depende apenas da etapa de estratégia (recebe `joaoStrategy` por `inputBinding`, do mesmo jeito que a etapa de Direção de Arte já fazia) e **não alimenta** Revisão (Lucas) nem Aprovação — porque Lucas ainda não sabe revisar roteiro de vídeo, e adaptar Lucas para isso estava fora do escopo pedido ("não implemente Vanessa", e por extensão, não implementar nada que dependa de uma pipeline de vídeo completa). O resultado: um pedido que menciona "roteiro" ganha a etapa de Bruno; um pedido que não menciona não ganha nada; e nenhum teste ou fluxo de imagem existente mudou de comportamento — confirmado pela suíte completa (290/290) e por validação real via CLI mostrando as duas etapas de imagem ausentes quando o pedido só menciona vídeo.

**4. `video_script` não foi acoplado a `video_creation`.** A capability `video_creation` já existia, reservada para uma futura Skill de geração/edição de vídeo, disparada por "vídeo"/"reels"/"shorts". Pedir um roteiro não implica pedir o vídeo pronto — as duas capabilities são independentes e podem, em tese, coexistir no mesmo plano sem uma depender da outra. Isso evita repetir o erro arquitetural já corrigido anteriormente com `carousel_creation` (capability artificial acoplada a uma decisão que deveria ser de outra Skill).

**5. Nenhuma nova capability de imagem/layout foi criada.** Bruno não define layout, grid, paleta ou tipografia de peças visuais estáticas — o manifesto proíbe isso explicitamente. Essas responsabilidades continuam exclusivas de Sofia/Bianca, sem qualquer sobreposição.

## Arquivos criados

**Skill:**
- `src/skills/bruno-video-script/bruno-video-script.types.ts`
- `src/skills/bruno-video-script/bruno-log.contract.ts`
- `src/skills/bruno-video-script/bruno.manifest.ts`
- `src/skills/bruno-video-script/skill.manifest.json`
- `src/skills/bruno-video-script/bruno-video-script.skill.ts`
- `src/skills/bruno-video-script/index.ts`

**Documentação:**
- `docs/bruno-video-script.md`
- `docs/bruno-video-script-report.md` (este relatório)

**Testes:**
- `tests/bruno-video-script.test.mjs` (27 testes)

## Arquivos alterados

- `src/domain/skills/skill-capability.contract.ts` — capability `video_script` adicionada ao catálogo.
- `src/application/events/zuno-event.contract.ts` — eventos `VideoScriptStarted`, `VideoScriptContextLoaded`, `VideoScriptGenerated`, `VanessaBriefingCreated`, `VideoScriptFailed` adicionados.
- `src/application/orchestration/arthur.orchestrator.ts` — `video_script` adicionado a `DEFAULT_CAPABILITIES`; detecção por palavras-chave ("roteiro"/"roteirizar"/"roteirizacao") adicionada a `detectRequiredCapabilities`; etapa "Roteiro de vídeo" adicionada a `createSteps`, condicional e isolada da pipeline de imagens.
- `scripts/verify-skills-discovery.mjs` — Bruno adicionado à lista `EXPECTED_SKILLS` (capability `video_script`).
- `tests/skills-discovery.test.mjs` — Bruno incluído nos testes de cópia de manifesto, descoberta real e busca por capability.
- `tests/arthur.orchestrator.test.mjs` — 2 testes novos (reconhecimento de `video_script` isolado da pipeline de imagens; ausência da etapa quando o comando não menciona roteiro).
- `package.json` — `tests/bruno-video-script.test.mjs` adicionado à lista de arquivos do script `test`.
- `README.md` — Bruno mencionado no parágrafo de "Estado atual" e parágrafo dedicado descrevendo a Skill.
- `src/skills/README.md` — contagem e descrição atualizadas para oito Skills reais, incluindo Bruno (e corrigida a omissão pré-existente de Bianca nesse texto).
- `docs/arthur-orchestrator.md` — seção "Preparação para Skills futuras" atualizada com Bruno/`video_script` e nova nota explicando que roteiro de vídeo é uma pipeline própria, isolada da pipeline de imagens.

Nenhum arquivo de João, Sofia, Bianca, Pedro, Lucas ou Ana foi alterado — Bruno consome a estratégia do João inteiramente por meio de um tipo espelhado, sem exigir qualquer mudança no João.

## Integração com o workflow

- **Helena**: descoberta 100% automática via `FileSystemSkillDiscovery` + `skill.manifest.json` — nenhuma alteração de código foi necessária em Helena. Confirmado por `npm run architecture:check`: Bruno aparece como `bruno-video-script: estado=READY, capabilities=video_script`.
- **Caio**: nenhuma alteração de código foi necessária. Bruno é executado como qualquer etapa `type: "skill"` comum; como a etapa não alimenta Revisão/Aprovação, o workflow segue seu curso normal (estratégia → roteiro de vídeo → copy → revisão → aprovação, todas em paralelo lógico, sem uma bloquear a outra por dependência).
- **Arthur**: reconhece `video_script` e monta a etapa "Roteiro de vídeo" com `dependsOn: [strategyStepId]` e `inputBindings: [{ targetField: "joaoStrategy", fromStepId: strategyStepId }]`.
- **Valentina**: `video_script` foi adicionado a `DEFAULT_CAPABILITIES` (mesma lista onde `video_creation`, ainda não implementada, já vivia) mas **não** foi adicionado a `PRO_SPECIALISTS` no catálogo de planos — seguindo o mesmo precedente já existente para `video_creation`, que também está reservada em `DEFAULT_CAPABILITIES` sem estar liberada em nenhum plano hoje. Como a CLI local não usa gating por plano ao chamar `planFromText` (passa sempre `DEFAULT_CAPABILITIES`), isso não bloqueia a validação funcional desta fase; fica registrado como decisão consciente e consistente com o padrão já estabelecido.

## Testes criados

`tests/bruno-video-script.test.mjs` (27 testes) cobre: manifesto válido; resolução de cliente por `tenantId`/`clientId`; consulta correta à Clara (módulos `BrandContext`/`AudienceContext`/`ContentContext`/`PublishingContext`); funcionamento completo sem Ícaro; uso opcional do Ícaro com sucesso; degradação graciosa quando o Ícaro falha; garantia de que o Ícaro nunca redefine as cenas; geração completa do roteiro; duração padrão de 30s; respeito a `desiredDurationSeconds`; soma exata das durações das cenas batendo com o total; gancho sempre na primeira cena e CTA final sempre na última; até 3 cenas de desenvolvimento (uma por mensagem-chave, limitado a 3); briefing estruturado para Vanessa; ausência de campos de vídeo real (`videoUrl`/`videoBase64`); tratamento de cliente não encontrado; tratamento de contexto insuficiente; validação de entrada (incluindo `desiredDurationSeconds` inválido); logs e eventos esperados; pureza de `buildBaselineScript`/`buildVanessaBriefing`; isolamento (nenhum provider de IA concreto, nenhuma outra Skill chamada diretamente, nenhum acesso a storage, nenhum `child_process`/`ffmpeg`/`spawn`/`execSync`).

`tests/arthur.orchestrator.test.mjs` ganhou 2 testes: reconhecimento de `video_script` com a etapa correta (nome, tipo, `dependsOn`, `inputBindings`) e ausência total da pipeline de imagens quando só "roteiro" é mencionado; e confirmação de que um pedido comum (sem "roteiro") continua sem a etapa de Bruno.

`tests/skills-discovery.test.mjs` ganhou verificação de que o manifesto de Bruno é copiado para `dist/skills`, que Helena o descobre como oitava Skill `READY`, e que é encontrado pela capability `video_script`.

## Validações executadas

- `npx tsc --noEmit` — sem erros.
- `npm test` — **290/290 testes passando** (263 antes desta rodada + 27 novos, entre Bruno e os ajustes em Arthur/skills-discovery).
- `npm run architecture:check` — build completo, **oito Skills descobertas**, `video_script` → `bruno-video-script` confirmado junto às outras sete capabilities.
- **Validação end-to-end real via CLI**: `npm run zuno -- "Crie um roteiro de vídeo curto para o Rumo ao Altar sobre taxa zero na lista de presentes."` produziu um plano com as etapas Estratégia → **Roteiro de vídeo** → Criação da copy → Revisão → Aprovação, todas `COMPLETED` até a pausa esperada em aprovação humana. Inspecionei o JSON persistido da execução e confirmei: `narrativeStructure`, `hook`, `totalDurationSeconds: 30`, 5 cenas (Gancho 6s + 3 Desenvolvimento de 6s cada + CTA final 6s = 30s exatos), cada cena com `spokenText`/`onScreenText`/`brollSuggestions`/`framing`/`cameraMovement`/`rhythm`/`transitionToNext`/`soundEffectSuggestions` preenchidos, `overallRhythm`, `musicSuggestions`, `finalCta` igual ao CTA do João, `recordingNotes`, `editingNotes`, `risks`, `observations`, `nextSteps` e `vanessaBriefing` completo com `status: "preliminary"`. Confirmei também que **nenhuma etapa de imagem** (Direção de arte, Design de redes sociais, Geração de imagem) apareceu no plano, e que um segundo teste com um pedido comum (sem "roteiro") não inclui a etapa de Bruno — a pipeline de imagens permanece intocada.

## Impacto na arquitetura do Zuno

- **Isolamento entre Skills preservado**: Bruno não importa nada de João, Sofia, Bianca, Pedro, Lucas ou Ana; define seu próprio tipo espelhado da estratégia do João. Nenhuma Skill existente importa ou executa Bruno diretamente.
- **Nenhum acoplamento artificial criado**: `video_script` é uma capability única e independente, sem replicar o erro já corrigido de `carousel_creation`.
- **Pipeline de imagens intacta**: confirmado por testes automatizados (290/290) e validação manual — nenhuma condição de detecção de canal/palavra-chave da pipeline de imagens foi alterada.
- **Precedente reaproveitado**: capabilities reservadas sem Skill (`campaign_management`, `metrics_analysis`, `optimization`, `video_creation`) continuam falhando de forma imediata e clara via checagem prévia do Caio — o mesmo comportamento se aplicará automaticamente no dia em que alguém tentar avançar a pipeline de vídeo além de Bruno, sem exigir nenhum código novo.

## Limitações atuais

- A pipeline de vídeo tem apenas seu primeiro elo. Vanessa (produção/filmagem), Diego e Rafa não existem — um workflow que tentasse avançar além do roteiro falharia hoje por falta de Skill, comportamento esperado e não implementado nesta rodada por instrução explícita.
- Um pedido que menciona tanto "roteiro" quanto um canal/palavra-chave visual (ex.: "crie um roteiro de vídeo para o Instagram") aciona **tanto** a etapa de Bruno **quanto** a pipeline de imagens completa, porque as duas condições de detecção são independentes por design e nenhuma delas verifica a outra. Isso é consistente com o objetivo desta rodada (não alterar a pipeline de imagens), mas pode gerar planos com etapas visuais desnecessárias para pedidos que são, na intenção real do usuário, apenas sobre vídeo. Registrado como possível refinamento futuro.
- `video_script` foi adicionado a `DEFAULT_CAPABILITIES` mas não a `PRO_SPECIALISTS`, seguindo o precedente de `video_creation`. Quando o gating por plano for de fato aplicado à CLI/produção, alguém precisará decidir explicitamente em qual(is) plano(s) `video_script` deve ficar disponível.

## Recomendações para a próxima Skill (Vanessa)

- Vanessa deve consumir `BrunoVanessaBriefing` através de um tipo espelhado próprio (`VanessaBrunoBriefing` ou nome equivalente), exatamente como Bianca espelha o briefing de Sofia — nunca importando os tipos de Bruno diretamente.
- Como as cenas de Bruno já trazem tempo, texto, B-roll, enquadramento e movimento de câmera detalhados por cena, Vanessa pode focar em traduzir esse roteiro em instruções de produção prática (equipamento, locação, talent direction) sem precisar reinterpretar ou redecidir estrutura narrativa.
- Considerar, quando Vanessa existir, se a etapa de Revisão (Lucas) deve ganhar um modo de revisão específico para roteiro de vídeo (hoje Lucas não lê `BrunoVanessaBriefing` em nenhum ponto do fluxo) — hoje isso está fora do escopo porque avaliei que adaptar Lucas sem a pipeline de vídeo completa seria prematuro, mas se torna relevante assim que Vanessa (ou uma etapa de revisão de vídeo dedicada) existir.
- Ao conectar Vanessa ao plano de Arthur, revisar se a etapa de Bruno deve passar a ter `dependsOn`/`inputBindings` adicionais apontando para a nova etapa de Vanessa — hoje ela é uma etapa "solta" no plano porque não há nada a seguir; isso deixará de ser verdade assim que Vanessa existir.
- Manter a mesma disciplina desta rodada: nenhuma geração real de vídeo, nenhum `child_process`/binário externo (ffmpeg etc.) sem uma decisão arquitetural explícita e documentada — seguindo o mesmo princípio de segurança já aplicado ao Developer Assisted Mode do Pedro.
