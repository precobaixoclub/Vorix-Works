# Sprint 13 — Revisão Arquitetural Antes de Código

Esta revisão cobre a Fase 1 do Prompt 13. Nenhuma implementação funcional deve começar antes da
aprovação explícita desta revisão.

## Estado Atual

Fluxo existente:

`Conversation -> Briefing -> PreparedCommand -> Planning -> Runtime -> Execution -> Handler Resolver -> Handler`

Na Sprint 12, somente `editorial_research` pode usar `SkillExecutionTaskHandler` real via Helena.
As demais capabilities seguem determinísticas ou fallback determinístico.

## Registry e Resolver

Pontos reutilizáveis:

- `ExecutionHandlerRegistry` já registra handler, provider, versão, prioridade, modos, flags e fallback.
- `ExecutionHandlerResolver` já centraliza resolução por capability, task type, mode e feature flags.
- `HandlerResolutionEvent` já registra auditoria sem payload de usuário.
- `SkillExecutionTaskHandler` já prova o adapter infra-only para `Execution -> Handler -> Helena -> Skill`.

Gaps para Sprint 13:

- O builder registra handler real apenas para `editorial_research`.
- O fallback `fail_closed` só existe para `editorial_research`; real full pipeline precisa bloquear fallback silencioso para toda capability real solicitada.
- O adapter atual converte output real apenas da task `research` para a porta `context`.
- O retry ainda é global, não informado por handler.

## Capability Mapping

Mapping atual:

| ExecutionCapability | SkillCapability |
| --- | --- |
| `editorial_research` | `editorial_planning` |
| `strategic_planning` | `marketing_strategy` |
| `copywriting` | `copywriting` |
| `visual_design` | `image_generation` |
| `human_review` | `quality_review` |
| `distribution` | `social_publishing` |

Observações:

- O Prompt 13 usa os nomes `campaign_planning`, `copy_generation`, `visual_generation` e
  `distribution`, mas o domínio atual usa `strategic_planning`, `copywriting`, `visual_design`,
  `human_review` e `distribution`.
- `human_review` é uma capability mapeada, mas a task atual `approval` é tratada pelo engine como
  `ExecutionGate` especial e não passa pelo resolver.
- Se “todas as ExecutionCapabilities” incluir `human_review`, há conflito com “Execution Engine
  permanece inalterado”. Sem alterar o engine, `approval` não executa Skill real.

## Runtime Atual

Pipeline Runtime atual:

| TaskType | Capability | Input Port(s) | Output Port | ArtifactType |
| --- | --- | --- | --- | --- |
| `research` | `editorial_research` | — | `context` | `document` |
| `campaign_structure` | `strategic_planning` | `context` | `structure` | `document` |
| `copy_generation` | `copywriting` | `structure` | `copy` | `text` |
| `visual_generation` | `visual_design` | `structure` | `visual` | `image`/`video`/`carousel` |
| `approval` | `human_review` | `copy`, `visual` | `decision` | `document` |
| `publication` | `distribution` | `decision` | `manifest` | `document` |

Gaps:

- `campaign_structure` recebe apenas o artefato `context`, mas João normalmente espera
  `originalRequest`, `desiredChannel`, `desiredFormat`, `desiredObjective` e opcionalmente
  `editorialBrief`.
- `copy_generation` recebe apenas `structure`, mas Maria espera `MariaCopyBriefing` com campos
  específicos.
- `visual_generation` recebe apenas `structure`, mas Pedro espera design detalhado de Bianca; Sofia
  e Bianca existem como Skills separadas no legado, mas não existem como RuntimeTasks no pipeline
  novo.
- `publication` recebe apenas `decision`, mas Ana espera pacote completo: estratégia, copy, visual,
  revisão Lucas, aprovação humana, canais e `publishMode`.

## Skills Existentes e Side Effects

| Skill | Capability | Side Effects Principais | Risco para Execution Real |
| --- | --- | --- | --- |
| Eduardo | `editorial_planning` | Valentina/Clara reads; Ícaro opcional | Já integrado para research; contrato ainda sem schema formal. |
| João | `marketing_strategy`, `strategy` | Valentina/Clara reads; Ícaro opcional | Bom candidato para `strategic_planning`, mas precisa input explícito derivado do Runtime/context. |
| Maria | `copywriting` | Ícaro obrigatório | Não executa sem `IcaroBrainPort`; Prompt 13 proíbe AI Gateway direto, mas Skill pode usar porta. Precisa política clara para IA via Skill. |
| Sofia | `art_direction` | Valentina/Clara reads; Ícaro opcional | Necessária para visual real antes de Bianca/Pedro, mas não há RuntimeTask correspondente. |
| Bianca | `social_media_design` | Valentina/Clara reads; Ícaro opcional | Necessária para Pedro; não há RuntimeTask correspondente. |
| Pedro | `image_generation` | Ícaro, StoragePort opcional, ArtifactDeliveryPort opcional, escrita local possível | Conflita com “não escrever fora das tabelas de execução” se usar ArtifactDelivery/local files. Precisa side effect policy. |
| Lucas | `quality_review` | Valentina/Clara reads; Ícaro opcional | Não alcançável sem alteração do tratamento especial de `approval`. |
| Ana | `social_publishing` | Valentina/Clara reads; SocialPublisherPort obrigatório; publicação real se `publishMode` não for `dry_run` | Publication deve ficar proibida; handler precisa forçar `publishMode: "dry_run"` ou substituir Ana por manifesto sem publicar. |

