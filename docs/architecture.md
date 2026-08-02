# Arquitetura do Zuno

> **Nota de escopo (Sprint 24, certificação RC 1.0):** este documento cobre duas arquiteturas que coexistem no mesmo repositório e nunca se importam entre si (verificado por `scripts/check-*-isolation.mjs`, `npm run architecture:check`):
>
> 1. **Plataforma nova** (Conversation → Briefing → AI Gateway → Planning → Runtime → Execution → Publication → Scheduling → Analytics → Operations, Sprints 08–23) — API HTTP (Fastify, `/v1`) + frontend Next.js, multi-tenant, RBAC, é o que a Sprint 24 certifica como Release Candidate 1.0. Descrita nas seções C4 abaixo.
> 2. **Pipeline legado** (Arthur/Helena/Caio/Skills, CLI local `LOCAL_PRODUCTION`, Sprints 01–07) — já homologado e liberado em seu próprio ciclo de release (`docs/rc2-re-homologacao-report.md`, "Pronto para v1.0"). Descrito no restante deste documento, abaixo da seção C4.
>
> Ver também: `docs/event-catalog.md`, `docs/contract-catalog.md`, `docs/sprint-24-final-report.md`.

## C4 — Plataforma nova (Sprint 08+)

### Nível 1 — Contexto

```
                     ┌──────────────────────────┐
                     │   Usuário (via browser)   │
                     └────────────┬──────────────┘
                                  │ HTTPS
                                  ▼
                     ┌──────────────────────────┐
        ┌───────────▶│    Zuno — Plataforma     │◀───────────┐
        │            │  (Conversation..Operations)│           │
        │            └────────────┬──────────────┘           │
        │                         │ HTTPS (OAuth/webhook)     │
   Postgres (dados)                ▼                     Anthropic API
   (tenant/workspace/    ┌──────────────────────┐        (AI Gateway,
    conversation/          Providers externos      opcional, nunca
    planning/runtime/     (Meta/Instagram, sand-    obrigatório)
    execution/publication/ box de LinkedIn/X)
    credential/webhook/
    scheduling/analytics/
    operations)
```

Zuno é acessado por usuários autenticados (JWT + cookie httpOnly de refresh) através de um frontend Next.js, que fala exclusivamente com a API HTTP versionada (`/v1`). A API depende de Postgres (obrigatório para Identity; opcional — `PERSISTENCE_DRIVER=memory` — para os demais domínios em dev/teste) e, de forma **opcional e nunca obrigatória**, do AI Gateway (Anthropic) para extração assistida em Briefing. Publicação real em redes sociais é mediada por `PublicationProviderPort` — hoje com um adapter real (Meta/Instagram) e adapters de sandbox para os demais canais — e `ProductionGuard` bloqueia qualquer efeito de produção por padrão (ver Seção "Release Readiness" do relatório final).

### Nível 2 — Containers

| Container | Tecnologia | Responsabilidade |
|---|---|---|
| **Web (frontend)** | Next.js (App Router), React 19, SWR | Autenticação, visualização de Conversation/Briefing/Planning/Runtime/Execution/Publication/Providers/Governance/Calendar/Analytics/Operations. Nenhuma regra de negócio — só chama a API. |
| **API** | Fastify (Node/TypeScript), `/v1` | Único ponto de entrada de negócio. RBAC (`requirePermission`), rate limiting global, CORS+CSRF, envelope de resposta padronizado. |
| **Postgres** | PostgreSQL (via `pg`), 49 migrations | Fonte de verdade transacional de todos os domínios novos + Identity. |
| **AI Gateway** | Camada de aplicação (`application/ai-gateway`) + Anthropic SDK | Único ponto de contato com IA generativa nesta plataforma — opcional, com fallback determinístico sempre disponível. |
| **Secret Manager** | `application/ports/secret-manager.port.ts` | Segredos de credenciais de provider (OAuth tokens). Produção é fail-closed (sem backend real conectado ainda — ver Riscos residuais). |
| **Providers externos** | Meta Graph API (real) + sandboxes (LinkedIn/X) | Publicação social real ou simulada, sempre atrás de `PublicationProviderPort`. |

