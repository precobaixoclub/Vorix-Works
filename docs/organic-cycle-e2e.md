# Teste ponta a ponta do ciclo orgânico

O teste ponta a ponta do ciclo orgânico (`tests/organic-cycle.e2e.test.mjs`) valida o fluxo operacional completo do Zuno para uma publicação orgânica, rodando por `ArthurOrchestrator` → `CaioWorkflowExecutor` → `HelenaSkillManager` → João, Maria, Sofia, Bianca, Pedro, Lucas e Ana reais — exatamente a mesma cadeia de componentes que a CLI (`src/interfaces/cli`) usa em produção local. A intenção deste teste não é simular uma chamada isolada de cada Especialista com fixtures montadas manualmente, nem encadear a saída de uma etapa na entrada da próxima diretamente no corpo do teste: é comprovar que Arthur monta o plano certo, que Caio encadeia automaticamente a saída real de cada etapa na entrada da seguinte através de `inputBindings`, e que o resultado final chega correto e completo ao HTML de entrega — sem dependência de APIs externas e sem quebra dos contratos espelhados por convenção entre Skills.

## Como o teste monta o cenário

O teste chama `arthur.planFromText({ command: originalRequest, clientId })` com um pedido em texto livre sobre o Rumo ao Altar, para Instagram e Facebook, mencionando o envio de presentes via Pix. Arthur devolve um `ExecutionPlan` real, e o teste valida a sequência exata de capabilities que Arthur decidiu incluir: `strategy`, `copywriting`, `art_direction`, `social_media_design`, `image_generation`, `quality_review`, `human_gate` e `social_publishing`.

Em seguida, o teste chama `caio.execute({ plan: executionPlan, dryRun: true })`. Caio percorre as etapas, chamando `helena.executeSkill` para cada capability — Helena descobre a Skill real pelo manifesto e a executa, exatamente como faria em produção. O workflow para em `WAITING_HUMAN_APPROVAL` na etapa de aprovação; o teste então chama `caio.resume(executionId, { confirmed: true, ... })` para simular a aprovação humana e deixar o workflow continuar até `COMPLETED`, incluindo a etapa final de publicação (Ana).

Nenhum encadeamento manual acontece no corpo do teste: cada Skill recebe sua entrada exclusivamente através dos `inputBindings` que Arthur já declarou no plano e que Caio resolve em tempo de execução contra a saída real da etapa anterior.

## O que é real e o que é fake neste teste

- **Reais**: `ArthurOrchestrator`, `CaioWorkflowExecutor`, `HelenaSkillManager`, `SkillRegistry`, `SkillManifestValidator`, `ValentinaTenantManager` (com `InMemoryValentinaTenantRepository`), `ClaraKnowledgeCenter` (com `InMemoryClaraKnowledgeRepository`), e as sete Skills reais (João, Maria, Sofia, Bianca, Pedro, Lucas, Ana).
- **Fake, mas determinístico**: `DeterministicFakeIcaroProvider` (o mesmo provider fake usado pela CLI local — não é uma fake exclusiva deste teste) no lugar de um provider real de IA; `OrganicCycleStorageFake` no lugar de um storage físico real (`LocalArtifactDelivery` real ainda grava os artefatos HTML/imagem em um diretório temporário); `OrganicCycleSocialPublisherFake` no lugar de uma chamada real à Meta.
- **Ausente por design**: nenhuma chamada de rede, nenhum SDK de IA concreto, nenhuma credencial real.

## O que o teste valida ao final

- A saída real de cada Skill, lida diretamente do `WorkflowExecutionReport` (`stepOutput(report, "Estratégia de marketing")` etc.), incluindo os campos mais recentes: `mariaBriefing.mandatoryWords`/`forbiddenTerms` (vindos de `BrandContext` na Clara), compatibilidade estrutural entre `mariaBriefing`/`sofiaBriefing`/`biancaBriefing`/`pedroBriefing` e o contrato de entrada real de cada Skill seguinte (`assertMariaBriefingCompatible`, `assertSofiaBriefingCompatible`, `assertBiancaBriefingCompatible`, `assertPedroBriefingCompatible`).
- Que Ana recebe o pacote completo e devolve `overallStatus: "dry_run"`, dois drafts (Instagram e Facebook), sem nenhuma chamada real a `publish`/`schedule` do publisher fake.
- A sequência exata de chamadas ao Ícaro fake por `specialistId` (João, Maria, Sofia, Bianca, Pedro, Lucas — Ana nunca aparece, porque publicação social não depende de IA), incluindo os `taskType` corretos (`image_generation` para Pedro, `text_generation` para Maria).
- Que o HTML de entrega gerado por Pedro contém a seção "Relatório das Skills utilizadas" com os nomes reais das etapas anteriores, e a seção "Resumo técnico da execução" — confirmando que `workflowContext.upstreamSkillsReport`, injetado por Caio, chegou até Pedro.
- Que o log de Caio registrou `WorkflowResumed` após a aprovação humana.
- **Isolamento arquitetural** (`assertNoDirectSkillCalls`): lê os arquivos-fonte das sete Skills e confirma que todo import relativo aponta apenas para o próprio diretório da Skill, para `application`/`domain`, ou para `shared` (utilitários cross-Skill que não violam o ADR 0002) — nunca para a pasta de outra Skill.
- **Drift entre contratos espelhados** (`assertMirroredContractsDoNotDrift`): `JoaoMariaBriefing` precisa continuar sendo aceito por `MariaCopyBriefing`, `JoaoSofiaBriefing` precisa continuar espelhado com `SofiaJoaoBriefing`, `SofiaBiancaBriefing` precisa continuar espelhado com `BiancaSofiaBriefing`, e `BiancaPedroBriefing` precisa continuar espelhado com `PedroBiancaBriefing`. Se algum campo for renomeado em um lado e esquecido no outro, o teste falha.

## Relação com a CLI

Este teste e a CLI local (`npm run zuno`) exercitam a mesma cadeia real de componentes (Arthur, Caio, Helena e as sete Skills) — a diferença é que a CLI usa arquivos JSON locais para persistência (`ZUNO_DATA_DIR`) e este teste usa repositórios em memória, por velocidade e isolamento entre execuções de teste. Um bug de encadeamento real entre Skills apareceria nos dois lugares; por isso, sempre que uma mudança tocar como uma Skill lê a saída de outra, tanto este teste quanto uma execução manual pela CLI (`tests/cli.smoke.test.mjs`) devem ser revalidados.

## Próximos passos recomendados

Antes da publicação real, os próximos passos recomendados são: criar adapters concretos de `SocialPublisherPort` para Meta em ambiente sandbox e validá-los contra este mesmo cenário; persistir assets de Pedro em storage real versionado; registrar métricas de consumo do ciclo completo em Valentina e Ícaro; e evoluir os contratos de payload para redes sociais com validações específicas por canal, como limites de legenda, quantidade de assets por carrossel, formatos aceitos e regras de agendamento.