## Contratos

Problemas encontrados:

- Manifests de Skills declaram `inputs`/`outputs` só por `name` e `description`; não há `schema`,
  `artifactType`, `outputPort` nem cardinalidade formal.
- Runtime contratos são por porta e artifact type, mas não validam schema de payload.
- `SkillExecutionTaskHandler` atual faz transformação genérica/ad-hoc do input e output.
- O Prompt 13 exige eliminar payload implícito; isso requer um registry de contratos Execution-Skill
  antes de ligar novas capabilities.

## Side Effect Policy

Categorias propostas pelo Prompt 13:

- `none`
- `external_read`
- `external_write`
- `publication`

Classificação recomendada:

- Eduardo/João/Sofia/Bianca/Lucas: `external_read`, com IA opcional via porta de Skill quando configurada.
- Maria: `external_read`, com geração via `IcaroBrainPort` obrigatório.
- Pedro: `external_write` quando materializa arquivo/storage; `external_read`/IA quando usa Ícaro.
- Ana: `publication` se `publishMode` for `publish_now` ou `schedule`; `external_read`/`none` se forçado para `dry_run`.

Política v1 recomendada:

- `publication` sempre bloqueado no Handler Resolver/Handler.
- `distribution` real só pode produzir manifesto/resultado local com `publishMode: "dry_run"`.
- `external_write` deve ser bloqueado por padrão e liberado por handler apenas se o output for persistido
  como `ExecutionArtifact` sem arquivos externos; caso contrário, manter deterministic/fail_closed.

## Riscos Principais

1. **Conflito de escopo:** “Execution Engine permanece inalterado” vs. `human_review` real, porque
   `approval` é gate especial e não chama handler.
2. **Visual real incompleto:** `visual_design -> image_generation` pula Sofia/Bianca, mas Pedro
   exige `biancaDesign` e `biancaPedroBriefing`.
3. **Contratos insuficientes:** manifests não têm schema/outputPort/artifactType; integrar agora
   exigiria transformação ad-hoc, proibida pelo Prompt 13.
4. **Side effects reais:** Pedro pode escrever arquivos locais; Ana pode publicar; ambos precisam
   bloqueio explícito.
5. **IA via Skills:** Maria exige `IcaroBrainPort`; várias Skills usam Ícaro opcional. É aceitável
   somente se a chamada continuar encapsulada em Skill e feature flags deixarem claro o side effect.
6. **Runtime atual pobre em inputs:** os bindings carregam artefatos, não um contexto rico com
   `originalRequest`, canal, formato, objetivo e pacotes anteriores no shape esperado por cada Skill.
7. **Lineage ausente no modelo:** `ExecutionArtifact` ainda não possui `handlerId`, `provider` nem
   `parentArtifactIds`.
8. **Trace ausente:** `HandlerResolutionEvent` cobre decisão; não cobre início/fim/duração/retries/warnings.

## Estratégia Recomendada Para Implementação Após Aprovação

Sequência segura:

1. Criar contrato declarativo `ExecutionSkillContract` em infraestrutura/application execution, sem
   importar domínio de Skills no domínio Execution.
2. Estender `ExecutionArtifact` com `handlerId`, `provider` e `parentArtifactIds`.
3. Criar `ExecutionTrace` persistido separado de eventos, sem payload de usuário.
4. Adicionar `SideEffectPolicy` e bloquear `publication`.
5. Expandir feature flags: `REAL_PLANNING_ENABLED`, `REAL_COPY_ENABLED`, `REAL_VISUAL_ENABLED`,
   `REAL_DISTRIBUTION_ENABLED`.
6. Implementar handlers por capability com transformadores explícitos:
   - `strategic_planning -> João`;
   - `copywriting -> Maria`;
   - `visual_design -> pipeline visual composto` ou revisar Runtime para explicitar Sofia/Bianca/Pedro;
   - `distribution -> Ana em publishMode: "dry_run"` ou manifesto determinístico real sem SocialPublisher.
7. Manter `approval` como gate humano e documentar que `human_review` não é executado nesta sprint,
   ou aprovar mudança de Runtime/Engine para incluir Lucas antes do gate.

## Pontos Que Precisam de Aprovação

Antes de código, preciso de decisão sobre:

1. `human_review`: permanece gate humano especial sem Skill real, ou a Sprint 13 autoriza alterar o
   engine/Runtime para incluir Lucas?
2. `visual_design`: handler pode ser composto chamando Sofia -> Bianca -> Pedro dentro de um único
   handler, ou Runtime deve ganhar tasks explícitas para essas Skills?
3. `distribution`: usar Ana obrigatoriamente com `publishMode: "dry_run"`, ou criar handler real de
   manifesto sem chamar Ana?
4. `external_write`: Pedro pode usar `ArtifactDeliveryPort`/arquivos locais, ou todo output visual
   deve ficar apenas em `ExecutionArtifact.payload` nesta sprint?
5. IA via Skill: permitido usar `IcaroBrainPort` dentro das Skills reais habilitadas, mantendo a
   regra de nunca chamar AI Gateway direto a partir de Execution?

Sem essas decisões, a implementação corre alto risco de violar o próprio Prompt 13.
