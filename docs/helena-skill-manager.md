# Helena, a Gerente de Skills

Helena é a gerente da equipe de especialistas do Zuno. Ela não é uma Skill e não executa tarefas de marketing por conta própria. Sua função é descobrir, validar, carregar, registrar, localizar e executar Skills quando Arthur solicitar.

Arthur nunca deve conhecer uma Skill concreta. Arthur cria planos. Quando uma etapa do plano precisar ser executada no futuro, Arthur deverá pedir para Helena executar uma capability. Helena consulta o Registry, encontra uma Skill pronta com aquela capability e executa somente essa Skill.

## Descoberta automática

A descoberta é feita por uma porta chamada `SkillDiscoveryPort`. A implementação local `FileSystemSkillDiscovery` procura arquivos `skill.manifest.json` dentro dos diretórios configurados. Diretórios iniciados com `_` são ignorados por padrão para evitar carregar templates. A descoberta retorna fontes de Skill com localização, manifesto bruto e caminho do módulo de execução quando informado pelo manifesto.

Helena não conhece `src`. Ela só sabe procurar `skill.manifest.json` e importar o entrypoint compilado (`./index.js`) a partir de um diretório de Skills já **buildado**. Por isso, `FileSystemSkillDiscovery` e `FileSystemSkillModuleLoader` devem sempre apontar para `dist/skills`, nunca para `src/skills` — o processo completo de build e cópia de manifestos está descrito em `docs/skills-build-and-discovery.md`.

## Validação

Antes de carregar uma Skill, Helena usa `SkillManifestValidator`. O manifesto precisa conter id, nome, versão, descrição, autor, capabilities, inputs, outputs, dependencies, status, enabled, compatibility, runtime, responsibilityBoundary e owner `helena-managed`. Se qualquer campo obrigatório estiver ausente ou inválido, a Skill é marcada como `FAILED`, registrada no Registry e não é carregada.

## Registry

O Registry mantém todos os registros descobertos. Uma Skill pode estar em `DISCOVERED`, `LOADED`, `READY`, `RUNNING`, `WAITING`, `COMPLETED`, `FAILED` ou `DISABLED`. Helena é a única responsável por mudar esses estados. Arthur não acessa o Registry diretamente.

## Execução

Helena só aceita solicitações com `requestedBy: "arthur"`. Ao executar, ela localiza uma Skill por capability, registra logs, emite eventos preparados para o futuro e chama a Skill com contexto `requestedBy: "helena"` e `orchestratedBy: "arthur"`. Dessa forma, a Skill sabe que quem a chamou foi Helena, e não outra Skill.

Helena poderá consultar Valentina para validar quais Especialistas estão habilitados para um cliente antes de executar uma capability. Essa validação deve ocorrer por `ValentinaTenantPort`, nunca por acesso direto ao armazenamento de tenants.

## Eventos

A estrutura já contém contratos para eventos como `ExecutionStarted`, `ExecutionFinished`, `SkillStarted`, `SkillFinished`, `SkillFailed` e `ExecutionCancelled`. Ainda não existe Event Bus completo. Hoje existe apenas um recorder em memória para testes e evolução futura.

## Logs

Toda ação relevante da Helena deve gerar logs: Skill descoberta, Skill ignorada, manifesto inválido, capability encontrada, capability ausente, execução iniciada, execução concluída, erro e mudança de estado.
