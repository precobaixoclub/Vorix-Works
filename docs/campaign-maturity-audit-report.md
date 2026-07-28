# Auditoria de maturidade — Campanha institucional "Todo casamento merece um lugar oficial"

**Nenhum código foi alterado. Nenhuma correção foi aplicada.** Este relatório documenta uma execução real, ponta a ponta, da pipeline do Zuno exatamente como ela existe hoje, seguida de uma auditoria crítica honesta.

Campanha: `campaign-mrjr6iqb-b4chy9` (Campaign Manager, tipo `divulgacao`, 5 conteúdos, 100% publicados no sentido de "concluídos localmente" — nada foi publicado de verdade em rede social, LOCAL_PRODUCTION).

Produto: rumoaoaltar.com.br | Tema: "Todo casamento merece um lugar oficial." | Nenhum formato foi informado por mim — Eduardo decidiu format/quantidade/ordem via Campaign Manager + editorial planning em cada peça.

---

## 1. O que foi executado de verdade

| # | Papel | Formato (decidido pelo Zuno) | Execução | Pipeline | Duração de execução |
|---|---|---|---|---|---|
| 1 | Abertura | Carrossel (4 slides, 1080x1350) | `workflow-execution-mrjr7xu3-9oqm1a` | Eduardo→João→Maria→Sofia→Bianca→Pedro→Lucas→Aprovação | 6min 50s |
| 2 | Desenvolvimento | Reels (30s → renderizado em 28,05s, 1080x1920) | `workflow-execution-mrjrh6xd-bib2u5` | Eduardo→João→Bruno→Vanessa→Diego→**Nora**→Rafa→Maria→Lucas→Aprovação | 7min 27s |
| 3 | Prova social | Post único (1080x1350) | `workflow-execution-mrjrt77m-svm095` | idêntico ao 1 | 4min 24s |
| 4 | Desenvolvimento | Story (3 telas, 1080x1920) | `workflow-execution-mrjrz6o8-y8xt6q` | idêntico ao 1 | 3min 42s |
| 5 | CTA final | Carrossel (4 slides, 1080x1350) | `workflow-execution-mrjs4bss-6ffo4k` | idêntico ao 1 | 3min 48s |

Capacidades pedidas explicitamente e sua utilização real confirmada:

- **Clara**: consultada em toda peça (BrandContext, IdentityContext, PublishingContext, ProductContext, AudienceContext) — confirmado nos pacotes de trabalho de cada Skill.
- **Campaign Manager**: decidiu sozinho 5 peças, ordem, papéis narrativos (abertura/desenvolvimento/prova_social/desenvolvimento/cta_final), formato recomendado por peça, canal, CTA forte vs. suave e datas — tudo antes de eu escrever qualquer coisa.
- **Quality Feedback**: as 5 peças foram avaliadas via `--rate` (nota real: 8, 5, 7, 7, 7 — média 6.8) com categorias específicas de melhoria por peça.
- **Biblioteca Editorial (Clara Módulo 9)** e **Aprendizado (Módulo 6)**: sincronizados automaticamente a cada `--rate` — confirmado em `.zuno-data/knowledge.json` (`EditorialLibraryContext`, `LearningContext` populados).
- **Asset Resolver / biblioteca de assets visuais**: acionado automaticamente por Rafa na peça 2 (Reels) — **fotografia real de estoque** (polaroids de casamento, alianças, velas) foi selecionada automaticamente para os fundos das cenas, sem eu fornecer nada. Este é um resultado real e positivo.
- **Nora**: gerou o roteiro de narração real; como não existe motor de TTS embutido no Zuno, a voz real foi sintetizada localmente via SAPI do Windows (voz `Microsoft Maria Desktop`, pt-BR, sem nenhuma API externa) — narração real de 28s, mixada de verdade no MP4 final (AAC, confirmado via inspeção independente do arquivo).
- **Motion**: zoom/pan/vinheta aplicados pela Rafa em todas as cenas do Reels — mas avaliado pela própria revisão heurística do Lucas como "fraco" (ver seção 3).
- **Música local**: nenhuma foi fornecida (não informada por mim, por instrução explícita do usuário para executar "exatamente como está hoje" sem decisões extras minhas de asset); o vídeo tem narração real mas nenhuma trilha — corretamente registrado como `musicDuckingApplied: false` no metadata.

---

## 2. Respostas às 10 perguntas de avaliação

