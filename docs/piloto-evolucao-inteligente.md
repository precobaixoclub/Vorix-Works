# Piloto automático — memória criativa, calendário inteligente e refação direcionada

Três melhorias integradas ao piloto Codex (Bolsão → arte → Quality Gate → aprovação pelo WhatsApp).
Implementadas localmente em 27/11/2026, **sem deploy**.

## 1. Memória criativa (por marca)

- **Fonte:** os pedidos de aprovação do WhatsApp (decisão + motivo), cruzados com a publicação
  (linguagem visual de cada tela, produtos). Nada novo é coletado.
  - `src/application/creative-engine/feedback-interpretation.ts`: leitura determinística do motivo.
  - `src/application/creative-engine/creative-memory.ts`: agregação.
- **Regras:**
  - Um erro vira aprendizado só quando aparece em **2 pautas diferentes**. Refazer a mesma pauta duas vezes conta uma vez só.
  - Pedido pontual ("só desta vez", "hoje"), "não quero postar" e reprovação sem motivo não ensinam nada.
  - A janela é de 60 dias. Sem nova ocorrência, a lição expira.
  - Isolamento: só decisões do próprio workspace.
- **Efeito:**
  - Linguagem visual reprovada de forma recorrente perde até 1,8 ponto na escolha. Nunca é proibida (proibir é decisão da marca, em `avoidArchetypes`).
  - Linguagem aprovada várias vezes ganha até 0,5.
  - Orientações entram na instrução da imagem ("APRENDIZADO DA MARCA") e na revisão da cena.
  - Produto reprovado em pautas diferentes vai para o fim do rodízio.
  - A reescrita da refação recebe as lições de texto e legenda.
- **Consulta (só leitura):** ação `memory` do backend do piloto.

## 2. Calendário inteligente

- `src/application/creative-engine/editorial-calendar.ts`: ordem das pautas para um horário, com base nas peças publicadas ou agendadas perto dele. Considera os últimos 14 dias e tudo o que já está agendado, de qualquer origem.
- **Perdem a vez:**
  - categoria igual à da peça vizinha (−2) ou à da seguinte (−1);
  - abordagem repetida;
  - 3º formato igual seguido (−1,5);
  - assunto quase igual a uma peça vizinha (≥ 45% das palavras: −3; ≥ 25%: −1,2).
- **Continuam a favor:** prioridade alta (+3) e data sugerida vencida (+1).
- **Não muda:**
  - pauta com data marcada pelo cliente para o dia fica na frente;
  - horários 12h/19h;
  - nenhuma pauta é descartada;
  - sem histórico, a ordem é exatamente a antiga.

## 3. Refação direcionada pelo WhatsApp

- `src/application/creative-engine/redo-scope.ts`: o motivo decide o que muda (texto de quais telas, imagem de quais telas, legenda, produto, logo) e o que fica igual.
  - A leitura determinística é a trava.
  - O Codex (que vê a arte reprovada) só precisa as telas quando o motivo não cita nenhuma, ou decide quando o motivo é vago.
- **Tela não criticada:** é recomposta sobre a **base aprovada** da versão anterior, sem gerar imagem nova e sem nova revisão de cena. Para isso, cada envio guarda as bases das telas geradas pela IA (`creative.screens[].baseUrl`).
- **Tela criticada:** é gerada de novo. A versão reprovada entra no histórico para o Quality Gate recusar uma cópia.
- **Logo criticada:** ajuste de tamanho ou tratamento no renderizador, sem IA.
- **Travas no backend:**
  - a mesma sequência de imagens com a mesma legenda de uma versão reprovada nunca volta (vale para qualquer origem);
  - toda tela que devia mudar precisa ter mudado;
  - a legenda só muda se o motivo falou dela.
- **"Não quero postar isso":** cancela, devolve ao Bolsão e não gasta uma refação.
- **WhatsApp:** a versão refeita diz o que mudou e o que ficou ("Mudou: imagem da tela 5. Mantive: …"). Coluna `publication_redo_requests.change_summary` (migração 0208).
- **Vídeo (DaVinci):** `src/application/video-editing/video-revision-scope.ts` transforma o motivo em permissão por cena do plano de edição e confere que nada fora dela mudou. O vídeo ainda não entra no piloto, então a regra fica pronta para quem gerar a nova versão do plano.

## Limitações

- O texto da arte vem do Bolsão: as lições de texto só agem na reescrita da refação, não na geração normal.
- A primeira refação de uma peça publicada antes destas mudanças não tem a base guardada. Nesse caso, as telas não criticadas mantêm a linguagem, mas a imagem é gerada de novo.
- A leitura do motivo é por palavras: um motivo fora do vocabulário cai no modo "vago" (o Codex decide, como antes).
- O calendário usa categoria e abordagem como campanha/série (a pauta não tem um campo de campanha).