### Nível 3 — Componentes (por domínio, ordem do fluxo de negócio)

```
Conversation ──▶ Briefing ──(AI Gateway, opcional)──▶ PreparedCommand
     │                                                       │
     │                                                       ▼
     │                                                   Planning ──▶ ExecutionGraph
     │                                                       │
     │                                                       ▼
     │                                                    Runtime ──▶ RuntimeBinding/Context
     │                                                       │
     │                                                       ▼
     │                                                   Execution ──▶ ExecutionRun/Task/Gate
     │                                                       │
     │                                          ┌────────────┴────────────┐
     │                                          ▼                         ▼
     │                                    Scheduling               Publication ──▶ Outbox ──▶ Dispatch
     │                                          │                         │              │
     │                                          ▼                         ▼              ▼
     │                                     Editorial Calendar      Webhooks ◀── Providers  Reconciliation
     │                                                                    │
     │                                                                    ▼
     └──────────────────────────────────────────────────────────▶  Analytics ──▶ Dashboard
                                                                          │
                                        Credential/Governance/Compliance/Audit (transversal)
                                        Operations: Production Guard/Circuit Breakers/Health/
                                        Readiness/Backpressure/Rate Limiting (transversal)
```

Cada caixa acima é um domínio Clean-Architecture completo (`domain/<x>` + `application/<x>` + `infrastructure/<x>`), isolado dos demais por Ports — nunca um domínio importa a implementação de outro, só o tipo de retorno de um Port compartilhado quando estritamente necessário (ver `docs/contract-catalog.md` para o mapa completo, incluindo os poucos pontos de acoplamento direto encontrados na auditoria da Sprint 24).

### Domain Map — regra de composição entre domínios

O padrão usado, repetido de forma consistente desde a Sprint 08 (documentado formalmente em `docs/adr/0004-independent-domain-isolation.md`):

1. Cada domínio novo (Planning, Runtime, Execution, Publication, ...) nasce **totalmente independente** do pipeline legado (Arthur/Caio/Helena/Skills) — nunca uma refatoração dele, sempre um domínio irmão, verificado por um `check-<domínio>-isolation.mjs` dedicado.
2. A composição entre um domínio novo e o próximo do fluxo acontece por um **hook opcional e estreito** (uma interface local de 1-2 métodos, nunca importando o domínio de destino de dentro do domínio de origem) — ex.: `BriefingPlanningHook` (Briefing→Planning), `PlanningRuntimeHook` (Planning→Runtime). A implementação real do hook vive em `infrastructure/`, nunca em `application/`.
3. `undefined`/ausência do hook sempre reproduz o comportamento sem a integração seguinte — testado explicitamente em cada sprint que introduziu um hook novo.

### Fluxo completo (pedido pela Fase 4)

```
Conversation
  ↓ (usuário confirma um pedido de campanha)
Briefing (coleta progressiva, opcionalmente assistida por AI Gateway)
  ↓ (confirmação → PreparedCommand)
Planning (Arthur Planner traduz PreparedCommand → ExecutionGraph, 100% determinístico)
  ↓ (Planning "ready")
Runtime (PlanningExecutionTranslator: contratos de porta + bindings validados)
  ↓ (RuntimePlan "validated")
Execution (RuntimeTask → ExecutionTaskRun, dry_run ou real, gates de aprovação humana)
  ↓ (artefatos aprovados)
Scheduling (agendamento, calendário editorial, ocorrências recorrentes)
  ↓ (ocorrência devida)
Publication (outbox → dispatch → provider real/sandbox → recibo → reconciliação)
  ↓
Analytics (eventos de todo o funil → métricas, alertas, dashboard)
```

