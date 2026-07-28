# Maria, Especialista em Copywriting

Maria é a primeira Especialista real do Zuno. Ela é uma Skill de Copywriting e possui responsabilidade exclusiva pela criação de textos de marketing a partir de briefings estruturados.

Maria não cria imagens, vídeos, campanhas, publicações ou análises de métricas. Maria não conversa diretamente com Meta, Facebook, Instagram, OpenAI, Gemini, Claude ou qualquer outro provedor concreto. Ela conhece apenas a abstração `IcaroBrainPort`, porque toda comunicação com Inteligência Artificial passa obrigatoriamente pelo Ícaro.

## Responsabilidade

Maria transforma um briefing estruturado em uma copy estruturada. Ela interpreta objetivo, canal, público-alvo, tom de voz, CTA, mensagem-chave, limitações da plataforma, palavras-chave e termos proibidos. Depois constrói uma estratégia de copy, monta um prompt, solicita ao Ícaro uma tarefa `text_generation`, avalia a qualidade da resposta padronizada e, se necessário, refina automaticamente o prompt para novas tentativas.

## Contrato de entrada

A entrada de Maria é `MariaCopyBriefing`. Ela exige objetivo, canal, público-alvo, tom de voz, CTA e mensagem-chave. Campos adicionais como produto, oferta, limitações da plataforma, palavras-chave, termos proibidos (`forbiddenTerms`), palavras obrigatórias da marca (`mandatoryWords`) e hashtags preferidas da marca (`preferredHashtags`) são opcionais — quando presentes, viram restrições explícitas no prompt enviado ao Ícaro (`Incluir obrigatoriamente: ...` e `Priorizar estas hashtags da marca: ...`) e critério adicional de qualidade.

## Contrato de saída

Maria nunca devolve apenas texto. Ela devolve `MariaCopywritingOutput`, contendo título, legenda, CTA, hashtags, palavras-chave, resumo, objetivo, tom utilizado, público identificado, sugestões futuras, observações, relatório de qualidade, tentativas realizadas e indicação se a entrega foi best effort.

## Fluxo interno

O fluxo interno possui briefing recebido, criação de estratégia, construção de prompt, solicitação ao Ícaro, parse de JSON estruturado, autoavaliação de qualidade, eventual nova tentativa com ajustes e entrega final.

## Critérios de qualidade

Maria avalia presença de título, legenda e CTA, tamanho adequado para a plataforma, força do CTA, consistência de tom, repetição excessiva, hashtags duplicadas, excesso de hashtags, termos proibidos, ausência de palavra obrigatória da marca (`MISSING_MANDATORY_WORD`, severidade alta) e riscos básicos de gramática, ortografia ou pontuação. Essa validação é heurística nesta fase e poderá evoluir para uma etapa específica de revisão no futuro.

## Tentativas

Maria possui política padrão de três tentativas. Se a primeira tentativa falhar na qualidade, ela transforma os problemas encontrados em instruções no prompt seguinte. Se nenhuma tentativa atingir a qualidade mínima, Maria devolve a melhor copy obtida com warnings e relatório de pontos a melhorar. Se o Ícaro falhar em todas as tentativas sem produzir copy aproveitável, Maria retorna falha estruturada.

## Integração com Arthur, Caio e Helena

Arthur não conhece Maria diretamente; ele cria planos com capability `copywriting`. Caio executa o plano e pede para Helena executar a capability. Helena encontra Maria pelo manifesto, carrega a Skill e executa Maria. Maria recebe somente o briefing da etapa, chama Ícaro quando precisa de IA e devolve uma saída estruturada para Caio continuar o workflow.
