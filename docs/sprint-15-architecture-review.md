# Sprint 15 — Revisão Arquitetural Antes de Código

Esta revisão cobre a Fase 1 do Prompt 15. Nenhuma implementação funcional do domínio
`Publication` deve começar antes da aprovação explícita desta revisão.

## Estado Atual

Fluxo atual aprovado até a Sprint 14:

`Conversation -> Briefing -> PreparedCommand -> Planning -> Runtime -> Execution -> Handler Resolver -> Skills reais -> ExecutionArtifacts`

O `Execution Engine` executa handlers reais controlados, valida contratos formais, aplica
`SideEffectGuard`, circuit breaker, timeout e observabilidade. A publicação real segue bloqueada:
`distribution` produz apenas um manifesto de publicação com `publishMode: "dry_run"` e side effect
`publication_preview`.

## Itens Revisados

Foram revisados os pontos arquiteturais relevantes:

- `ExecutionArtifact` como resultado persistido de uma task, com schema, checksum, lineage, tenant,
  workspace, provider e handler.
- `Distribution Handler`, que chama Ana apenas em modo `dry_run` e converte resposta de Skill em
  artifact de Execution.
- `SideEffectPolicy`, especialmente a distinção entre `publication_preview` e `publication`.
- `Runtime`, que declara tarefas, portas, bindings e expectativas de artefato, mas não executa side
  effects.
- `Execution`, que resolve handlers, executa DAG, valida contratos e produz artifacts, mas não deve
  conhecer `PublicationPlan`.
- `Approval Gate` de Execution, que aprova conteúdo/continuação de DAG, não autorização operacional
  para publicar.
- Artefatos produzidos por research, strategy, copy, visual e distribution.
- Skill Ana, que hoje contém regras de publicação e um caminho real por `SocialPublisherPort`, mas
  permanece chamada por Execution somente com `publishMode: "dry_run"`.
- Canais existentes no contrato social: `instagram`, `facebook`, `threads`, `linkedin`, `tiktok`,
  `pinterest`, `youtube` e `google_business`, com Ana restrita atualmente a Instagram/Facebook.

## Responsabilidades Que Permanecem Em Execution

Execution deve continuar responsável por:

- iniciar um `ExecutionRun` a partir de `RuntimePlan` validado;
- executar tarefas do DAG por handlers resolvidos;
- validar inputs e outputs contra contratos formais;
- produzir `ExecutionArtifact` imutável;
- resolver bindings entre artifacts de Execution;
- registrar attempts, events, traces, handler resolution e falhas;
- aplicar retry, timeout e circuit breaker de handlers;
- bloquear side effects não permitidos durante execução;
- expor evidência de lineage e observabilidade da execução.

Execution não deve:

- decidir se conteúdo será publicado;
- criar plano de publicação;
- aprovar publicação operacional;
- escolher provider de rede social;
- chamar `PublicationProviderPort`;
- armazenar receipts de publicação;
- reconciliar resultado externo;
- executar rollback/compensação de publicação.

## Responsabilidades Que Pertencem A Publication

Publication deve ser um domínio separado, responsável por:

- criar `PublicationPlan` exclusivamente a partir de `ExecutionArtifact`;
- materializar `PublicationCandidate`, `PublicationTarget` e conteúdo publicável;
- validar política de publicação por tenant/workspace/canal/provider;
- exigir e registrar `PublicationApproval` quando aplicável;
- selecionar provider por canal e política;
- chamar providers por `PublicationProviderPort`;
- controlar idempotência de publicação;
- registrar `PublicationAttempt`, `PublicationReceipt`, `PublicationFailure` e eventos;
- aplicar retry apenas a falhas transitórias;
- cancelar antes de publicar quando ainda não houver side effect irreversível;
- reconciliar receipts externos futuramente;
- modelar rollback apenas como capacidade declarada, não executada nesta sprint.

Publication não deve:

- executar RuntimeTask;
- resolver RuntimeBinding;
- revalidar o DAG;
- chamar Helena diretamente;
- chamar Skills;
- alterar `ExecutionRun`, `ExecutionTaskRun` ou `ExecutionArtifact`;
- buscar dados em Runtime como fonte primária;
- publicar a partir de artifacts sem lineage, checksum e tenant/workspace consistentes.

## Diferença Entre Approval De Execution E Approval De Publication

O gate de Execution aprova o conteúdo produzido ou a continuação do DAG. Ele responde à pergunta:

> Este conteúdo/resultado pode avançar na execução?

`PublicationApproval` aprova um side effect operacional. Ele responde à pergunta:

> Este conteúdo específico, nestes canais, com esta política e provider, pode ser enviado para fora?

Essas aprovações não são intercambiáveis. Uma aprovação de conteúdo não autoriza publicação real.
Uma aprovação de publicação deve referenciar o plano/candidato alvo, o aprovador, timestamp, motivo e
observações.

## ExecutionArtifacts Como Fonte De PublicationPlan

O `PublicationPlan` deve nascer de artifacts, nunca de Runtime:

