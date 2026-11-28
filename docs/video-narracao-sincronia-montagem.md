# Narração natural, sincronia real e montagem publicitária

Data: 27–28/11/2026. Commits locais, sem push e sem deploy. O timer de vídeo continua desligado e nada pago foi usado. Esta fase evolui o motor existente; a base está em [video-evolucao-impacto-narracao.md](video-evolucao-impacto-narracao.md).

## 1. Diagnóstico: causas reais

Avaliação humana: timbres aceitáveis; narração lenta e pausada; texto da tela fora da fala; melhora visual reconhecida; falta impacto.

| Sintoma | Causa medida | Tipo |
|---|---|---|
| Narração lenta | Perfil "moda" com velocidade 0,96 e ênfase ×0,88: 3,7 sílabas/s no conjunto, contra ~5,5 de uma locução publicitária. | técnica (minha) |
| Muitas pausas | Fala **frase a frase**; a ênfase **cortava a frase em dois** ("Olha de" / "perto."); reticências somavam +437 ms; cada fala entrava 0,15–0,45 s depois do corte. Medido: **4 pausas acima de 350 ms, a maior com 1,7 s**; intervalos entre falas de 0,94 / 2,41 / 0,78 s. | técnica (minha) |
| Interpretação errada | O campo `delivery` do Codex ("baixo, curioso") **nunca foi aplicado** pelo motor. | técnica |
| Texto fora da fala | O Codex escreveu **frases diferentes** para a tela e para a voz ("Que traço é esse?" na tela, "Olha de perto" na voz). Medido em A: só **4 de 14** palavras da tela são ditas, com desvio de 1,8 s. | decisão do Codex + falta de regra |
| "Sincronia" falsa | Os tempos das palavras vinham de **estimativa por sílabas do roteiro**, não do áudio. | técnica |
| Voz encaixada em cena rígida | A cena tinha duração fixa (batidas) e a fala era espremida dentro dela. | arquitetura |
| Falta de impacto | As três propostas tinham o mesmo esqueleto (gancho → macro → faixas → contagem → foto → foto → assinatura); o motor não tinha recurso tipográfico nem transição de elemento. | criativa + Codex |

Já existia e foi **reaproveitado**:
- faster-whisper com tempos por palavra (worker e Meetings), agora usado como alinhador;
- a memória criativa por marca;
- Kokoro e Piper;
- Spot e trilha composta.

## 2. Narração: direção de locução

- **Intenção por fala** (escolhida pelo Codex): curiosidade, surpresa, entusiasmo, explicação, emoção ou chamada. Ela vira o que os motores locais obedecem:
  - velocidade;
  - entonação final (? ou !);
  - respiro depois;
  - expressividade (Piper).
- **Reticências** viram vírgula ou interrogação, não pausa.
- **Síntese por bloco narrativo** (falas seguidas num só trecho, com prosódia contínua) e **corte nas respirações**: cada cena recebe a sua fatia do bloco, cortada na pausa real entre as frases, com rampa de 8 ms.
- **Laboratório** com o mesmo roteiro, frase × bloco, velocidades, Kokoro × Piper:

| | duração da fala | síl/s | pausas > 350 ms | erro (Whisper) |
|---|---|---|---|---|
| **Anterior (reprovada)** | 19,6 s | 3,7 | 4 (máx 1,7 s) | 14% |
| Kokoro frase ×1 | 10,6 s | 4,9 | 0 | 13% |
| **Kokoro bloco ×1** | 9,2 s | 5,9 | 0 | 13% |
| Kokoro bloco ×1,08 | 8,8 s | 6,0 | 0 | 6% |
| **Piper frase ×1** | 9,8 s | 5,4 | 0 | 16% |
| Piper bloco ×1 | 11,3 s | 5,1 | 2 (máx 0,54 s) | 22% |

Fonte: `artifacts/sincronia/entrega/narracoes/ouvir-narracoes.html` (os áudios estão ao lado).

**Escolha:**
- **Kokoro: bloco**.
- **Piper: frase**. No bloco ele cria pausa e fica mais lento.

