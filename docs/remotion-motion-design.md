# Motion design com Remotion no motor de vídeo

## Licença (conferida em 27/11/2026 no texto oficial)

- **Gratuita** para pessoa física, organização com fins lucrativos de **até 3 pessoas** e entidades sem fins lucrativos. Uso comercial, automação de renders (local ou na nuvem) e SaaS baseado em templates próprios são permitidos nessa faixa.
- A partir de **4 pessoas** exige **Company License**. Pela FAQ oficial, a contagem é da organização inteira, mesmo de quem não usa o Remotion. No Remotion 5.0, prestadores de serviço também passam a contar.
- Para o nosso caso (renders automáticos no servidor), o plano é o **Remotion for Automators**: US$ 0,01 por render, com mínimo de US$ 100/mês. O Remotion for Creators custa US$ 25 por pessoa/mês e só vale sem automação. Acima disso há o plano Enterprise.
- Os clientes recebem só o MP4 e nunca o projeto Remotion, então o número de pessoas deles não entra na conta. É proibido aceitar projetos Remotion enviados por usuários para renderizar.
- Na renderização no servidor não há telemetria automática, exceto para clientes Automators a partir do Remotion 5.0.
- Fontes: [LICENSE.md](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md), [License FAQ](https://www.remotion.dev/docs/license/faq), [mudanças do 5.0 (PR 3750)](https://github.com/remotion-dev/remotion/pull/3750).

**Antes de usar em produção:** confirmar o número de pessoas da organização (incluindo prestadores). Com 4 ou mais pessoas, a compra da licença precisa ser autorizada.

## Arquitetura

O fluxo é: Bolsão → Codex (direção, com `design` por cena) → construtor (props) → worker.

No worker, as cenas com `design` são renderizadas primeiro pelo Remotion (`motion-graphics/render.mjs`). Depois o FFmpeg monta a peça: sequência, transições, áudio, legendas, logo e exportação. A partir daí seguem o Quality Gate, o hash, o WhatsApp e a publicação.

- **Um processo por vez:** a cena do Remotion roda antes dos passos do FFmpeg, no mesmo job, e o worker já processa uma versão por vez. A concorrência do Chromium é `REMOTION_CONCURRENCY` (padrão 1).
- **Cache por workspace:** a chave inclui as props, o conteúdo dos arquivos citados e o hash do código dos templates. Template alterado gera um render novo.
- **Arquivos do job:** são servidos por HTTP em 127.0.0.1 somente durante o render, sem travessia de caminho.
- **Desligamento:** `VIDEO_MOTION_GRAPHICS=false`, ou o pacote ausente. Sem o renderizador, um plano com `design` é recusado com uma mensagem clara.

## Templates

| Template | Material | O que faz |
|---|---|---|
| `product_hero` | foto do produto (+ região da estampa) | revelação por máscara, câmera em perspectiva, reflexo de luz, callout na estampa, título cinético |
| `detail_reveal` | foto do produto + região | começa no macro da estampa e abre até a peça inteira |
| `lineup` | 2–3 fotos do produto | variantes em grade sem sobreposição, entrada escalonada, paralaxe leve |
| `software_focus` | captura real + região + rótulo | captura inteira e nítida, cursor e clique, lupa com os pixels reais da região, guias, rótulo |
| `title_card` | cartão | abertura ou encerramento com tipografia cinética, forma gráfica, logo oficial e CTA |
| `speech_captions` | gravação com fala | reenquadramento inteligente, legendas palavra a palavra, selos nas palavras-chave, barra de progresso |

## Professional Video Engine (direção audiovisual)

O Codex decide a história (`story`), a emoção de cada cena (`emotion`), onde usar Remotion ou só FFmpeg, e se o vídeo leva efeitos sonoros (`sfx: auto | none`). O sistema executa de forma determinística e verificável. Tudo é **opcional**: um rascunho sem `story` e sem `emotion` sai idêntico ao de antes.

| Motor | Onde | O que faz |
|---|---|---|
| Emotion Engine | `audiovisual-direction.ts` | 9 emoções; cada uma muda ritmo (duração das cenas flexíveis), intensidade de câmera, curva, transição preferida, densidade de efeitos, energia da trilha e composição (respiro × fechada) |
| Brand Motion System | `audiovisual-direction.ts` | personalidade pela marca (elegante, ousada, tech, acolhedora, divertida, minimalista): raio, caixa do texto, espaçamento, família de transições, paleta sonora, granulação e brilho. Uma configuração da empresa prevalece campo a campo |
| Beat Sync | `audio-analysis.ts` + `snapCutsToBeats` | BPM e fase da trilha; os cortes flexíveis encaixam na batida (±0,22 s) sem ficar abaixo do tempo de leitura; a fala nunca é encurtada; nem todo corte cai na batida |
| Sound Design | `sfx-library.ts` + `planSfx` | efeitos sintetizados pelo FFmpeg a partir de fórmulas próprias (**obra própria da Vorix, sem licença de terceiros**: uso comercial e SaaS livres). Ficam sincronizados aos eventos visuais (clique, revelação, transição, texto). Limites: no mínimo 0,9 s entre efeitos e 2,5 s entre dois iguais, orçamento pela emoção, abaixados ou omitidos sob a fala; a mixagem é feita antes do loudnorm |
| Smart Reframing | `reframe-analysis.ts` + `reframe-track.ts` | região de interesse por mudança entre quadros e por detalhe (4 fps), com trilha suave: zona morta, velocidade máxima, mudança só quando sustentada e recorte sempre dentro da mídia. Gravação de tela fica na janela de cima (50% da altura, ~63% da largura da tela original) com as legendas embaixo; a pessoa ocupa o quadro inteiro |
| Visual Composition | `motion-graphics/src/lib/layout.ts` + `motion.ts` | área segura das plataformas (topo 12%, base 22%, esquerda 6%, direita 14%); vitrine sem sobreposição (gap ≥ 28 px) e com a proporção da foto; lupa de software dentro da área útil |
| Quality Gate audiovisual | `audiovisualChecks` | **objetivas** (reprovam): excesso de animação, mais de 3 tipos de transição, tempo de leitura, densidade e repetição de efeitos, prioridade da fala (efeito alto ou trilha sem ducking), pico real. **Subjetivas** (revisão visual): hierarquia, fidelidade, identidade, sincronia, continuidade |

`software_focus` não escurece mais a tela: a captura fica inteira e nítida, e uma **lupa** com os pixels originais da região cresce a partir dela. O escurecimento máximo é de 12%.

### Desempenho

- Chromium aberto uma vez e reaproveitado entre as cenas. Ele fecha depois de 30 s ocioso (`REMOTION_BROWSER_IDLE_MS`) e é reaberto, uma única vez, se cair no meio do render.
- Imagens maiores que o necessário são reduzidas uma única vez, só por reamostragem (fotos até 3200 px, capturas até 4096 px, logos até 1600 px).
- Perfis `final` (padrão) e `preview` (metade da resolução, `REMOTION_QUALITY=preview`). O perfil entra na chave do cache.
- O relatório do render traz `design: {total, hits, ms}` (acertos de cache das cenas animadas).