`ExecutionArtifact[] -> PublicationPlan -> PublicationCandidate[] -> PublicationTarget[]`

Motivos:

- Runtime contém intenção e contrato esperado, não resultado produzido.
- ExecutionArtifact contém payload validado, checksum, producer, handler, provider e lineage.
- O mesmo Runtime pode gerar artifacts diferentes em runs diferentes; Publication precisa apontar
  para artifacts concretos.
- Reexecuções e retries só são auditáveis se o plano de publicação referencia artifacts imutáveis.

Validações mínimas na criação do plano:

- todos os artifacts pertencem ao mesmo tenant e workspace;
- todos os artifacts pertencem a runs concluídos ou em estado permitido pela política;
- checksums conferem;
- schemaId/schemaVersion são aceitos pela política de publicação;
- canais solicitados são suportados;
- assets possuem payload ou referência publicável;
- nenhum artifact é buscado apenas por tipo.

## Side Effects Irreversíveis

São considerados irreversíveis ou operacionalmente sensíveis:

- criação de publicação externa em rede social;
- agendamento externo em provider;
- upload/hospedagem pública de asset;
- alteração de status visível ao público;
- exclusão ou substituição de publicação já emitida;
- criação de URL pública indexável;
- envio de payload contendo conteúdo de cliente para provider externo.

Nesta Sprint 15, a publicação real em redes sociais continua fora de escopo. `FakePublicationProvider`
e `DryRunPublicationProvider` devem produzir receipts sintéticos sem rede.

## Riscos De Misturar Execution E Publication

1. **Quebra de fronteira de domínio:** Execution passaria de executor de DAG para orquestrador de
   operações externas.
2. **Aprovação ambígua:** um gate de conteúdo poderia ser interpretado como autorização para publicar.
3. **Idempotência fraca:** retries de task poderiam chamar provider externo duas vezes.
4. **Auditoria incompleta:** receipts externos ficariam misturados com artifacts internos.
5. **Rollback ilusório:** cancelar Execution poderia sugerir reversão de publicação já enviada.
6. **Acoplamento com Ana:** Publication ficaria dependente da Skill em vez de um provider port
   próprio.
7. **Busca incorreta por artifact:** plano poderia ser criado por tipo/schema, não por artifact id,
   checksum e lineage.
8. **Violação de tenant/workspace:** artifact de um run poderia alimentar publicação de outro escopo.
9. **Reuso indevido do SideEffectGuard:** guard de Execution bloquearia ou permitiria publicação por
   critérios que não representam política operacional de publicação.
10. **Dificuldade de reconciliação:** providerPublicationId, status externo e URL não pertencem ao
    ciclo de vida de Execution.

## Riscos Do Caminho Legado De Ana

Ana já sabe montar payload e chamar `SocialPublisherPort` em `publish_now` ou `schedule`, mas esse
caminho não deve ser usado diretamente por Execution para publicação operacional.

Riscos se Ana for conectada como mecanismo de Publication nesta sprint:

- Helena/Skill continuaria no caminho crítico do side effect, contrariando a separação proposta.
- Regras de publicação ficariam dentro de uma Skill, não em `PublicationPolicy`.
- Receipts seriam derivados do output da Skill, não de uma entidade imutável de Publication.
- Idempotência ficaria fora do provider boundary.
- Agendamento e publicação real poderiam vazar por input incorreto.

Estratégia recomendada: reutilizar conceitos do contrato social apenas como referência de canal,
draft e resultado, mas criar `PublicationProviderPort` próprio no domínio/application de
Publication. Ana pode continuar existindo para pipelines legados, mas não deve ser chamada pelo novo
`PublicationEngine`.

## Estratégia De Rollback

Rollback deve ser modelado de forma honesta:

- antes de chamar provider: cancelamento simples muda estado para `cancelled`;
- após tentativa dry run/fake: não há side effect externo, então não há compensação necessária;
- após publicação real futura: não assumir rollback automático;
- `rollbackSupported` deve ser uma capacidade declarada por policy/provider;
- receipts nunca devem ser apagados;
- uma falha de compensação futura deve gerar novo evento/failure, não reescrever receipt;
- superseded deve criar novo plano/candidato, não mutar histórico publicado.

Para Sprint 15, rollback real não deve ser implementado.

## Política Recomendada Para Sprint 15

Decisões recomendadas antes do código:

1. Criar domínio `Publication` sem dependência de `Execution` no nível de tipos de domínio.
2. Criar use case/application que aceita `executionArtifactIds` como entrada e carrega artifacts por
   porta, mantendo a dependência em application, não no domínio.
3. Manter `publishMode` padrão como `dry_run`.
4. Implementar apenas `FakePublicationProvider` e `DryRunPublicationProvider`.
5. Não usar `MetaInstagramSocialPublisherAdapter` nesta sprint.
6. Exigir aprovação operacional antes de `publish` quando `requireApproval=true`.
7. Tratar rejeição/cancelamento como estados próprios de Publication, sem alterar Execution.
8. Persistir receipts de forma append-only.
9. Usar idempotência por `publicationId + idempotencyKey`.
10. Separar métricas/events de Publication das métricas/events de Execution.

