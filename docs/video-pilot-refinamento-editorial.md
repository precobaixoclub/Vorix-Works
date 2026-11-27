# Refinamento editorial do motor de vídeos Vorix

O piloto anterior acertou quando cada plano provava uma parte do benefício, como na demonstração da Vorix. Na CMKV, a abertura, as opções e a contagem repetiam o mesmo tipo de imagem e confundiam a resposta. No Rumo ao Altar, a composição vertical sacrificava a legibilidade da função anunciada. O refinamento concentra o trabalho nessas decisões de direção e no controle do enquadramento.

## Diagnóstico das peças anteriores

A análise usou os MP4s, as pranchas, os rascunhos do Codex, os planos disponíveis e os pareceres do [piloto anterior](../artifacts/video-pilot/final/resultado3/relatorio.json). O detector de congelamento foi usado com amostras a 4 quadros por segundo, imagem reduzida a 128 px, limiar de −46 dB e duração mínima de 0,6 s. Ele sinaliza trechos quase imóveis no quadro inteiro. Um trecho sinalizado pode ser uma pausa de leitura útil.

### CMKV Wears

| Cena de `video-a-v2b.mp4` | O que acontece no MP4 | Ajuste executável |
| --- | --- | --- |
| 1. A pergunta e a lupa | A foto de fundo já mostra o desenho da resposta. A lupa amplia principalmente tecido liso e parte do cabelo. | Abrir com um recorte pequeno do traço real, sem a foto inteira por trás. |
| 2. A, estampa 000037 | O produto tem boa leitura, mas o painel preto ocupa cerca de 40% do quadro, com pouco além do código. | Manter a foto original e reduzir o texto à identificação necessária para votar. |
| 3. B, estampa 000043 | A opção B troca a estampa e repete proporção, posição e ritmo da A. Tem a mesma função visual por toda a cena. | Fazer a chegada da B ter outro enquadramento ou movimento e preservar a cor das opções. |
| 4. Contagem em 3 | A mudança para a foto turquesa apresenta uma variante sem contexto. A lupa e a camiseta competem com o número. | Usar a pista já apresentada como âncora visual da contagem. |
| 5. Contagem em 2 | Volta o painel da cena 3, agora com pouco texto e sem informação nova sobre B. | Integrar a contagem às opções, com os números em área livre. |
| 6. Contagem em 1 | O produto some e fica um número pequeno num campo escuro. O detector marca aproximadamente 11–12,5 s. | Voltar brevemente ao próprio recorte antes do corte para a revelação. |
| 7. Revelação | A estampa corresponde à A, mas a camiseta passa de marinho a turquesa. A moldura e o fundo desfocado reduzem o destaque do desenho. | Revelar o mesmo arquivo da pista em plano mais aberto, com a peça inteira. |
| 8. Chamada final | Logo e chamada estão legíveis, mas a foto desaparece e a pergunta volta depois de respondida. O detector marca aproximadamente 15,25–16,75 s. | Fechar com a peça ainda em cena e um próximo passo coerente com o quiz. |

A refação pontual D1 manteve esses enquadramentos. A refação ampla D2 condensou oito cenas em cinco, preservou a lupa imprecisa e voltou a trocar a variante na revelação. O parecer sinalizou repetição da opção B e do fechamento. O resumo criativo da D2 cita 8,5 s, mas o MP4 arquivado, conferido pelo hash do relatório original, dura 17 s.

### Vorix

