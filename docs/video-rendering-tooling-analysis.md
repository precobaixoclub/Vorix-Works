# Análise técnica — renderização automática local de vídeo para a v1.1 do Zuno

**Status:** análise apenas — nenhum código foi implementado a partir deste documento.
**Escopo do pedido:** comparar alternativas de renderização automática local de vídeo para substituir/complementar o Developer Assisted Mode do Rafa, preservando integralmente a arquitetura atual do Zuno, sem provider de IA de vídeo e sem APIs pagas.

---

## 1. Restrições reais da arquitetura (não negociáveis)

Antes de comparar ferramentas, três fatos do código atual do Zuno restringem o espaço de solução mais do que qualquer critério de qualidade de vídeo:

### 1.1 Zero dependências de runtime hoje

`package.json` tem `"dependencies": {}` — o Zuno inteiro roda hoje só com a standard library do Node (`node:fs`, `node:crypto` etc.). Isso não é acidente: é a extensão natural da ADR 0003 ("local-first, sem infraestrutura externa"). Qualquer ferramenta candidata carrega um custo de dependência que precisa ser justificado, não assumido.

### 1.2 Skills são puras — I/O de renderização é proibido dentro da Skill

`tests/rafa-video-rendering.test.mjs` já tem um teste dedicado, hoje verde, que afirma **ausência** de `child_process`/`ffmpeg`/`fetch`/`SocialPublisherPort` dentro de `rafa-video-rendering.skill.ts`. Isso não é uma lacuna a preencher — é a ADR 0002 (isolamento de Skills) em forma de teste: Rafa decide *o quê* renderizar, nunca *como* chamar um binário externo. Qualquer integração de renderização precisa entrar como uma nova porta de aplicação (`*.port.ts`) implementada por um adaptador em `src/infrastructure/`, injetada via `RafaVideoRenderingSkillDependencies` — exatamente o mesmo padrão que `ArtifactDeliveryPort`/`ClaraKnowledgePort` já usam. Isso é válido para qualquer ferramenta escolhida (FFmpeg, Remotion etc.); é um requisito de integração, não um critério de escolha entre elas.

### 1.3 O plano de Diego/Bruno não tem assets concretos — só texto

Verifiquei os tipos reais (`bruno-video-script.types.ts`, `diego-video-editing.types.ts`):

- `brollSuggestions: string[]` → descrições em prosa ("Imagens de apoio que ilustrem: ..."), não caminhos de arquivo.
- `musicSuggestions` / `musicTrackPlan: string` → descrição do estilo de trilha, não um arquivo de áudio.
- `requiredAssets: string[]` → frases como "Arquivo de trilha sonora definida no plano de trilha..." — texto, não referência.
- `captionText` / `onScreenText` **são** strings concretas e prontas para renderizar — isso já é 100% automatizável hoje, com qualquer ferramenta.

**Consequência prática, independente da ferramenta escolhida:** nenhuma automação vai produzir sozinha o vídeo com "casal sorrindo, aliança, notebook, taça de espumante" pedido em roteiros como o desta campanha — isso continua exigindo filmagem real ou um gerador de vídeo por IA (fora de escopo por decisão do usuário). O que **é** automatizável de ponta a ponta hoje é a camada de motion graphics: fundos, texto animado, mockups de tela, logo, transições, cores da marca e legendas — exatamente o que foi montado manualmente por código nesta sessão como prova de conceito. A ferramenta escolhida deve otimizar para essa fatia real do problema, não para um "filme" completo que nenhuma ferramenta local e gratuita entrega sozinha.

---

## 2. Ferramentas avaliadas

### 2.1 FFmpeg (via `child_process` + `ffmpeg-static`, wrapper fino em TS)