Evidência ao vivo desse fluxo (Conversation→Briefing→Planning→Runtime→Execution, testado nesta sprint contra um processo real; Publication→Scheduling→Analytics coberto pela suíte automatizada) está na Seção 12 (Smoke Tests) de `docs/sprint-24-final-report.md`.

---

## Pipeline legado (Sprints 01–07, CLI, `LOCAL_PRODUCTION`)

O Zuno foi desenhado como uma agência modular. A arquitetura separa identidade, orquestração, contratos, capacidades, infraestrutura e interfaces externas. Essa separação evita que uma Skill dependa diretamente de outra e impede que o orquestrador assuma responsabilidades operacionais.

A camada de domínio contém as regras mais estáveis do projeto: o conceito de Skill, manifesto, capacidade, fluxo e identidade organizacional. A camada de aplicação define como Arthur planeja, Helena gerencia Skills, Caio executa Workflows, Valentina administra clientes, Clara centraliza conhecimento, Ícaro centraliza comunicação com IA sem depender de provedores concretos, Quality Feedback registra avaliações humanas sobre execuções concluídas e expõe insights agregados, Campaign Manager organiza uma campanha completa a partir de um objetivo em texto, `ArtifactHostingPort` transforma artefatos locais em URLs públicas, `VisualAssetResolverPort`/`VisualAssetProviderPort` resolvem assets visuais reais por cena sem acoplar Skills a provedores e `SocialPublisherPort` abstrai publicação social. Quality Feedback (`src/application/quality-feedback`) não é uma Skill e nunca participa de um `ExecutionPlan` — é consultado pelo Eduardo como dependência opcional (mesmo padrão do `IcaroBrainPort`) e operado diretamente pela CLI depois que um workflow termina. Campaign Manager (`src/application/campaign`) também não é uma Skill e também nunca participa de um `ExecutionPlan` — mas, diferente de Quality Feedback, ele fica **acima** de Arthur: chama `ArthurTextCommandPlannerPort.planFromText` sob demanda, um conteúdo por vez, e é o único módulo de aplicação nesta base que convoca Arthur em vez de ser convocado por ele. Arthur deixou de decidir sozinho o formato final do conteúdo: essa decisão pertence à Skill Eduardo (capability `editorial_planning`), sempre a primeira etapa do plano — Arthur ainda decide, a partir do texto, apenas qual pipeline estrutural entra no plano (imagem ou vídeo), porque Caio executa um plano estático e não pode inserir ou remover etapas depois que uma Skill já rodou. A aplicação também possui o contrato de modo de execução (`LOCAL_PRODUCTION`) para que o relatório do workflow deixe claro se a execução é local ou futura produção externa. A camada de infraestrutura fica reservada para integrações futuras com provedores de IA, redes sociais, armazenamento, métricas, telemetria, hosting real de artefatos e providers externos de assets visuais; no `LOCAL_PRODUCTION`, nenhuma dessas integrações externas é acionada. As exceções deliberadas são locais, não externas: `VideoRenderingPort` (`src/application/ports/video-rendering.port.ts`), implementada por `FfmpegVideoRenderingAdapter` (`src/infrastructure/video-rendering/`), roda o FFmpeg localmente (nunca uma API de terceiros) para transformar o plano de edição de Diego em um MP4 real, e `VisualAssetResolverPort` (`src/application/ports/visual-asset-provider.port.ts`), implementada por adapters locais em `src/infrastructure/visual-assets/`, escolhe imagens reais por cena ou pausa para criação assistida — documentados em `docs/video-rendering.md` e `docs/visual-asset-resolver.md`. Rafa (Skill) só conhece as interfaces das portas, nunca os adaptadores ou qualquer detalhe do FFmpeg/biblioteca local, preservando o mesmo isolamento de Skills que todo o resto da arquitetura já impõe. A camada de interfaces concentra a experiência de uso local: a CLI aceita linguagem natural, não exige que o usuário cite Skills, usa `LOCAL_PRODUCTION` como padrão e gera uma página final padronizada em `artifacts/<executionId>/index.html` com preview, downloads reais, clipboard, estatísticas, validações, `caption.txt`, `hashtags.txt`, `metadata.json`, `execution-report.json` e relatório das Skills. Futuramente essa mesma camada poderá receber API própria e painel web. A pasta de Skills é o ponto de entrada para especialistas independentes: Eduardo, Especialista em Planejamento Editorial (decide formato, quantidade de slides/telas, duração de vídeo, emoção, estrutura narrativa, CTA, profundidade, complexidade e prioridade de conversão, sempre antes do João — documentado em `docs/eduardo-editorial-planning.md`), João, Especialista em Estratégia de Marketing, Maria, Especialista em Copywriting, Sofia, Especialista em Direção de Arte (conceito criativo, identidade visual, paleta, tipografia, moodboard, estilo e emoção — nunca layout), Bianca, Especialista em Design para Redes Sociais (grid, hierarquia visual, espaçamentos, componentes e sequência de slides, transformando a direção da Sofia em um briefing extremamente detalhado), Pedro, Especialista em Geração de Imagens — a primeira Skill a produzir um artefato visual real, o que exigiu evoluir o contrato de domínio `SkillArtifact` (documentado em `docs/pedro-image-generation.md`) de forma genérica, reutilizável por qualquer Skill futura, e que hoje apenas executa o briefing da Bianca sem tomar nenhuma decisão de design —, Lucas, Especialista em Revisão de Qualidade, que audita o pacote produzido pelas Skills anteriores antes da aprovação humana, e Ana, Especialista em Publicação Social, que em `LOCAL_PRODUCTION` valida e prepara payload local (`local_ready`) sem publicar, e em uma fase futura poderá exigir URLs públicas para publicação real através de `ArtifactHostingPort` + `SocialPublisherPort` (documentado em `docs/ana-social-publishing.md`, `docs/artifact-hosting.md` e `docs/social-publisher-port.md`).