| Cena de `video-b-v1.mp4` | O que sustenta a peça | Ajuste de preservação |
| --- | --- | --- |
| 1. Troca de atendente | A pergunta e a resposta curta colocam uma dor reconhecível nos primeiros dois segundos. | Manter a promessa imediatamente legível. |
| 2. Atendimento pelo WhatsApp | A captura inteira no notebook localiza a função e o contexto da conversa. Em celular, o texto da interface é pequeno nesse plano geral. | Reservar a visão geral para contexto. |
| 3. Nota interna e transferência | O close da tela real deixa a nota e o registro da troca reconhecíveis. | Enquadrar as bordas do componente e manter legíveis os dados relevantes. |
| 4. Conversa retomada | A resposta recupera a compra e a entrega. A semelhança de composição com a cena 3 é compensada pela continuidade da demonstração. | Cortar entre evidência e resultado onde a informação muda. |
| 5. Benefício | O retorno à captura ampla e o texto “A conversa continua de onde parou” sintetizam o fluxo. | Manter o resultado ligado ao que acabou de ser mostrado. |
| 6. Chamada final | O roxo e a marca dão unidade. “Conheça a Vorix” é uma próxima ação legível. | Preservar a assinatura e manter a chamada na tela tempo suficiente para leitura. |

O Codex aprovou a versão original. A mudança de plano geral para close e depois para síntese demonstra um benefício concreto. A abertura e o final têm pausas visuais, aceitáveis pela função de leitura naquela peça.

### Rumo ao Altar

| Cena de `video-c-v2.mp4` | O que levou ao ajuste | Correção executável |
| --- | --- | --- |
| 1. Presentes no Pix | O benefício é claro, mas a cartela bordô segura o início por cerca de 4,5 s antes da fala e da demonstração. | Aproximar o início da fala ao gancho. Combinar a promessa com o primeiro plano da função. |
| 2. Lista de presentes | Na v1, a captura inteira forma uma faixa estreita. Na v2, o preenchimento vertical corta as bordas e a descrição da função. | Reenquadrar a região original do cartão e exibir todo o conteúdo selecionado, acompanhando a fala. |
| 3. Site e planos | A rolagem dá contexto, mas títulos, legendas e capturas concorrem pela atenção. A tela de preços ocupa parte do trecho sobre criar o site. | Escolher um bloco de fala completo, manter a tela pertinente e retirar título redundante. |
| 4. Chamada final | A assinatura e “Crie o seu site” aparecem com clareza. A fala acaba por volta de 18,57 s e ainda ficam quase 5 s de cartela. | Fechar perto do fim da ideia falada e manter tempo de leitura suficiente. |

## Mudanças implementadas

- O prompt do Codex muda com o tipo de material e a intenção da pauta. Para produto, pede pista, apresentação e revelação coerentes com a variante original. Para captura de software, pede contexto, componente legível e resultado. Para fala, prioriza a afirmação inicial, os trechos completos em ordem e a relação entre narração e imagem.
- O recorte recebe um retângulo normalizado da fonte. O plano valida seus limites e o FFmpeg mantém visível toda a região escolhida com proporção original. O recurso serve tanto para uma estampa quanto para um componente de interface em movimento. Em fotos, a janela pode abrir continuamente para expor o restante do detalhe. A contagem sobreposta distribui os três números na mesma tomada.
- A composição de entrada de produto usa a foto inteira numa camada separada sobre a cor da marca. A foto entra com opacidade e posição animadas. O texto fica numa faixa própria e pode continuar no mesmo plano que a peça.
- A prancha tem três quadros por cena. O Codex avalia gancho, legibilidade, marca, fidelidade, aparência de apresentação, variedade de movimento e de composição, destaque do assunto, progressão e CTA. Um critério falso bloqueia a aprovação. Parecer incompleto fica inconclusivo.
- Para gravações, o worker entrega a prancha da fonte junto com as frases transcritas. O diretor usa as imagens para casar fala e tela, e a refação reaproveita essas referências e os identificadores das frases. O escopo da refação e a validação técnica continuam exigidos para produzir a nova versão.

## Resultado comercial da CMKV