| Critério | Avaliação |
|---|---|
| Integração com a arquitetura atual | Melhor encaixe possível: um binário externo chamado via `node:child_process`, sem framework, sem runtime adicional. Vira um único novo adaptador (`FfmpegVideoRendererAdapter implements VideoRenderingPort`), do jeito que `ArtifactDeliveryPort` já é implementado. Não introduz nenhuma dependência de compilação, GPU ou browser. |
| Qualidade final | Referência da indústria — é o encoder H.264/AAC que Instagram, TikTok e YouTube esperam. É literalmente o que Rafa já promete no contrato técnico (`"videoCodec": "H.264 (libx264)", "audioCodec": "AAC"`) — hoje uma promessa não cumprida pelo modo assistido. |
| Animações | Via filtros (`zoompan`, `fade`, expressões `enable='between(t,a,b)'`). Funcional, mas verboso para animações complexas — exige escrever um "compilador" de JSON (o plano de Diego) para grafo de filtros. Trabalho de engenharia real, mas bem delimitado. |
| Legendas | Excelente — filtro `subtitles` (SRT/ASS) ou `drawtext` por trecho, com fonte, cor, borda, posição. Mapeia 1:1 para `captionText`/`onScreenText` de Diego. |
| Transições | Filtro `xfade` cobre >40 tipos (fade, wipe, slide, circleopen, pixelize etc.) — mapeia bem para `transitionToNext` (hoje texto livre; precisaria de um vocabulário fechado). |
| Imagens | Suporte nativo total (`overlay`, `scale`, loop de imagem estática como clipe). |
| Áudio | Mixagem completa (`amix`, `adelay`, automação de volume/ducking) — mas Zuno ainda não tem uma fonte real de trilha/efeitos sonoros (ver §1.3); a capacidade existe, falta o asset. |
| Performance | Nativo em C, o mais rápido de todos — segundos para um clipe de 15-30s em 1080x1920. |
| Manutenção | O FFmpeg em si é extremamente estável (décadas de desenvolvimento). A carga de manutenção fica no "compilador" Zuno-específico (JSON → filtro), que é código próprio, testável como qualquer outra parte do projeto. |
| Compatibilidade Windows | Total. `ffmpeg-static` publica binário Windows x64 pronto, sem instalação manual. |
| Licença | FFmpeg é software livre; builds com libx264 costumam ser LGPL/GPL dependendo da configuração — sem custo, sem chamada de API, sem limite de uso. Zero risco de "API paga". |
| Instalação | `npm install ffmpeg-static` — resolve o binário automaticamente por plataforma. Sem passo manual, sem exigir FFmpeg pré-instalado no PATH do usuário. |
| Curva de aprendizado | Real, mas concentrada: quem escreve o adaptador precisa aprender `filter_complex`. O resto do time (e o usuário da CLI) não vê nada disso — fica encapsulado atrás da porta. |
| Feed/Stories/Reels/TikTok/FB/Shorts | Trivial — é só resolução/proporção/bitrate de saída, e o Zuno **já** calcula isso centralmente (`src/shared/utils/aspect-ratio.ts`, a "autoridade única de proporção" citada no CHANGELOG). FFmpeg não tem noção de "plataforma", só de números — o que já é exatamente como o resto do Zuno pensa sobre isso. |

### 2.2 Remotion (React + Chromium headless, render frame a frame)

| Critério | Avaliação |
|---|---|
| Integração | Pior encaixe da lista para *este* projeto: Zuno é hoje um backend Node/TS puro, sem React, sem DOM, sem Chromium em lugar nenhum. Remotion exigiria introduzir JSX, um paradigma de renderização (componentes React re-renderizados por frame) e um binário "compositor" (Chromium) — uma mudança de arquitetura, não uma adição pontual. Contraria diretamente "preservar integralmente a arquitetura atual". |
| Qualidade final | Excelente — provavelmente a melhor tipografia/animação da lista, porque renderiza CSS/DOM real via Chromium. |
| Animações | Ponto forte declarado do Remotion (`interpolate`, `spring`, easing) — teria sido mais rápido de escrever do que o código manual OpenCV+PIL feito nesta sessão. |
| Legendas | Boa (`@remotion/captions`), com todo o poder de CSS/fontes web. |
| Transições | Pacote oficial (`@remotion/transitions`) com presets prontos. |
| Imagens | Trivial (`<Img>`, como HTML normal). |
| Áudio | Suporte oficial (`@remotion/audio`), internamente ainda depende de FFmpeg para o encode final — ou seja, **Remotion não substitui FFmpeg, ele o envolve**. |
| Performance | Mais lento que FFmpeg puro para clipes curtos: cada frame é uma renderização de página Chromium antes do encode. Paralelizável, mas com overhead de processo bem maior. |
| Manutenção | Ativa e bem financiada, mas é uma dependência pesada (Chromium + compositor nativo por plataforma) para manter atualizada. |
| Compatibilidade Windows | Suportada oficialmente, mas historicamente com mais atrito (flags de GPU/software rendering do Chromium) do que um binário FFmpeg simples. |
| **Licença — ponto crítico** | Remotion **não é MIT/Apache puro**. É "source available" sob licença própria: grátis para indivíduos e empresas abaixo de um teto de faturamento anual (histórico: ~US$100k/ano); acima disso, **exige licença paga por empresa**. Isso é exatamente o tipo de custo que o pedido quer evitar — não é uma "API paga" no sentido literal, mas é uma obrigação financeira condicional embutida na ferramenta, que o FFmpeg simplesmente não tem. |
| Instalação | `npm install` de vários pacotes `@remotion/*` + download automático de binário de compositor — pegada bem maior que `ffmpeg-static`. |
| Curva de aprendizado | Baixa **se** o time já pensa em React; média/alta se não (que é o caso do Zuno hoje — zero uso de React em todo o repositório). |
| Feed/Stories/Reels/etc. | Tão fácil quanto FFmpeg (é só resolução de composição) — não é diferencial. |

