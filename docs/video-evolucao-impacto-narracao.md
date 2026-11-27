# Evolução do motor criativo: impacto, narração humanizada e acabamento

Data: 27/11/2026. Commits locais, sem push e sem deploy. O timer de vídeo segue desligado e nenhuma API paga foi usada. Esta fase evolui o motor existente, sem reconstruí-lo; a base é a [reformulação anterior](video-reformulacao-criativa.md).

## 1. Auditoria do vídeo anterior (A)

Arquivo: `CMKV-QUIZ-RECORTE-novo.mp4`, 17,1 s. A pauta real é CMKV-QUIZ-RECORTE.

| Tempo | Defeito | Aspecto |
|---|---|---|
| 0,0–1,8 s | Gancho só de texto sobre o recorte. Sem voz, sem impulso de câmera, e o recorte já mostra o coração e o "f". | Gancho |
| 1,8–3,5 s | O traço é desenhado **inteiro** antes da pergunta "A ou B", o que quebra o mistério do quiz. | Progressão |
| 3,5–10,6 s | A mesma estampa ♡fé aparece em 3 planos seguidos. | Progressão / redundância |
| 3,5–8,2 s | 4,7 s na mesma comparação quase parada. O medidor confirmou: planos 3 e 4 quase iguais, dHash 1/64. | Ritmo / animação |
| 3,5–6,5 s | Legenda em pílula pequena (44 px). | Legibilidade |
| 8,2 s | A "revelação" não revela nada novo e não tem respiro nem impacto sonoro. | Impacto |
| 12,9–17,1 s | O fechamento repete a pergunta do gancho depois da resposta, e o botão tem seta de link num CTA de comentário. | Encerramento / CTA |
| todo o vídeo | Sem narração. Trilha plana (−16 a −11,6 LUFS), sem tensão antes da revelação. | Áudio |

A identidade visual estava consistente (preto, dourado, DM Serif, logo oficial).

## 2. Narração humanizada: avaliação

O **mesmo roteiro** foi gerado em quatro interpretações (moda, tecnologia, casamento, ofertas) em todas as vozes. As medidas abaixo **não substituem a escuta**; as amostras estão em `artifacts/evolucao/entrega/vozes/ouvir-vozes.html`.

| Voz | Licença | Erro de transcrição (Whisper small) | Variação do tom | Sílabas/s | Geração | RAM | Situação |
|---|---|---|---|---|---|---|---|
| Windows SAPI "Maria" (atual) | do sistema (só Windows) | 9% | **2,1 st (monótona)** | 4,3 | instantânea | — | baseline robótico |
| **Kokoro pf_dora** | Apache-2.0 | 13% | 3,1 st | 5,3 | 0,36× o tempo real* | ~490 MB | **candidata principal** |
| Kokoro pm_santa / pm_alex | Apache-2.0 | 13% / 17% | 3,5 / 3,3 st | 5,2 | 0,26× | ~520 MB | candidatas |
| **Piper faber-medium** | GPL-3.0 (processo separado), dataset CC0 | 15% | 3,0 st | 6,6 | 0,66×** | ~70 MB | **candidata leve** |
| Piper cadu / jeff | idem | 16% / 26% | 2,8 / 3,1 st | 5,8 / 6,4 | 0,12–0,37× | ~75 MB | secundárias |
| Piper edresson-low | CC BY 4.0 | 36% | — | — | — | — | **descartada**: não pronuncia nasais ("Missing phoneme ̃") |
| Chatterbox multilingual | MIT | 4–23% (com timbre-guia) | 2,8–3,7 st | — | **~8,5×** | **~4,5 GB** | só referência: inviável no VPS |

\* Medido no PC com 16 threads. **Não foi medido no VPS** (o worker tem 2 vCPU).
\*\* Inclui o carregamento do modelo.

- A voz padrão do Chatterbox **inventou palavras** ("Há entuveiro às inícias") e teve 95% de erro na interpretação de casamento.
- O Whisper também erra, então a taxa de erro é uma aproximação da pronúncia, não uma nota de naturalidade.
- **XTTS-v2, F5-TTS e Fish Speech foram excluídos pela licença** (não comercial).

