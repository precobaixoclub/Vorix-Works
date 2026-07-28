# Protocolo de comunicação entre Arthur e Skills

A comunicação entre Arthur e as Skills deverá ser assíncrona do ponto de vista arquitetural, mesmo que inicialmente seja executada localmente e em memória. Arthur cria um plano, divide o trabalho em etapas e envia para cada Skill uma solicitação objetiva contendo identificador da execução, identificador da tarefa, contexto mínimo, entrada necessária e formato esperado de resposta.

Cada Skill responde com status, artefatos gerados, avisos, erros recuperáveis e saída estruturada. A resposta nunca deve depender de efeitos colaterais invisíveis. Se uma Skill criar um texto, imagem, análise ou plano, isso deverá voltar como artefato ou saída formal. Se uma Skill precisar de recurso externo no futuro, ela deverá usar uma porta da camada de aplicação, implementada pela infraestrutura.

Skills não se chamam diretamente. Se uma Skill precisar de algo produzido por outra, ela deve declarar essa necessidade no contrato ou devolver uma solicitação de dependência para Arthur. Arthur decide se outra Skill será acionada.

Arthur nunca deve interpretar detalhes internos de implementação de uma Skill. Ele deve confiar no contrato, no manifesto, nas capacidades declaradas e nos critérios de aceitação.

Todo workflow deve iniciar associado a um cliente. Arthur deve receber `clientId` ou `tenantId` e, quando Valentina estiver disponível, consultar `ValentinaTenantPort` para resolver o contexto do cliente antes de criar o `ExecutionPlan`. Caio deve validar o contexto do cliente antes de executar o plano.

Quando uma Skill Especialista precisar de Inteligência Artificial, ela deverá conversar exclusivamente com Ícaro por `IcaroBrainPort`. Nenhuma Skill poderá receber ou importar Provider concreto, SDK externo ou Adapter de infraestrutura de IA. Ícaro será responsável por selecionar Provider e Modelo, aplicar timeout, retry, fallback, controle de custos, logs, eventos e devolver resposta padronizada.

Quando uma Skill Especialista precisar de conhecimento sobre cliente, marca, campanha, produto, identidade, público, histórico ou preferências, ela deverá consultar exclusivamente Clara por `ClaraKnowledgePort`. Nenhuma Skill deverá acessar arquivos, storage local, banco de dados ou manter base própria de conhecimento do cliente.
