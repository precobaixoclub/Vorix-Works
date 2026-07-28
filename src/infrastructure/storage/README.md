# Infraestrutura de armazenamento

Contém adapters de armazenamento. Nesta fase existe persistência local simples para Clara por `LocalJsonClaraKnowledgeRepository`, além de `InMemoryClaraKnowledgeRepository` para testes e execução efêmera. Também existe persistência local de tenants para Valentina por `LocalJsonValentinaTenantRepository`, além de `InMemoryValentinaTenantRepository`.

Nenhum Especialista deve acessar esses adapters diretamente. O acesso ao conhecimento acontece por `ClaraKnowledgePort`, e o acesso ao cliente acontece por `ValentinaTenantPort`.