Arthur deve operar com planos de execução. Um plano descreve intenção, etapas, dependências, entradas esperadas, saídas esperadas e critérios mínimos de aceitação. Cada Skill recebe somente a parte do contexto necessária para sua função. Uma Skill nunca deve acessar diretamente o estado completo da operação quando não precisar dele.

Ícaro deve operar como serviço de aplicação, não como infraestrutura. Ele conhece apenas portas de Providers de IA e devolve respostas padronizadas aos Especialistas. Providers concretos como OpenAI, Gemini, Claude ou modelos locais deverão existir apenas como Adapters de infraestrutura implementando `AIProviderPort`.

Clara deve operar como serviço de aplicação e Centro de Conhecimento. Ela conhece apenas uma porta de repositório e expõe `ClaraKnowledgePort` para consultas controladas. Especialistas não acessam arquivos, storage ou banco diretamente; eles recebem contexto por contrato.

Valentina deve operar como serviço de aplicação e Gerente de Clientes. Ela conhece apenas uma porta de repositório e expõe `ValentinaTenantPort`. Todo `ExecutionPlan` deve carregar contexto de cliente, e Caio deve validar esse contexto antes de iniciar qualquer workflow.

O crescimento para múltiplos clientes, múltiplas redes sociais, múltiplos modelos de IA e SaaS deverá ocorrer por substituição ou adição de adaptadores, não por alteração do domínio central. O domínio não deve importar infraestrutura. A aplicação deve depender de portas. A infraestrutura deve implementar portas. Interfaces externas devem chamar casos de uso ou orquestrações, nunca acessar provedores diretamente.

O processo de build que transforma uma Skill em `src/skills` em algo que Helena descobre de verdade em `dist/skills` está detalhado em `docs/skills-build-and-discovery.md`.