**Pagas, sem ativar** (a decisão é sua), em ordem de custo:
- Azure Neural TTS pt-BR (Francisca/Antonio), com SSML real: pausas, ênfase, estilos;
- Google Cloud TTS (Neural2/Chirp HD);
- OpenAI gpt-4o-mini-tts, que aceita instruções de interpretação;
- ElevenLabs, a mais expressiva e a mais cara.

**Erros de pronúncia medidos e corrigidos pelo léxico (`speech-script.ts`):**
- "Era a A." saía "Teiro alas" no Kokoro;
- "A ou B" saía "A OBS";
- "Club" saía "clavro";
- "Vorix" saía "Vorex".

O léxico agora cobre letras soltas, siglas, códigos, números por extenso e marcas.

## 3. Sistema de narração

- **Roteiro falado:** o Codex escreve uma fala curta por plano (até 10 palavras), com orientação de interpretação (`delivery`), pausa e ênfase (`*palavra*`). Os planos de tensão podem ficar sem fala.
- **O que os motores locais realmente suportam:**
  - **Pausa** exata: trecho por trecho.
  - **Ênfase**: trecho próprio, 12% mais lento, com respiro de 140 ms.
  - **Reticências**: suspense.
  - **Velocidade** por trecho.
  - **Expressividade**: noise_scale, no Piper.
  - Não há SSML.
- **Perfis por campanha:**

  | Campanha | Velocidade | Respiro | Ducking |
  |---|---|---|---|
  | Moda (envolvente) | 0,96 | 1,15× | 9 dB |
  | Tecnologia (clara e dinâmica) | 1,05 | 0,9× | 10 dB |
  | Casamento (acolhedora) | 0,90 | 1,3× | 8 dB |
  | Ofertas (enérgica sem exagero) | 1,10 | 0,8× | 7 dB |

- **Encaixe:**
  - a fala entra depois do impacto do plano (0,3 s no gancho, 0,45 s na revelação);
  - o gancho nunca estica, e a fala pode atravessar o corte (L-cut);
  - os outros planos crescem em batidas inteiras quando a fala não cabe;
  - a legenda acende **no tempo da fala**.
- **Execução:** `scripts/tts/tts_runner.py` roda como processo separado, sem shell, chamado por `local-tts.ts` (`TTS_PYTHON` e `TTS_MODEL_DIR`). Sem configuração, o vídeo segue sem narração, como hoje.
- **Clonagem:** nenhuma voz de terceiro foi clonada. O timbre-guia do Chatterbox é uma amostra **sintética** do Kokoro.

## 4. Direção

O prompt e o schema do diretor agora exigem:
- papel narrativo por plano (gancho → pista → pergunta → tensão → revelação → prova → CTA);
- mistério preservado: só fragmentos (`detail` / `detail2`) antes da revelação;
- ritmo variável;
- no máximo 5 palavras de texto na tela;
- fechamento que não repete o gancho.

A validação acusa:
- **spoiler**: estampa inteira antes da revelação;
- plano **redundante**;
- fala longa ou que não cabe;
- **ritmo uniforme**.

Os critérios de seleção ganharam dois itens: progressão narrativa e ritmo variável.

## 5. Motion design

- **Fragmentos de verdade:** `detail` e `detail2` mostram cerca de 1/4 da estampa, com até 3,6× de ampliação.
- **Gancho:** impulso de câmera, mais um véu atrás do título quando ele cruza o traço.
- **Contagem:** aproximação progressiva das duas opções (tensão em vez de quadro repetido).
- **`trace_draw` sobre a foto real:** o traço dourado percorre a estampa e se dissolve no original (pagamento da revelação).
- **Legenda em pílula:** 52 px, sincronizada à fala.
- **CTA:** seta de link só para CTAs de link ou compra.
- **Logo:** a assinatura troca o **fundo** (nunca a logo) quando a logo oficial some no fundo escolhido.

## 6. Sound design

- **Trilha:**
  - motivo melódico de 4 notas, com variação a cada 2 compassos;
  - swing;
  - viradas antes das subidas de energia;
  - **silêncio de tensão** uma batida antes da revelação, com riser antes e **queda** na resposta (impacto, bumbo e prato).
- **Ducking exato:** a trilha e os efeitos abaixam só onde há voz (120/350 ms), na profundidade do perfil.
- **Voz:** passa-altas, compressão 3:1 e presença em 3 kHz, num arquivo próprio. É o mesmo arquivo que a revisão mede.
- **Master:**
  - reamostragem de alta qualidade (a interpolação linear criava brilho metálico e picos no AAC);
  - loudnorm em duas passagens (−14 LUFS);
  - limitador final com folga para os picos entre amostras do AAC.