## Contratos Iniciais Sugeridos

Tipos de domínio:

- `PublicationPlan`: plano agregado criado a partir de artifacts.
- `PublicationCandidate`: peça publicável extraída do plano.
- `PublicationTarget`: canal/provider/modo para um candidate.
- `PublicationApproval`: decisão operacional explícita.
- `PublicationAttempt`: tentativa de publicar um target.
- `PublicationReceipt`: prova imutável do resultado do provider.
- `PublicationFailure`: falha classificada.
- `PublicationPolicy`: regras de modo, canais, providers, retry e aprovação.
- `PublicationState`: ciclo de vida independente.

Estados:

- `draft`
- `waiting_for_approval`
- `approved`
- `publishing`
- `published`
- `failed`
- `cancelled`
- `superseded`

Falhas:

- `timeout`
- `provider_unavailable`
- `rate_limited`
- `policy_violation`
- `authentication`
- `invalid_content`
- `approval_missing`
- `internal`

Retry automático apenas para `timeout`, `provider_unavailable` e `rate_limited`.

## Persistência Recomendada

Tabelas:

- `publication_plans`
- `publication_candidates`
- `publication_targets`
- `publication_attempts`
- `publication_receipts`
- `publication_events`
- `publication_approvals`
- `publication_failures`

Regras:

- operações de mudança de estado dentro de transação;
- optimistic locking em `publication_plans`;
- receipts append-only;
- constraint para idempotência de publish;
- tenant/workspace obrigatórios em todas as entidades;
- índices por tenant/workspace/state;
- correlação com artifacts por ids explícitos, sem FK direta obrigatória no domínio puro.

## API Recomendada

Endpoints pedidos:

- `GET /v1/publications`
- `GET /v1/publications/:id`
- `POST /v1/publications`
- `POST /v1/publications/:id/approve`
- `POST /v1/publications/:id/publish`
- `POST /v1/publications/:id/cancel`
- `GET /v1/publications/:id/receipts`

Permissões:

- `publication:read`: owner, admin, editor e viewer.
- `publication:create`: owner, admin e editor.
- `publication:approve`: owner e admin.
- `publication:publish`: owner e admin.
- `publication:cancel`: owner e admin.

`editor` pode preparar publicação, mas não aprovar nem publicar. `viewer` apenas consulta.

## Frontend Recomendado

Criar módulo `Publication` separado de `Execution`.

Exibir:

- plano;
- candidates;
- targets/canais;
- política;
- approval;
- estado;
- provider;
- attempts;
- receipts;
- events;
- indicação clara de `dry_run`.

Ações:

- criar publicação;
- aprovar;
- publicar;
- cancelar.

Não exibir botões de publicação real quando policy/provider estiver em `dry_run`.

## Guardas Arquiteturais Recomendadas

Adicionar uma guarda separada para garantir que:

- domínio `Publication` não importe `Execution`;
- aplicação `Publication` não importe Helena, Skills, AI Gateway ou SDK externo;
- providers reais fiquem apenas em infraestrutura;
- `Execution` não importe `Publication`;
- nenhum endpoint chama provider diretamente;
- `FakePublicationProvider` e `DryRunPublicationProvider` não usam `fetch`, SDK externo ou rede.

## Estratégia Recomendada Após Aprovação

Sequência de implementação de menor risco:

1. Criar domínio puro `src/domain/publication`.
2. Criar portas application: repository e provider.
3. Criar engine/use cases sem dependência de infraestrutura.
4. Criar repositório em memória.
5. Criar migration e repositório Postgres.
6. Criar `DryRunPublicationProvider` e `FakePublicationProvider`.
7. Criar rotas REST com RBAC.
8. Criar guard arquitetural de isolamento.
9. Criar frontend mínimo.
10. Cobrir testes unitários, API, RBAC, idempotência, retry, receipts e isolamento.

## Pontos Que Precisam De Aprovação

Antes de implementar código, recomendo aprovar explicitamente:

1. Publication nasce de `ExecutionArtifact` por ids explícitos, nunca de Runtime.
2. `PublicationApproval` é obrigatório para publish quando `requireApproval=true`, mesmo que o
   Execution gate já tenha sido aprovado.
3. Sprint 15 usa somente providers fake/dry run, sem Meta, rede ou scheduling.
4. Receipts são append-only e nunca removidos.
5. `editor` pode criar plano, mas apenas `owner/admin` aprovam, publicam e cancelam.
6. Rollback real fica fora da sprint; apenas política/capacidade é modelada.
7. `Publication` não chama Ana/Helena; conceitos de canal/draft podem ser reaproveitados, mas o
   engine novo usa `PublicationProviderPort`.

Sem essas decisões, a implementação corre risco de reintroduzir publicação como side effect de
Execution ou de transformar aprovação de conteúdo em autorização operacional.