**1. As peças parecem fazer parte da mesma campanha?**
Sim, no nível de marca (paleta #C97F91/#111111/#FFFFFF consistente, logo/wordmark presente em todas, CTA pill sempre no mesmo estilo). Não, no nível de coerência narrativa automática: nada no sistema liga as 5 peças entre si além do que eu escrevi manualmente em cada resposta assistida (ver achado estrutural na seção 4).

**2. Existe evolução narrativa entre elas?**
Sim, mas 100% por autoria manual minha, não por capacidade do sistema. João não recebe nenhum contexto sobre as outras peças da campanha — cada execução é isolada. Fiz a jornada evoluir manualmente (lugar oficial → RSVP → prova social com álbum/cronograma → lembrete/cronograma → fechamento), mas o Zuno não teria feito isso sozinho se eu tivesse escrito 5 respostas genéricas.

**3. As imagens possuem variedade?**
Parcialmente. As 4 peças de imagem (1, 3, 4, 5) têm conceitos visuais diferentes (mesa+laptop, mãos+celular, planner, casal+altar) e paletas de fundo diferentes — mas **nenhuma delas é fotografia real**; todas são composições tipográficas planas (gradiente/sólido + headline + CTA pill), então a variedade é de cor e composição de texto, não de imagem de verdade.

**4. Os layouts são diferentes?**
Sim, entre peças (hierarquia, posição do kicker, presença/ausência de mockup). Não completamente dentro do Reels: a revisão heurística do Lucas detectou **2 repetições de padrão de layout** nas cenas de desenvolvimento do vídeo, e a mesma foto de estoque (polaroids/alianças) foi reutilizada em 2 das 5 cenas.

**5. Os CTAs mudam conforme o objetivo?**
Muito pouco. 4 das 5 peças usam o texto de CTA idêntico ("Conheça o Rumo ao Altar") — só a peça 5 (fechamento) usa um CTA diferente ("Criar meu site"), porque o Campaign Manager só distingue CTA "forte" (última peça) de CTA "suave" (todas as outras), não um CTA por objetivo/papel narrativo.

**6. As headlines não se repetem?**
Confirmado por inspeção manual: nenhuma headline é repetida literalmente entre as 5 peças ou dentro de cada peça.

**7. As cenas dos vídeos parecem cinematográficas?**
Parcialmente. A cena de CTA final (mockup do app + logo) é genuinamente forte. As cenas de desenvolvimento repetem a mesma foto de fundo, o texto na tela é redundante com a narração (achado do próprio Lucas: `VIDEO_VOICE_TEXT_REDUNDANT`), e a composição de motion foi avaliada como fraca pelo próprio sistema (`VIDEO_MOTION_COMPOSITION_WEAK`, `VIDEO_VISUAL_DEPTH_WEAK`).

**8. Os Stories parecem realmente Stories?**
No formato, sim (9:16 real, 3 telas, confirmado). No conteúdo, não totalmente: Bianca especificou uma barra de progresso nativa de Stories no briefing, mas ela nunca foi de fato desenhada nas imagens finais (limitação da minha própria produção assistida, não do texto do briefing). As hashtags também seguem o volume de feed (15), quando Stories normalmente nem exibem hashtags da mesma forma.

**9. Os Reels parecem anúncios?**
Não totalmente. A revisão heurística interna do próprio Zuno **reprovou** esta peça (score 55/100, `needs_adjustments`, `approvalRecommended: false`) — evidência de que o próprio sistema, quando teve a chance de se auto-avaliar de verdade, não considerou o resultado pronto para publicação.

**10. As imagens parecem produzidas por uma agência?**
Não. São graficamente competentes (tipografia limpa, hierarquia clara, paleta de marca respeitada), mas visualmente mais próximas de um slide de apresentação bem feito do que de uma fotografia de campanha publicitária — porque não existe, hoje, nenhum caminho de geração fotorrealista real conectado a Pedro.

---

## 3. Evidência real por peça (não apenas relato)

- **Peça 1 (carrossel abertura)**: score heurístico do Lucas = 100/100 — mas o heurístico só valida presença/coerência estrutural de texto, não qualidade fotográfica. Inspeção visual confirma: composição tipográfica, mockup de tela estilizado (não fotografia).
- **Peça 2 (Reels)**: score heurístico do Lucas = **55/100, `needs_adjustments`, `approvalRecommended: false`** — reprovado pelo próprio sistema. Issues reais: `VIDEO_MOTION_COMPOSITION_WEAK`, `VIDEO_VISUAL_DEPTH_WEAK`, `VIDEO_LAYOUT_REPETITIVE` (2 repetições), `VIDEO_AUDIO_DUCKING_MISSING`, `VIDEO_VOICE_TEXT_REDUNDANT`. Achado adicional por inspeção de frame: texto na tela cortado com reticências ("...") em headlines mais longas; a mesma foto de estoque (polaroids+alianças) aparece nas cenas 1, 2 e 4 de 5; **a cena de CTA final narra literalmente o mesmo texto do gancho** ("Seus convidados confirmam presença em segundos...") em vez do CTA real — bug real de Bruno (a última cena não usa `finalCta` para `spokenText`/`onScreenText`). Vídeo final real: H.264+AAC confirmados por inspeção independente (`ffmpeg -i`), 28,05s, narração real sintetizada localmente (não simulada).
- **Peça 3 (post único)**: score heurístico = 100/100. Card de citação tipográfico, não a fotografia candid pedida pela Sofia; elemento decorativo (aspas) saiu pequeno demais na execução.
- **Peça 4 (Story)**: score heurístico = 100/100. Formato 9:16 correto; barra de progresso nativa especificada por Bianca não foi desenhada; hashtags no volume de feed, não adaptado a Stories.
- **Peça 5 (carrossel fechamento)**: score heurístico = 100/100. CTA corretamente diferenciado ("Criar meu site"). **Slide 1 é a peça visual mais fraca de toda a campanha**: a direção de arte pedia uma cena de casal caminhando ao entardecer, e o resultado real é apenas um gradiente de cor com texto — nenhuma tentativa figurativa, ao contrário das outras peças que ao menos simulam um mockup ou elemento still-life.

**Score médio real de Quality Feedback (avaliação humana pós-execução): 6,8/10**, com "imagem" como reclamação mais recorrente (60% das peças) — consistente com a análise técnica acima.

---

## 4. Notas honestas (0-10) — comparadas a uma agência profissional

| Dimensão | Nota | Por quê |
|---|---|---|
| Estratégia | 8 | Campaign Manager decidiu papéis/formato/ordem de forma coerente e o resultado final tem arco de campanha real — mas só porque eu autorei a continuidade manualmente peça a peça; o sistema não teria produzido isso sozinho com respostas genéricas. |
| Imagem | 4 | Zero capacidade fotorrealista real conectada a Pedro; toda peça de imagem contraria diretamente o mandato explícito da Sofia ("sempre cena fotográfica, nunca aparência de template"). |
| Vídeo | 5 | Capacidades reais existem (narração real, asset de estoque real, motion) e funcionaram parcialmente — mas o próprio sistema reprovou o resultado (55/100) com defeitos concretos e reproduzíveis. |
| Motion | 5 | Zoom/pan/vinheta aplicados de verdade, mas avaliados como "composição fraca" e "profundidade fraca" pela própria revisão heurística. |
| Assets | 6 | Ponto real positivo: fotografia de estoque real selecionada automaticamente (sem eu fornecer nada) na peça de vídeo — mas repetida dentro do próprio vídeo, e sem equivalente algum para imagens estáticas. |
| Layout | 6 | Variedade real de composição entre as 5 peças; repetição real detectada dentro do vídeo. |
| Storytelling | 7 | Arco completo cobrindo as 5 funcionalidades pedidas (site, RSVP, presentes, álbum, cronograma) sem nunca virar campanha só de lista de presentes — mas inteiramente por autoria manual, não por capacidade nativa do sistema. |
| Copy | 8 | Headlines distintas, tom consistente, boa estrutura de gancho/benefício/CTA — mas CTA praticamente idêntico em 4 das 5 peças, e hashtags não adaptadas por formato. |
| Criatividade | 5 | Ideias narrativas boas (depoimento específico, demonstração de RSVP, planner físico) capadas por um teto de execução visual limitado a design gráfico plano. |
| Consistência | 7 | Paleta, CTA-pill, logo e tom mantidos em toda a campanha; penalizada pela substituição de fontes de marca (Playfair Display/Inter ausentes localmente) e pelo bug de narração da peça 2. |
| Marca | 7 | Termos proibidos respeitados, palavras obrigatórias presentes, paleta oficial aplicada em todas as peças; mesma penalização de fonte. |

**Comparação com uma agência profissional real**: uma agência não entregaria imagens de carrossel/post/story como composições tipográficas planas alegando ser "fotografia de campanha" — apresentaria isso como wireframe/rascunho de copy, não como entrega final. O vídeo está mais perto de publicável, mas mesmo ele foi reprovado pela própria revisão de qualidade interna do sistema antes de eu aprovar manualmente para fins de auditoria.

---

## 5. O que ainda impede este material de ser publicado por uma agência premium

**Cenas fracas:**
- Slide 1 da peça 5 (fechamento) — nenhuma tentativa figurativa da cena de casal pedida, só gradiente + texto. É a cena mais fraca de toda a campanha, justamente na peça de maior prioridade de conversão.
- Cenas "Gancho" e "Desenvolvimento 3" do Reels (peça 2) — fundo de estoque idêntico reutilizado.

**Layouts que repetiram:**
- Detectado pelo próprio Lucas: 2 repetições de padrão de layout dentro do Reels.
- Nas peças de imagem, todas convergem para o mesmo template subjacente (gradiente/sólido + headline centralizada + CTA pill) — a variedade é de cor, não de estrutura, porque não há fotografia real para diferenciar de verdade.

**Assets pobres:**
- 8 dos 8 slides estáticos da campanha (peças 1, 3, 4, 5) são gráficos tipográficos, não fotografia.
- Barra de progresso nativa de Stories (especificada por Bianca) nunca foi de fato desenhada.
- Fontes reais da marca (Playfair Display, Inter) ausentes localmente — todas as peças usam substitutas (Georgia/Segoe UI).

**CTAs que poderiam melhorar:**
- 4 de 5 peças usam o texto de CTA idêntico. Um Reels sobre RSVP poderia ter um CTA como "Ative o RSVP do seu casamento" em vez do CTA genérico de marca — o Campaign Manager só sabe diferenciar CTA "forte" (última peça) de "suave" (todas as demais), não um CTA por papel narrativo.

**Vídeos que ainda parecem automáticos:**
- A cena de CTA final do Reels narra o texto do gancho, não o CTA real — bug real e reproduzível de Bruno.
- Texto na tela redundante com a narração (mesmo problema identificado pelo próprio Lucas).
- Fundo de estoque repetido dentro do mesmo vídeo de 30s.

**Imagens que ainda parecem "IA"/genéricas:**
- Não porque pareçam "geradas por IA" no sentido usual (glitches, anatomia estranha) — porque são reconhecíveis como o mesmo template de slide de apresentação em todas as peças, sem nenhuma textura fotográfica real para diferenciá-las.

**Onde a narrativa perdeu força:**
- Exatamente na peça mais importante para conversão (peça 5, fechamento): é onde a execução visual está mais fraca, o oposto do que uma agência real priorizaria.

---

## 6. Conclusão honesta

**A pipeline não está pronta para produção premium hoje**, mas a execução desta campanha revela uma maturidade real e mensurável em partes específicas do sistema — especialmente o pipeline de vídeo (narração real, seleção automática de asset de estoque real, motion aplicado) e a camada de orquestração de campanha (Campaign Manager decidindo quantidade/ordem/papel/formato sozinho, Quality Feedback e Biblioteca Editorial funcionando de ponta a ponta).

**Bloqueadores, em ordem de prioridade:**

1. **[Capacidade/código, prioridade máxima]** Pedro (geração de imagem) não tem nenhum caminho de geração fotorrealista — 100% Developer Assisted sem provider de IA de imagem nem asset resolver equivalente ao de Rafa. Isso sozinho barra as 4 das 5 peças desta campanha (todas as de imagem) de qualquer publicação premium real.
2. **[Código, alta prioridade]** Bug real em Bruno: a última cena do roteiro de vídeo não usa `finalCta` para o texto falado/na tela quando o número de mensagens-chave é menor que o de cenas — causa a cena de CTA repetir o gancho.
3. **[Código, prioridade média]** Nenhuma memória de campanha é passada a Arthur/Eduardo/João entre peças — toda coerência narrativa observada aqui foi autoria manual minha, não capacidade nativa. Sem isso, cada execução futura da campanha depende inteiramente de quem estiver respondendo no modo assistido.
4. **[Assets, alta prioridade]** Fontes reais da marca (Playfair Display, Inter) não disponíveis localmente.
5. **[Assets, prioridade média]** Biblioteca de assets visuais locais rasa o suficiente para repetir a mesma foto dentro de um único vídeo de 5 cenas.
6. **[Código, prioridade menor]** Volume de hashtags de Maria não varia por formato (Stories recebe o mesmo volume de feed).

Nenhuma dessas correções foi aplicada nesta tarefa, por instrução explícita — este relatório é uma auditoria, não uma implementação.