A pauta `CMKV-QUIZ-RECORTE`, “De qual camiseta é esse traço?”, foi selecionada diretamente do Bolsão. O Codex autenticado planejou e revisou as montagens no ensaio. A primeira já isolava a pista e mantinha a variante marinho, mas ainda usava três recortes fixos na contagem. A revisão do Codex aprovou essa tentativa. A conferência visual motivou outra edição, com o movimento contínuo verificado no MP4.

| Tempo no novo MP4 | Resultado |
| --- | --- |
| 0–2 s | A flor e a borboleta brancas aparecem em macro. O movimento é curto e a composição esconde o restante da estampa. |
| 2–5 s | A foto inteira da opção A entra em camada. A legenda “Opção A” fica abaixo do produto. |
| 5–8 s | A opção B aproxima a estampa amarela da outra camiseta. O plano fica parado por três segundos para a comparação. |
| 8–12 s | O recorte da foto original abre continuamente. O 3, o 2 e o 1 entram sobre essa mesma tomada e o desenho vai ficando reconhecível. |
| 12–17 s | A câmera abre para a camiseta marinho do começo. A resposta revela o modelo 000037 e o CTA aparece com a peça ainda na tela. |

O Codex aprovou os dez critérios editoriais. Destacou a pergunta legível, a diferença de escala entre as opções, a contagem que acrescenta informação e a resolução com o modelo visível. A conferência com FFmpeg detectou trechos quase imóveis em 4–4,75 s e 5–8 s. A contagem e a resolução ganharam movimento e continuidade. O arquivo tem 17 s, 1080 × 1920 e SHA-256 `3488d77bf0b994bd4a23aa00edeae5fdb72852c287b79ea2be46f5d9adb04489`.

A peça já funciona para revisão do cliente como conteúdo de interação. A abertura cria uma pergunta que o vídeo responde, e a foto da peça continua visível no convite para comentar. A opção B poderia ocupar mais do quadro, e o logotipo no canto perde contraste em parte do fundo final. O movimento vem do enquadramento e da entrada da camada fotográfica. A estampa e as cores vêm dos arquivos originais.

[MP4 refinado](../artifacts/video-pilot/refinamento/cmkv-final/CMKV-De-qual-camiseta-e-esse-traco.mp4) · [Comparativo em vídeo](../artifacts/video-pilot/refinamento/CMKV-comparativo-antes-depois.mp4) · [Comparativo em quadros](../artifacts/video-pilot/refinamento/CMKV-comparativo-antes-depois.jpg) · [Parecer completo](../artifacts/video-pilot/refinamento/cmkv-final/relatorio.json)

## Regressões em capturas e gravações

**Vorix.** O ensaio usou capturas reais da Biblioteca com uma pauta de teste. A nova montagem de 16,5 s foi aprovada. A visão geral abre com “Trocou de atendente?” e os dois recortes seguintes deixam legíveis a nota interna, o aviso da transferência e a resposta com o contexto. O plano preliminar tentou usar a entrada de produto numa captura, e a validação recusou a cena. O Codex corrigiu para usar o plano geral e os dois recortes da interface. [MP4 da Vorix](../artifacts/video-pilot/refinamento/vorix/video-b-v1b.mp4) · [Parecer da Vorix](../artifacts/video-pilot/refinamento/vorix/relatorio.json)

**Rumo ao Altar.** O ensaio reutilizou o screencast bruto do piloto, montado com capturas reais do site e narração de teste por voz sintetizada. A primeira reedição trouxe a fala já para a abertura e preservou as legendas. O Codex recusou as duas tentativas amplas. A listagem continuava pequena e os trechos de RSVP e QR Code eram narrados sobre páginas de outros recursos. A fonte muda de página fora da fala correspondente.