**Ajuste depois do render:** a velocidade por fala, medida pela energia do áudio, ficou em 7,5–8,9 sílabas/s, acima do ritmo natural do português (~6–7). A base "moda" voltou a 1,0; a nova medida está no §6.

**Problema de pronúncia remanescente:** o Piper diz "de A" de um jeito que o Whisper ouviu como "diabo". Não há reprovação do Kokoro nem do Piper: o timbre de ambos foi aprovado.

## 3. Sincronia medida no áudio real

- **Alinhamento** (`word-alignment.ts`): o Whisper transcreve a narração **efetivamente gerada** e as palavras do roteiro escrito são casadas com as ouvidas (Needleman-Wunsch, tolerante a grafia).
  - Números são equivalentes: "3" = "três", "37" = "000037".
  - Palavras ouvidas que não estão no roteiro custam pouco; palavras do roteiro sem par custam caro.
  - Palavra sem par recebe tempo **interpolado e marcado**.
- **Validação em pt-BR:** palavras sintetizadas uma a uma, com fronteiras conhecidas.
  - Erro médio do início: **78 ms**; p90: 200 ms.
  - Medidas: 17 de 24 palavras. Palavras de uma sílaba isoladas ("a", "é") o Whisper não transcreve.
- **Tempo guiado pela fala** (`speech-timeline.ts`):
  - a fala posicionada decide os cortes;
  - o corte cai na pausa real e é puxado para ¼ de batida quando cabe;
  - a cena silenciosa mantém as batidas pedidas;
  - a revelação fala 0,55 s depois do impacto;
  - a imagem segura um mínimo por papel e 75% das batidas que o diretor pediu (a intenção de ritmo).
- **Texto falado na tela** (karaokê editorial): a frase aparece esmaecida e **cada palavra acende quando é dita**. Assim não há quadro vazio, e o texto segue a fala.
- **QG da sincronia** (`captionSync`): compara o instante em que cada palavra **aparece** com o instante em que ela é **ouvida no MP4 final** (Whisper sobre o áudio mixado, independente do roteiro), procurando a mesma palavra a até ±1,2 s.
  - Critério: média ≤ 120 ms, pior caso ≤ 250 ms, ao menos 70% das palavras medidas.
  - Durante a prova, a própria régua teve dois defeitos (custo simétrico e casamento sem janela de tempo), que geravam falsos atrasos de 1,5 a 5 s. Os dois foram corrigidos.

## 4. Direção, montagem e Remotion

- **Codex como diretor e editor:**
  - cada plano justifica a duração;
  - três conceitos com **dispositivos narrativos** diferentes (`conceptDevice`);
  - ritmo por gênero (`GENRE_RHYTHM`: moda, tecnologia, casamento e ofertas com faixas próprias);
  - **texto da tela = palavras da fala**;
  - avaliação humana no prompt.
- **Distinção por conceito:** semelhança de conceito e de sequência entram na comparação. Propostas parecidas vão para a **reformulação** antes da seleção (`--diversify`).
- **Novidade em relação à versão atual:** critério explícito na seleção, para que C não seja "B com efeitos". O limite desta medida é que ela compara estrutura e conceito, não imagem. A P3 marcou 1,0 de novidade, mas visualmente se parece com B; isso foi visto no storyboard e pesou na decisão.
- **Remotion:**
  - `type_mask`: palavra gigante com a foto real dentro das letras, depois a máscara se abre. Escolhe o fundo pela luz sob as letras e usa filete dourado.
  - `editorial_split`: página assimétrica com profundidade (a foto anda mais devagar que o painel e o painel gira em 3D).
  - Transição `morph`: a estampa continua da posição e do tamanho que tinha no plano anterior (faixa, painel ou tela cheia).
  - Texto falado palavra a palavra em todos os planos.

## 5. Som

- Ducking de 11 dB nas fatias de voz.
- Impactos mais baixos quando a fala vem logo depois.
- Eventos da trilha nos cortes **reais** (guiados pela fala).
- Silêncio de tensão e queda na revelação.
- Master em duas passagens: −14 LUFS e pico ≤ −1,5 dBTP.

## 6. Prova A × B × C (CMKV-QUIZ-RECORTE, mesmos materiais oficiais)