**Conclusão sobre Remotion:** tecnicamente competente, mas é a opção que mais rompe com "preservar a arquitetura atual" (novo paradigma de UI, novo runtime Chromium) e a única com risco real de custo financeiro condicional via licença. Fica descartada não por qualidade, mas por não atender às duas restrições explícitas do pedido.

### 2.3 MoviePy (Python)

| Critério | Avaliação |
|---|---|
| Integração | Pior ajuste de linguagem: Zuno é 100% TypeScript/Node. Usar MoviePy significa Rafa (Node) chamando um subprocesso Python, que por sua vez chama FFmpeg — duas fronteiras de processo em vez de uma, dois gerenciadores de pacote (`npm` + `pip`) para manter em sincronia, dois runtimes para instalar/atualizar. |
| Qualidade final | Boa, mas o encode final ainda é feito chamando FFmpeg por baixo — MoviePy não é um motor de renderização próprio, é uma camada de conveniência Python sobre FFmpeg. Ou seja: **se o objetivo é qualidade FFmpeg, dá pra ter isso sem o Python no meio.** |
| Animações | API de clipes/composição razoável, mas texto (`TextClip`) historicamente depende do ImageMagick, uma dependência externa adicional com problemas conhecidos de política de segurança (bloqueio de operações de texto por padrão em algumas distros) — mais uma peça frágil na cadeia. |
| Legendas | Possível, mas menos direta que o filtro `subtitles` nativo do FFmpeg. |
| Transições | Suporte básico, menos rico que `xfade`. |
| Imagens/Áudio | Suportado, sempre via FFmpeg por baixo. |
| Performance | Historicamente mais lenta que FFmpeg puro (overhead do Python + reencodes intermediários comuns em pipelines MoviePy mal otimizados). |
| Manutenção | Passou por uma transição de API quebrada (1.x → 2.x) recente e tem menos contribuidores ativos que FFmpeg ou Remotion — maior risco de abandono/breaking changes. |
| Compatibilidade Windows | Funciona, mas herda a fragilidade do ImageMagick no Windows (instalação separada, variável de ambiente própria). |
| Licença | MIT, sem custo. |
| Instalação | Precisa de Python + pip + FFmpeg + (para texto robusto) ImageMagick — a instalação mais fragmentada da lista. |
| Curva de aprendizado | Baixa isoladamente, mas o custo real é organizacional: manter dois ecossistemas de dependências (`npm`/`pip`) num projeto que hoje é deliberadamente mono-stack. |

**Conclusão sobre MoviePy:** não traz nada que o FFmpeg direto não entregue, e adiciona uma fronteira de linguagem inteira (Python) a um projeto Node puro só para reembrulhar o mesmo FFmpeg. Pior custo-benefício da lista.

### 2.4 OpenCV (a abordagem usada manualmente nesta sessão)