## 7. Revisão audiovisual temporal (`av-review.ts`)

Cada achado tem **início, fim e a medida** que o sustenta:
- **Vídeo:** dHash do quadro de cada plano (redundância) e movimento por plano.
- **Voz:** voz × trilha em cada fala, pausas internas, entre falas e em planos de tensão (o silêncio é intencional), entonação (desvio do F0) e sílabas/s.
- **Mix:** pico real e LUFS.
- **Plano criativo:** papel narrativo e encerramento.

O relatório declara o limite: **a máquina não ouve**.

A revisão funcionou de verdade nesta prova. Ela pegou, nas primeiras versões de C:
- voz só 1 dB acima da trilha no gancho e −0,5 dB na revelação (os impactos competiam com a fala);
- pico de −0,4 a −0,9 dBTP depois do AAC;
- comparação e contagem quase iguais.

Tudo foi corrigido e medido de novo.

## 8. Memória e aprendizado

- **Uma memória só.** As avaliações de vídeo na tela viram eventos da memória criativa existente (`creative-memory.ts`, a mesma do WhatsApp). Mantêm-se as regras dela:
  - só vira lição o que se repete em **2 ou mais pautas**;
  - a mesma pauta reprovada duas vezes não vale como regra;
  - tudo expira em **60 dias**;
  - crítica pontual fica em "observado" e não proíbe nada.
- **Categorias novas de vídeo:** voz, trilha, ritmo, edição, animação, abertura e CTA, com orientação própria para o diretor.
- **Vocabulário de padrões:** 29 itens, alinhado aos achados da revisão.
- O `deriveBrandTaste` da fase anterior, que proibia na primeira reprovação, foi substituído.

## 9. Prova: A × B × C

| | A (anterior) | B (direção, motion e som) | C (B + voz Kokoro) |
|---|---|---|---|
| Duração | 17,1 s | 19,4 s | 19,4 s |
| Achados da revisão | 1 (redundância 3,5–8,2 s) | **0** | 1 baixo ("Olha de perto" a 3,1 sílabas/s) |
| Estampa inteira antes da revelação | sim | **não** | **não** |
| Variação do ritmo | 20% | 27% | 27% |
| Produto na tela | 76% | 80% | 80% |
| LUFS / pico real | −13,8 / −1,7 | −14,1 / −1,5 | −14,2 / −2,1 |

- **C-Piper faber:** 0 achados.
- **C-Chatterbox:** 1 achado médio (voz 5,6 dB acima da trilha no gancho).

| Etapa | Tempo |
|---|---|
| Codex: 3 propostas | 145 s |
| Codex: 2 refações | 51 e 54 s |
| Render B | 196 s |
| Render C | 200 s |
| Falas (6): Kokoro / Piper / Chatterbox | 14 s / 5,5 s / 176 s |
| Remixagem só de áudio | ~12 s |

**Custo: US$ 0.**

**O que ainda falhou:**
- **Distinção:** P1 × P3 tiveram só 2 diferenças, abaixo do mínimo de 3.
- **Codex:** de novo pôs fotos na assinatura, contra a regra da pauta (corrigido na refação).
- **P3:** na refação, passou do limite do gancho (2,22 s).

## 10. Limitações

- A naturalidade, o timbre e a emoção da voz e da trilha **não foram ouvidos por mim**. As medidas são aproximações; a escolha da voz é sua.
- **Produção:** o worker do VPS ainda não tem Python, Piper, Kokoro nem os modelos (cerca de 330 MB do Kokoro + ~70 MB por voz Piper). O Kokoro não foi medido em 2 vCPU. Integrar a voz e o Spot ao worker e ao piloto exige deploy autorizado.
- **Material:** o movimento continua 2,5D sobre fotos. A ampliação de 3,6× nos fragmentos deixa a textura macia. Tecido em movimento exigiria filmagem.

## Rollback

São commits separados por frente. Para desfazer, basta reverter o commit da frente. Não há migração nova nesta fase. A narração só é ativada com `TTS_PYTHON` e `TTS_MODEL_DIR` configurados.
