# Ícaro, AI Brain do Zuno

Ícaro é o cérebro responsável por toda comunicação entre Especialistas do Zuno e qualquer Inteligência Artificial. Ele não é uma Skill, não é um Especialista e não participa diretamente do Workflow executado por Caio. Sua função é atuar como uma camada central de decisão, controle e padronização para chamadas de IA.

## Responsabilidade

Ícaro recebe solicitações de IA vindas exclusivamente de Especialistas. Arthur não conversa com Ícaro, Helena não conversa com Ícaro e Caio não conversa com Ícaro. Essa decisão mantém a cadeia de responsabilidades limpa: Arthur planeja, Helena gerencia Skills, Caio executa Workflows e os Especialistas executam tarefas específicas. Quando uma tarefa especializada precisa de IA, o Especialista chama o `IcaroBrainPort`.

## Fluxo interno

O fluxo do Ícaro começa com uma `IcaroAIRequest`, contendo tipo da tarefa, prompt, Especialista solicitante, contexto de execução, restrições, formato esperado e preferências como qualidade, velocidade ou custo. O Ícaro valida a entrada, registra log de recebimento, emite `AIRequestStarted`, consulta a política de seleção de Providers, escolhe Provider e Modelo, monta a requisição padronizada para o Provider, aplica timeout, executa a chamada, normaliza tokens, calcula custo, registra consumo, emite eventos e devolve uma `IcaroAIResponse`.

## Tipos de tarefa

A arquitetura já reconhece `text_generation`, `image_generation`, `analysis`, `classification`, `summary`, `translation` e `review`. Algumas dessas tarefas ainda não possuem Especialistas reais, mas os contratos já estão preparados para que novos Especialistas usem o mesmo caminho sem alterar a arquitetura central.

## Providers e Adapters

Ícaro depende apenas de `AIProviderPort`. Ele não importa OpenAI, Gemini, Claude, DeepSeek, Grok, Ollama ou qualquer SDK concreto. Cada provedor real deverá ser implementado futuramente como Adapter de infraestrutura, expondo um `AIProviderProfile` com modelos, tarefas suportadas, prioridade, custo, qualidade e velocidade. O núcleo do Ícaro permanece isolado de detalhes externos.

## Seleção de Provider e Modelo

A primeira versão utiliza `DeterministicIcaroProviderSelectionPolicy`. A política filtra Providers habilitados que suportam a tarefa solicitada, filtra modelos compatíveis, calcula um score com prioridade, qualidade, velocidade e custo e devolve candidatos ordenados. Hoje a decisão é simples e determinística; futuramente essa política poderá evoluir para análise histórica, orçamento por cliente, limite de latência, reputação do Provider, roteamento por idioma ou regras por tipo de campanha.

## Retry

Ícaro possui `IcaroRetryPolicy`. A política padrão tenta até duas vezes por Provider para falhas temporárias, timeout e rate limit. Falhas não recuperáveis, como requisição inválida, não são repetidas. Cada retry gera log `RetryScheduled` e evento `AIRetry`.

## Fallback

Ícaro possui `IcaroFallbackPolicy`. Quando um Provider falha após suas tentativas e há outros Providers compatíveis, Ícaro tenta o próximo candidato. Cada fallback gera log `FallbackStarted` e evento `AIFallback`. A resposta final informa `fallbackUsed`, permitindo que Especialistas e relatórios saibam se a entrega dependeu de um provedor alternativo.

## Timeout

Toda chamada enviada ao Provider usa `timeoutMs`, definido pela solicitação do Especialista ou por configuração padrão. Quando o timeout é atingido, Ícaro classifica a falha como `timeout`, registra log `Timeout`, permite retry quando a política autoriza e, se necessário, aciona fallback.

## Custos e consumo

Ícaro normaliza tokens de entrada, saída e total. Se o Provider não devolver tokens, o Ícaro estima o consumo pelo tamanho do prompt e do conteúdo. O custo estimado usa o perfil do modelo, com custo por mil tokens de entrada e saída. Quando o Provider informar custo real, a resposta mantém esse dado. O consumo é registrado por `IcaroCostLedgerPort`, contendo Especialista, tarefa, Provider, Modelo, execução, duração, tokens, custo e status.

Em evolução futura, Ícaro poderá consultar Valentina por `ValentinaTenantPort` antes de chamar Providers para validar plano, orçamento, limite diário, limite mensal e preferência de IA do cliente. Ícaro não deve alterar informações do cliente diretamente; qualquer consumo consolidado deve passar por Valentina.

## Cache

A estrutura de cache foi preparada por `AIRequestCachePort` e `IcaroCachePolicy`, mas o cache real ainda não foi ativado. Essa decisão evita comportamento invisível nesta fase local e mantém a arquitetura pronta para reutilização controlada de respostas no futuro.

## Resposta padronizada

Todos os Especialistas recebem `IcaroAIResponse`, sempre com status, Provider, Modelo, duração, tokens, custo, conteúdo, warnings, tentativa utilizada, indicação de fallback e erro estruturado quando houver falha. Isso impede que cada Especialista precise entender formatos diferentes de OpenAI, Gemini, Claude ou qualquer outro provedor.

## Integração com Especialistas

Especialistas chamam exclusivamente `IcaroBrainPort`. Eles não recebem `AIProviderPort`, não conhecem Adapter concreto e não importam SDK de IA. Maria já foi adaptada para esse padrão: ela monta a estratégia e o prompt de copy, solicita ao Ícaro uma tarefa `text_generation`, recebe resposta padronizada e continua sua própria validação de qualidade.