| | A (anterior) | B (narração corrigida) | C (evolução completa) | C com Piper |
|---|---|---|---|---|
| Duração | 19,4 s | 14,2 s | 16,3 s | 15,9 s |
| Palavras da tela que são ditas | 1 de 14 | 14 de 14 | 14 de 14 | 14 de 14 |
| Sincronia (faixa de voz entregue) | falha | **média 31 ms, máx 153 ms** | **média 31 ms, máx 103 ms** | média 125 ms, máx 857 ms |
| Palavras reconhecidas com a música | — | 13/14 | 14/14 | 12/14 |
| Volume | −14,2 LUFS / −2,1 dBTP | −14,1 / −2,6 | −14,2 / −1,3 | −14,1 / −2,1 |
| Quadros pretos / vazios | 0 / 3% | 0 / 2% | 0 / 2% | 0 / 2% |
| Benefício (nome da estampa) | 8,9 s | 6,3 s | 7,2 s | 7,2 s |
| Plano mediano (faixa moda 1,4–2,8 s) | 2,8 s | 2,1 s | 1,8 s | 1,8 s |
| Surpresas medidas | 1 | 1 | 2 | 2 |
| QG técnico | reprovado | **aprovado** | **aprovado** | reprovado |

- **A**: a fala não é o texto da tela, que é a causa medida do "texto fora da fala".
- **B**: a mesma estrutura visual de A, com locução por bloco, intenções, tempo guiado pela fala e texto falado palavra a palavra.
- **C**: conceito novo ("a letra abre a foto"). Tem `type_mask` no gancho e na revelação, cartão tipográfico de tensão com empurrão lento, `mask_reveal`, variante de cor e fechamento com chamada.
- **C com Piper**: reprovado porque a régua **não consegue confirmar**. O Whisper não reconhece a soletração "CMKV" nem os zeros do Piper, e casa só com o final ("37"). A energia mostra a voz começando em 9,54 s, com "CMKV" aparecendo em 9,53 s. Na dúvida, o QG não aprova.
- **Recomendações editoriais que ficam para avaliação humana:**
  - falas curtas medidas como "corridas": "A ou B?" a 9,1 síl/s e "Era a A." a 9,3 síl/s; em frases de 3–4 sílabas a medida é instável;
  - "CMKV 000037" com entonação plana;
  - dois planos seguidos de prova.

**Correções feitas durante a prova** (todas com teste):
- **Mixagem.** O ducking passou a ter **antecipação** de 0,12 s e **profundidade por trecho**: −17 dB quando a fala vem logo depois de um impacto ou da queda. Antes, a voz da revelação ficava só 2,8 dB (B) e 5,3 dB (C) acima da trilha.
- **Régua da sincronia.** Uma palavra **não começa em silêncio**: o Whisper estendia "resposta" para trás através de uma pausa de 0,8 s (falso atraso de 780 ms). Agora a palavra vai para o próximo início real de fala.
- **Quadros vazios no início do cartão tipográfico.** O karaokê esmaece as palavras em vez de escondê-las.

Tempo de render local (máquina de desenvolvimento): 195–216 s por versão (Remotion 159–168 s). Custo: US$ 0. Tudo é local: Kokoro, Piper e faster-whisper em CPU, Remotion e FFmpeg.

## 7. Memória

A avaliação desta pauta virou eventos da **memória criativa existente** (`artifacts/sincronia/memoria-cmkv.json`):

| Tipo | Padrões |
|---|---|
| Aprovado | `timbre_aceitavel`, `montagem_melhorou` |
| Reprovado | `narracao_lenta`, `pausas_inadequadas`, `legenda_dessincronizada`, `impacto_insuficiente` |

- Com uma pauta só, tudo fica **observado** e nada vira proibição (testado).
- Não há reprovação de Kokoro ou Piper.
- O registro é isolado por marca.
- Gravar no banco de produção depende do deploy, porque a tabela `video_brand_feedback` (0212) ainda não existe lá.

## 8. Rollback

São commits locais separados por frente. A narração só liga com `TTS_PYTHON` e `TTS_MODEL_DIR` configurados. O worker e o piloto continuam no caminho antigo até haver deploy autorizado.