| Critério | Avaliação |
|---|---|
| Integração | Mesma fronteira Python que o MoviePy, com o agravante de que `cv2.VideoWriter` **não lida com áudio** — qualquer trilha exigiria FFmpeg por cima de qualquer forma. Foi usado hoje só porque era a opção mais rápida de prototipar manualmente numa única sessão, não porque seja a escolha certa para produção. |
| Qualidade final | O vídeo gerado hoje usa o codec `mp4v` (MPEG-4 Part 2), **não H.264 real** — compatibilidade e compressão piores que o padrão de mercado, e diferente do que Rafa já promete no contrato técnico. Escrever H.264 de verdade via OpenCV exige FFmpeg como backend mesmo assim (build com suporte a `libx264`, nem sempre disponível nos pacotes pip padrão). |
| Animações/Transições/Legendas | Tudo manual, pixel a pixel (é literalmente o que o script desta sessão faz) — sem primitivas de alto nível, sem easing embutido, sem `xfade`. Cada nova animação é código novo, sem abstração reutilizável. Ótimo para uma prova de conceito pontual, ruim como base de um "compilador" genérico JSON→vídeo de longo prazo. |
| Áudio | Não suportado nativamente — precisaria FFmpeg de qualquer forma. |
| Performance | Boa para desenho de frame, mas sem otimizações de encode de vídeo de um encoder dedicado. |
| Manutenção | Alto custo: qualquer novo tipo de cena/transição = novo código de composição manual em vez de configuração declarativa. |
| Compatibilidade Windows | OK, mas o codec disponível varia por build/plataforma (foi preciso testar empiricamente hoje). |
| Licença | Apache 2.0, sem custo. |
| Instalação | `pip install opencv-python-headless` — simples isoladamente, mas ainda dentro do problema de fronteira Python descrito acima. |
| Curva de aprendizado | Baixa para gerar uma imagem estática; alta para replicar o que ferramentas dedicadas de vídeo já resolvem prontas (composição, timeline, transições). |

**Conclusão sobre OpenCV:** válido como playground manual (o que foi feito hoje), mas não é uma base defensável para uma "renderização automática" de produto — vira um mini-framework de animação caseiro e sem áudio, reinventando o que FFmpeg já resolve nativamente e melhor.

### 2.5 Shotstack (local)

Shotstack **não tem versão local/self-hosted** — é uma API SaaS proprietária (JSON de timeline → render na nuvem deles), com plano gratuito limitado e cobrança acima disso. Existe um SDK JS ("Shotstack Studio") para *preview* no browser, mas a renderização final ainda depende da API paga na nuvem. Isso viola diretamente duas restrições do pedido ao mesmo tempo (API paga + não é local). **Excluído por incompatibilidade de requisito, não por qualidade.**

### 2.6 Outras opções consideradas

- **Editly** (Node.js, MIT, `github.com/mifi/editly`) — merece menção por ser a mais parecida conceitualmente com o problema real do Zuno: recebe um JSON de "clipes + transições + títulos" e devolve um MP4, usando FFmpeg + Canvas/GL por baixo. Vantagem: nativo em Node (sem fronteira de linguagem), API já pensada para automação declarativa. Desvantagens: comunidade pequena e atividade de manutenção baixa nos últimos anos (risco de "bus factor"), menos tipos de transição/legenda que escrever direto em FFmpeg, e ainda seria uma dependência a mais para um projeto que hoje tem zero. **Fica como alternativa secundária razoável** se a prioridade for velocidade de implementação em vez de controle total — não como recomendação principal.
- **FFCreator** (Node.js, Canvas+FFmpeg, origem chinesa) — categoria semelhante ao Editly, com mais recursos de template pronto, mas dependência pesada de `node-canvas`/GL nativo (historicamente doloroso de compilar no Windows) e comunidade também pequena. Descartado por risco de manutenção e instalação.
- **GStreamer** — framework multimídia poderoso e multiplataforma, mas de nível muito mais baixo (pipelines de elementos) que os filtros do FFmpeg para o caso de uso "timeline com texto/transições/legendas". Distribuição Windows mais pesada e menos "turnkey" que um binário FFmpeg estático. Curva de aprendizado maior sem benefício correspondente para este problema. Descartado.
- **Motion Canvas** — voltado para animação autoral manual (estilo vídeo educacional), não para pipelines automatizadas dirigidas por JSON. Paradigma errado para o caso de uso do Rafa. Descartado.

---

## 3. Tabela comparativa consolidada

