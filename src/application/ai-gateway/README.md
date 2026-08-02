# AI Gateway — coexistência com o Ícaro

O Zuno tem **duas pilhas de IA independentes por decisão arquitetural**, não por acidente. Nunca
unificá-las sem uma decisão explícita de sprint futura — este documento existe para que ninguém
tente "simplificar" fundindo as duas achando que é a mesma coisa.

## As duas pilhas

| | Ícaro | AI Gateway |
|---|---|---|
| Serve | 11 Skills de conteúdo (Maria, Pedro, Sofia, Bianca...) | Conversation / Briefing |
| Port de aplicação | `IcaroBrainPort` (`src/application/ai/icaro-brain.contract.ts`) | `AiGatewayPort` (`src/application/ports/ai-gateway.port.ts`) |
| Port de provider | `AIProviderPort` (`src/application/ports/ai-provider.port.ts`) | `AiModelProviderPort` (`src/application/ports/ai-model-provider.port.ts`) |
| Operações | `AITaskType` (`text_generation`, `image_generation`, `analysis`...) | `AiOperation` (`briefing_field_extraction`, `intent_classification`...) |
| Contexto | `SkillExecutionContext` (`executionId`/`taskId`/`clientId`, sem `tenantId`/`workspaceId` obrigatórios) | `AiRequest` (`tenantId`/`workspaceId`/`correlationId` sempre obrigatórios — superfície de produto multi-tenant) |
| Provider real conectado | Nenhum — só `DeterministicFakeIcaroProvider` (testes) e `DeveloperAssistedIcaroProvider` (humano-no-loop, nunca chama SDK) | `AnthropicAiModelProvider` (Sprint 08 — único SDK real do projeto) |
| Onde vive | `src/application/ai/*`, `src/infrastructure/ai/developer-assisted-icaro-provider.ts`, `.../deterministic-fake-icaro-provider.ts` | `src/application/ai-gateway/*`, `src/infrastructure/ai-gateway/*`, `src/infrastructure/ai/anthropic-ai-model-provider.ts`, `.../fake-ai-model-provider.ts`, `.../not-configured-ai-gateway.ts` |

## Por que não foram unificadas na Sprint 08

1. **Escopo explícito.** O prompt desta sprint proíbe explicitamente "execução de Skills" — mexer
   no `AITaskType`/`AIProviderPort` que 11 Skills importam diretamente violaria isso mesmo sem
   tocar uma linha de uma Skill.
2. **Contratos incompatíveis por natureza, não por acaso.** `IcaroAIRequest` foi desenhado para o
   pipeline interno Helena→Arthur→Skills (sem RBAC, sem isolamento de tenant/workspace — Skills
   não são uma superfície de produto exposta diretamente a um usuário autenticado). `AiRequest` foi
   desenhado para uma superfície de produto multi-tenant desde o primeiro campo.
3. **Nenhuma perda.** Nada que o Ícaro já fazia (seleção de provider, retry, fallback, custo,
   cache) precisou ser refeito do zero — o AI Gateway deliberadamente ESPELHA o mesmo espírito
   arquitetural (Port de aplicação → Port de provider → adapter de SDK), só com nomes e contratos
   próprios, para nunca colidir na leitura do código com o que já existia.

## O que É permitido

O AI Gateway PODE conhecer o domínio `Briefing` (`src/domain/briefing/*`) — é a única operação
executável desta sprint, e essa dependência é intencional (ver
`src/application/ai-gateway/prompt-template-registry.ts`, o único arquivo do Gateway que importa
algo de Briefing). O que nunca pode acontecer é o Gateway importar algo de `src/application/ai/*`
(Ícaro) ou vice-versa — `scripts/check-ai-stack-isolation.mjs` (rodando em `npm run
architecture:check`) falha o build se isso acontecer.

## Se um dia fizer sentido unificar

Só quando: (a) Skills precisarem de saída estruturada com o mesmo rigor de validação do Gateway, ou
(b) o produto quiser que Conversation/Briefing acionem uma Skill de verdade através do mesmo
provider real já configurado. Até lá, duplicar um pouco de estrutura é mais barato que acoplar dois
mundos com necessidades de isolamento (tenant/workspace) fundamentalmente diferentes.
