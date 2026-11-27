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
| `lineup` | 2–3 fotos do produto | variantes em cartões com profundidade |
| `software_focus` | captura real + região + rótulo | perspectiva, cursor, clique, aproximação, holofote, callout |
| `title_card` | cartão | abertura ou encerramento com tipografia cinética, forma gráfica, logo oficial e CTA |
| `speech_captions` | gravação com fala | legendas palavra a palavra, selos nas palavras-chave, barra de progresso |