| | FFmpeg direto | Remotion | MoviePy | OpenCV | Editly | Shotstack local |
|---|---|---|---|---|---|---|
| Encaixe na arquitetura atual (zero deps, ports/adapters) | ✅ Ótimo | ❌ Rompe paradigma | ⚠️ Nova linguagem | ⚠️ Nova linguagem | ⚠️ Aceitável | ❌ Não existe |
| Qualidade de vídeo (H.264/AAC real) | ✅ Nativo | ✅ (via FFmpeg) | ✅ (via FFmpeg) | ❌ mp4v, sem áudio | ✅ (via FFmpeg) | N/A |
| Animações/transições de alto nível | ⚠️ Via filtros (verboso) | ✅ Melhor da lista | ⚠️ Básico | ❌ Manual | ⚠️ Presets prontos | N/A |
| Legendas | ✅ Nativo (`subtitles`) | ✅ Bom | ⚠️ Via ImageMagick | ❌ Manual | ✅ Bom | N/A |
| Áudio | ✅ Completo | ✅ (via FFmpeg) | ✅ (via FFmpeg) | ❌ Não suportado | ✅ (via FFmpeg) | N/A |
| Performance | ✅ Melhor | ⚠️ Mais lenta (Chromium) | ⚠️ Média | ✅ Boa (só vídeo) | ⚠️ Média | N/A |
| Instalação/Windows | ✅ `ffmpeg-static`, zero atrito | ⚠️ Pesada | ❌ Fragmentada | ⚠️ Aceitável | ✅ npm simples | N/A |
| Licença sem risco de custo | ✅ Livre | ❌ Teto de faturamento | ✅ Livre | ✅ Livre | ✅ MIT | ❌ SaaS pago |
| Maturidade/manutenção | ✅ Décadas, padrão da indústria | ✅ Ativa (empresa) | ⚠️ Instável recentemente | ✅ Estável | ❌ Comunidade pequena | N/A |
| Multi-formato (Feed/Stories/Reels/TikTok/FB/Shorts) | ✅ Trivial (só números) | ✅ Trivial | ✅ Trivial | ✅ Trivial | ✅ Trivial | N/A |

---

## 4. Recomendação para a v1.1

**FFmpeg, chamado diretamente via `node:child_process`, distribuído via o pacote `ffmpeg-static`, encapsulado atrás de uma nova porta de aplicação (ex.: `VideoRenderingPort`) implementada por um único adaptador de infraestrutura (`FfmpegVideoRendererAdapter`).**

### Por que esta e não as demais, tecnicamente:

1. **É a única opção que não força uma escolha entre "preservar a arquitetura atual" e "ter qualidade real de vídeo".** Remotion, MoviePy, OpenCV e Editly resolvem o encode final chamando FFmpeg de qualquer forma (exceto OpenCV, que sacrifica qualidade/áudio para evitar isso) — ou seja, FFmpeg já é uma dependência transitiva inevitável de quase todas as alternativas. Consumi-lo diretamente elimina a camada intermediária sem perder nada.
2. **É a única sem nenhum risco de custo financeiro embutido.** Remotion tem licença condicionada a faturamento; Shotstack é SaaS pago; as demais são livres — mas só FFmpeg entrega qualidade de produção livre de qualquer condição.
3. **Mantém o princípio de zero dependências de runtime quase intacto.** Uma dependência (`ffmpeg-static`) versus o ecossistema inteiro do React+Chromium (Remotion) ou um segundo runtime de linguagem (MoviePy/OpenCV via Python).
4. **Já é o que Rafa promete tecnicamente.** O contrato de especificações de Rafa já declara `"videoCodec": "H.264 (libx264)"` e `"audioCodec": "AAC"` desde a v1.0 — usar FFmpeg é cumprir uma promessa já feita no código, não inventar uma nova.
5. **Respeita o isolamento de Skills sem exceção.** Entra como porta/adaptador, do mesmo jeito que toda integração de I/O do Zuno já é feita — nenhuma mudança de padrão arquitetural, só mais um adaptador na pasta `src/infrastructure/`.
6. **É a opção mais rápida em runtime e mais simples de depurar em produção local** — um processo, um binário, sem servidor Chromium para gerenciar.

### Ressalva importante para o escopo real da v1.1

Isso resolve a renderização mecânica (timeline → MP4 real), não o problema de conteúdo: como o plano de Diego/Bruno não referencia B-roll/música como arquivos concretos (§1.3), o escopo honesto para v1.1 é **motion graphics automatizado** — texto, cores da marca, transições, mockups de tela, logo — com o mesmo nível de resultado do protótipo desta sessão, mas com qualidade de encode real (H.264/AAC) e de forma automática (sem intervenção manual). Filmagem real de pessoas continua fora do alcance de qualquer ferramenta local gratuita e seria um segundo projeto (sourcing de B-roll herói, banco de imagens/vídeo próprio, ou geração por IA — explicitamente fora de escopo aqui).

Nenhum código foi alterado para produzir esta análise.
