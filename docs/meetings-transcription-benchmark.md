# Vorix Meetings — benchmark e arquitetura da transcrição local

Data: 04/11/2026. Objetivo: transcrição **local e gratuita** como padrão, sem ocupar a máquina inteira,
sem impactar API, banco, WhatsApp e os demais módulos. A OpenAI fica como opção paga, só por escolha
explícita do admin.

## Auditoria da implementação anterior

O motor local já era **faster-whisper** (não o Whisper original), com modelo `small` INT8 e VAD. O peso
vinha da configuração e da forma de execução:

| Ponto | Antes | Agora |
|---|---|---|
| Threads | `0` = todas as CPUs do host | `1` (configurável) |
| Busca | `beam_size=5` | `beam_size=1` (gulosa) |
| Áudio na memória | arquivo inteiro em float32 (60 min ≈ 345 MB só de áudio) | blocos de 10 min cortados num ponto de silêncio (~40 MB constantes) |
| Idioma | fixo por variável | automático, detectado no 1º bloco e mantido na reunião |
| Modelo | baixado se faltasse, sem modo offline | lido do cache local (`local_files_only`); baixa só na 1ª vez |
| Imagem | herdava a do gravador (Chrome, Xvfb, PulseAudio) | imagem própria, sem PyTorch |
| Proteção do host | nenhuma | 1 transcrição por vez, espera folga de RAM/CPU e o fim das gravações |

O fluxo já era assíncrono e continua igual: grava → salva o áudio → encerra → job na fila →
o worker transcreve → salva → análise. O áudio é decodificado uma única vez (ffmpeg → WAV PCM
16 kHz mono), o formato que o modelo consome sem nova conversão.

## Método

- Áudio real em português do Brasil: "O Alienista" (Machado de Assis), LibriVox, domínio público.
  Texto de referência: Project Gutenberg #57001 (ortografia de 1882 normalizada antes de comparar).
- Clipe principal de 10 min; testes extras de 5, 30 e 60 min e 5 min de silêncio.
- **1 thread em todos os motores**, para simular o limite de 1 CPU do container.
- Medição: pico de RAM e de CPU do processo e dos filhos (amostras a cada 0,5 s), tempo total
  (inclui carregar o modelo) e WER (erro por palavra) contra o melhor trecho alinhado do texto.
- Máquina do teste: desktop x86-64 (16 threads). **Um vCPU de droplet é mais lento por thread**: os
  tempos absolutos no servidor serão maiores (estimativa: 1,5–2,5×); RAM e precisão não mudam.

## Resultado — 10 min de áudio, 1 thread

| Motor | RAM máx. | CPU máx. (média) | Tempo p/ 10 min | WER | Qualidade pt-BR | Modelo |
|---|---|---|---|---|---|---|
| ORIGINAL_WHISPER (small, FP32, PyTorch) | **1.672 MB** | 102% (100%) | 303 s | 13,1% | boa | 461 MB |
| FASTER_WHISPER_TINY_INT8 | 508 MB | 125% (100%) | 32 s | 30,2% | ruim: troca nomes ("Simão Macamart", "Taguai") | 75 MB |
| FASTER_WHISPER_BASE_INT8 | 359 MB | 141% (100%) | 56 s | 21,1% | fraca: "Baca Marte", "encoímbra" | 145 MB |
| **FASTER_WHISPER_SMALL_INT8** | **635 MB** | 102% (99%) | **177 s** | **12,9%** | **boa — igual ao original** | 464 MB |
| WHISPER_CPP_BASE_Q5_1 | 349 MB | 400%* (102%) | 108 s | 22,3% | fraca (como o base) | 57 MB |
| WHISPER_CPP_SMALL_Q5_1 | 543 MB | 407%* (100%) | 383 s | 14,9% | boa, um pouco abaixo | 181 MB |

\* O whisper.cpp abre threads auxiliares por instantes mesmo com `-t 1`; a média fica em 1 CPU e o
limite `cpus: 1.0` do container segura o pico.

Trecho de comparação (referência: "Estudara em Coimbra e Padua"):
- original small: "Estudar a **Incoimbra** e Pádua"
- faster-whisper small: "Estudara em Coimbra e Pádua" ✔
- faster-whisper base / whisper.cpp base: "Estudar a **encoímbra** e pádua"

## Duração e silêncio — faster-whisper small INT8, 1 thread

| Áudio | Tempo | RAM máx. | WER |
|---|---|---|---|
| Silêncio, 5 min | 6 s | 518 MB | 0 palavras (sem texto inventado) |
| 5 min | 81 s | 572 MB | 12,6% |
| 10 min | 177 s | 635 MB | 12,9% |
| 30 min | 467 s | 603 MB | 12,6% |
| 60 min | ver nota abaixo | — | — |

A RAM não cresce com a duração (blocos de 10 min). O VAD faz o silêncio custar quase nada.

## Decisão

- **Motor padrão: LOCAL_FASTER_WHISPER, modelo `small` INT8, 1 thread, beam 1, VAD.** Mesma
  precisão do Whisper original com 62% menos RAM e 42% menos tempo; tiny/base erram nomes
  próprios, o que prejudica o resumo e a busca na transcrição.
- **Modo econômico: LOCAL_WHISPER_CPP com `base` Q5_1** (349 MB) para servidores sem folga de RAM —
  mais leve, porém menos preciso. Para o econômico com boa precisão, `MEETINGS_WHISPER_CPP_MODEL=ggml-small-q5_1.bin` (543 MB).
- **OPENAI_OPTIONAL**: só por escolha no painel, com confirmação de custo. Sem chave, nada é tentado.

## Limites propostos (servidor atual: 2 vCPU, 2 GB RAM, 4 GB swap)

| Item | Valor | Motivo |
|---|---|---|
| CPU do worker | `cpus: 1.0` | sempre sobra 1 vCPU para API, banco e WhatsApp |
| RAM do worker | `mem_limit: 1200m`, sem swap extra | pico medido ~640 MB; estouro mata só o job (volta para a fila) |
| Concorrência | 1 transcrição no ambiente | trava no banco: com uma rodando, as outras esperam |
| Folga para começar | ≥ 450 MB livres, pressão de memória ≤ 10%, de CPU ≤ 40%, carga ≤ 1,5/CPU | sem folga, o job espera; a análise continua |
| Gravações | transcrição espera enquanto há gravação em andamento | Chrome e ASR nunca disputam a CPU |
| Tempo estimado no droplet | ~5–8 min por 10 min de áudio | 1 vCPU compartilhado; reunião de 1 h ≈ 30–50 min, de madrugada ou entre reuniões |

Observação para o servidor atual: hoje sobram ~560 MB de RAM. O `small` cabe, mas o host fica no
limite; desligar serviços sem uso do sistema e limpar o cache do Docker dá folga extra. Se a
transcrição ficar esperando com frequência, trocar no painel para o modo econômico.

## Como reproduzir

Scripts em `tmp/asrbench/` (fora do git): `bench.py` (medição e WER) e `run_original.py` (linha de base).