A montagem final tem 16 s e foi aprovada pelo Codex após uma refação pontual do recorte da cena 2. O primeiro bloco preserva a pergunta original sobre taxa. Durante a resposta, o recorte mostra “Lista de presentes” e “PIX direto para os noivos”. As legendas destacam a frase falada e a chamada “Crie o seu site” permanece durante o fechamento. A correlação da forma de onda do MP4 com os dois trechos da origem foi de 0,992 e 0,994, sem deslocamento medido nos trechos verificados. As sete janelas de legenda estão nos respectivos blocos de fala. Essa prova cobre a montagem e o sincronismo para o material narrado de teste. [MP4 do Rumo ao Altar](../artifacts/video-pilot/refinamento/raa-final/video-c-v2.mp4) · [Parecer do Rumo ao Altar](../artifacts/video-pilot/refinamento/raa-final/relatorio.json)

## Testes e consumo

O build TypeScript e os 83 testes de regressão do motor de vídeo passaram. A cobertura inclui o render real em FFmpeg, mídia e cache por workspace, limites e cancelamento, rejeição de recortes inválidos, diferença observada no conteúdo do macro animado, contagem e prancha por cena, transcrição original, hash, escopo da refação e a escolha entre link e anexo na aprovação. [Log dos testes](../artifacts/video-pilot/refinamento/testes-finais.log)

| Peça | Render FFmpeg | Memória de pico amostrada | CPU de pico amostrada | MP4 |
| --- | ---: | ---: | ---: | ---: |
| CMKV anterior | 49,8 s | 1.058 MiB | — | 3,23 MB |
| CMKV refinada | 72,2 s | 796 MiB | 207% | 2,29 MB |
| Vorix anterior | 96,6 s | 975 MiB | 216% | 3,97 MB |
| Vorix refinada | 71,3 s | 775 MiB | 220% | 1,17 MB |
| Rumo ao Altar anterior | 37,5 s | 767 MiB | — | 2,34 MB |
| Rumo ao Altar refinado | 33,9 s | 718 MiB | 207% | 1,00 MB |

Os números são amostras do contêiner, em rodadas separadas. O limite foi 2 vCPU e 2 GiB, com prioridade reduzida e sem swap adicional. O percentual de CPU usa 100% por núcleo e pode oscilar acima de 200% no intervalo de medição. Na CMKV, o novo render levou 22,4 s a mais que a versão arquivada e usou cerca de 262 MiB a menos no pico amostrado. O planejamento do Codex levou 28,0 s e a revisão 10,6 s. O fluxo de ensaio usou o login operacional do Codex e o worker isolado, sem chamadas à IA paga do planejador.

No Rumo ao Altar, a transcrição e a prancha do material bruto levaram 43,0 s, com pico amostrado de 820 MiB. O tempo de 33,9 s na tabela é do render da última refação, que reutilizou intermediários da primeira renderização. O primeiro render da versão de 16 s ficou em 53,4 s e 674 MiB.

As pranchas documentam a evolução amostrada. Elas têm limitações para avaliar sincronismo fino da trilha, andamento da fala e continuidade entre os quadros. A edição conserva a sequência de fala por frases da origem. Se a imagem bruta mudar de assunto no meio de uma frase, o enquadramento por si só tem alcance limitado.

## Impacto de implantação e rollback

A API e o worker devem usar o mesmo release para ler e renderizar rascunhos com região de origem e a nova composição. O módulo do diretor e o status do piloto também precisam seguir esse release. Os novos campos são opcionais em dados existentes e ficam no JSON do rascunho e do plano, sem migração de banco. Antes de liberar, registrar os IDs das imagens atuais e a cópia dos módulos do piloto em `/opt/vorix-editorial`, conferir fila sem render em andamento e validar os artefatos com o timer desligado.

Para reverter, restaurar as imagens de API e worker do release `8b16f7ef` e os módulos correspondentes do piloto. Caso já existam versões em processamento com os novos campos, concluir ou cancelar essas versões pela fila antes de iniciar o worker anterior. A API e o worker anteriores continuam aptos a servir os MP4s gravados e seus hashes. Manter o timer desativado e conferir saúde dos serviços e da fila. A atualização depende de decisão do responsável pela operação.
