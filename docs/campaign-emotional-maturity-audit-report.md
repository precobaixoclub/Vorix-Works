# Auditoria de maturidade — Campanha "Vocês cuidam do amor. Nós cuidamos da organização."

**Nenhum código foi alterado.** Execução real, ponta a ponta, exatamente como a pipeline existe hoje. Este é o segundo teste de maturidade do Zuno como agência (o primeiro, institucional/feature-aware, está em `docs/campaign-maturity-audit-report.md`) — desta vez com um briefing deliberadamente mais exigente: 100% emocional, zero lista de funcionalidades, cenas humanas, sem slideshow em vídeo.

Campanha: `campaign-mrjz0kzk-28zx0u` (Campaign Manager, tipo `divulgacao`, 5 conteúdos, 100% concluídos localmente — LOCAL_PRODUCTION, nada publicado). Formato/quantidade/sequência decididos pelo Eduardo/Campaign Manager, sem eu informar nada disso.

---

## 1. O que foi executado

| # | Papel narrativo (meu) | Formato (decidido pelo Zuno) | Execução | Nota (Quality Feedback) |
|---|---|---|---|---|
| 1 | O sonho | Carrossel, 4 slides | `workflow-execution-mrjz1zpz-quwbfg` | 7/10 |
| 2 | O caos → como resolve | Reels | `workflow-execution-mrjz776i-9rcliz` | **4/10** |
| 3 | A tranquilidade (prova social) | Post único | `workflow-execution-mrjzezfo-9viiej` | 7/10 |
| 4 | O lembrete | Story, 3 telas | `workflow-execution-mrjzip5d-ct13h5` | 8/10 |
| 5 | O convite | Carrossel, 4 slides | `workflow-execution-mrjzmoaz-9uvlcp` | 6/10 |

Mesma sequência de formatos da campanha anterior (carrossel→reels→post único→story→carrossel) — Eduardo/Campaign Manager convergem de forma consistente para essa estrutura em campanhas institucionais tipo `divulgacao`.

**Nenhuma funcionalidade foi citada em nenhuma das 5 peças** (RSVP, presentes, site, álbum, cronograma, convidados — nenhuma delas aparece no texto de nenhuma peça). Confirmado por revisão de todo o texto gerado. Esse era um requisito explícito e foi cumprido de forma completa.

---

## 2. Achado crítico real (não presente na campanha anterior)

**O vídeo da peça 2 termina 8 segundos antes do planejado e nunca chega a mostrar o CTA.**

- Roteiro planejado: 30s, 5 cenas (Gancho 0-6s, Desenvolvimento 1-3 6-24s, CTA final 24-30s).
- Narração real gerada (via síntese de voz local do Windows, já que o Zuno não tem motor de TTS embutido): 22,1s.
- Arquivo de vídeo final real, inspecionado de forma independente (`ffmpeg -i`, não apenas os metadados do próprio sistema): **22,10s**, terminando no meio da cena "Desenvolvimento 3". **A cena de CTA final (logo, "Conheça o Rumo ao Altar") nunca é renderizada.**
- Os metadados internos de Rafa (`specs.durationSeconds`, `audioDuration`) reportam **30s** — o valor planejado, não o real. Ou seja: **o próprio sistema não sabe que cortou o próprio vídeo.**
- Causa técnica provável: a narração (papel diferente da trilha musical) não é repetida em loop para preencher a duração total; a flag `-shortest` do FFmpeg então corta o vídeo inteiro na duração da narração, não só o áudio.
- Confirmado pela revisão heurística interna do próprio Lucas: `reviewStatus: "needs_adjustments"`, score 55/100, `approvalRecommended: false` — pior até que a peça equivalente da campanha anterior (que tinha o mesmo score, mas ao menos chegava ao CTA).

Este achado por si só reprova a peça para qualquer padrão profissional: um Reels sem call-to-action não é um anúncio incompleto — é um anúncio sem propósito comercial.

---

## 3. Respostas às 10 perguntas

**1. A campanha emociona ou apenas informa?**
Emociona mais do que informa — no conteúdo. Nenhuma peça lista funcionalidades; todas as 5 falam de sensação (presença, alívio, tranquilidade, decisão). Mas a execução visual (design gráfico plano em vez de fotografia) e o vídeo sem CTA cortam parte do impacto emocional pretendido antes de ele se completar.

**2. Existe evolução narrativa?**
Sim, no roteiro que eu autorei manualmente peça a peça (sonho → caos → virada → tranquilidade → convite), com ganchos, tom e CTA coerentes com cada etapa. Mas — mesmo achado da auditoria anterior — nenhuma dessas 5 execuções recebeu contexto automático sobre as outras peças da campanha; a evolução existe porque eu escrevi assim, não porque o Zuno tem memória de campanha.

**3. As peças parecem pertencer à mesma campanha?**
Majoritariamente sim (paleta, estilo de CTA, logo consistentes). Mas o slide 1 da peça 1 e o slide 1 da peça 5 (pensados como "bookend" — abertura e fechamento ecoando a mesma imagem) ficaram visualmente quase idênticos por causa do vocabulário visual limitado da ferramenta (mesmo pictograma, gradiente parecido) — a repetição não lê como eco intencional, lê como repetição mesmo.

**4. Existe excesso de mockups?**
Não — pelo contrário. Por instrução explícita ("mockup nunca deve dominar"), 4 das 5 peças não têm nenhum mockup de produto. A única cena de vídeo que teria um mockup (a tela do site no CTA final do Reels) nunca chega a aparecer, por causa do corte de duração. Resultado: o produto está quase ausente visualmente na campanha inteira.

**5. Existe excesso de texto?**
Não. Texto mínimo em todas as peças — a peça 1 (slide 1) não tem nenhuma palavra, e nenhuma peça passa de uma frase curta por tela/slide. Este requisito foi cumprido com folga.

**6. O produto aparece naturalmente?**
Quase não aparece — nem naturalmente, nem de nenhuma outra forma. Ao evitar mockup e funcionalidade ao mesmo tempo, o produto real fica reduzido ao nome da marca e ao CTA. É defensável para uma campanha 100% emocional de abertura, mas levada às 5 peças inteiras, isso é provavelmente longe demais: uma campanha real precisaria, em algum momento (provavelmente a peça 2 ou 5), mostrar pelo menos um vislumbre real do produto.

**7. O casal é o protagonista ou o sistema é o protagonista?**
O casal, de forma consistente e confirmada — nenhuma peça tem uma tela dominada por interface, lista ou funcionalidade. Este é o ponto mais bem-sucedido de toda a auditoria.

**8. Se uma agência entregasse essa campanha, ela seria aprovada?**
Não, principalmente por causa da peça 2: um Reels que fisicamente nunca mostra o CTA não passaria de rascunho em qualquer processo de revisão real. As peças de imagem, apesar da disciplina conceitual real, ainda leem mais como wireframe emocional do que como fotografia de campanha finalizada.

**9. Qual peça ficou mais memorável?**
Peça 1, slide 1 (sem nenhum texto, só a cena) — a expressão mais ousada e pura do tema da campanha. Em termos de execução técnica completa, a peça 4 (Story) foi a mais bem resolvida (barra de progresso nativa desenhada corretamente, hashtags adaptadas ao formato).

**10. Qual peça ainda parece automática?**
Peça 2 (Reels), sem dúvida — pela combinação de: vídeo cortado antes do fim, metadados que não refletem a realidade do arquivo, revisão heurística interna reprovada, e o mesmo asset de estoque (still-life de polaroids/alianças) já usado na campanha anterior.

---

## 4. Notas individuais (0-10)

| Dimensão | Nota | Justificativa |
|---|---|---|
| Estratégia | 8 | Eduardo/Campaign Manager decidiram formato/sequência de forma coerente; arco emocional real sem nenhuma menção a funcionalidade — mas inteiramente por autoria manual peça a peça, sem memória de campanha nativa. |
| Criatividade | 5 | Ideias reais (pictograma de casal, barra de progresso de Stories, citação editorial) — tetadas pelo mesmo limite de execução visual plana; a tentativa de "bookend" entre peça 1 e 5 saiu repetitiva, não intencional. |
| Storytelling | 7 | Arco de 5 atos coerente (sonho→caos→solução→tranquilidade→convite), zero funcionalidade citada — mas o produto quase desaparece da narrativa a ponto de arriscar over-correction. |
| Copy | 8 | Elegante, sem clichês óbvios, "casamento" usado com moderação, texto mínimo respeitado — penalizada por uma repetição real (headline e botão do CTA da peça 1 dizem literalmente a mesma frase). |
| Direção de arte | 6 | Conceitos genuinamente variados e humanos, evitando mockup e still-life repetitivo entre peças — mas a distância entre o que a Sofia pede (fotografia) e o que é fisicamente produzido continua enorme. |
| Imagem | 4 | Mesma limitação estrutural da auditoria anterior: zero capacidade fotorrealista conectada a Pedro; toda imagem é composição gráfica plana com um pictograma abstrato tentando (e não conseguindo) sugerir presença humana real. |
| Vídeo | **3** | Pior nota da auditoria: vídeo fisicamente incompleto (corta antes do CTA), metadados incorretos sobre a própria duração, revisão heurística interna reprovada (55/100) com mais repetições de layout que a execução anterior. |
| Motion | 5 | Zoom/pan/vinheta aplicados de verdade, mas a própria revisão heurística classifica a composição e a profundidade como fracas — sem mudança desde a auditoria anterior. |
| Narração | 6 | Voz real, natural e acolhedora (não simulada) — mas tecnicamente idêntica ao texto na tela (limitação estrutural: Bruno gera os dois a partir do mesmo texto, não há como diferenciar), e nesta execução a narração da cena de CTA nem chega a ser ouvida, porque a cena nunca renderiza. |
| Consistência | 7 | Paleta, CTA-pill e logo mantidos; penalizada pela repetição visual não intencional entre peça 1 e peça 5. |
| Conversão | 5 | CTA muda só na peça de fechamento (mesmo padrão binário "forte vs. suave" da campanha anterior); a peça de maior potencial de conversão (Reels) termina sem call-to-action nenhum. |

**Nota geral da campanha: 5,5/10.**

Abaixo da nota geral da campanha institucional anterior (que tratava de funcionalidades) — não porque a ambição criativa piorou (pelo contrário: esta campanha é mais ousada, mais disciplinada emocionalmente, e corrigiu dois bugs reais da execução anterior, aspas pequenas e barra de progresso ausente) — mas porque o teste mais exigente desta vez expôs um defeito estrutural real e mais grave no pipeline de vídeo (o corte antes do CTA), que uma campanha focada em funcionalidades, com narrações mais próximas da duração planejada, não havia revelado antes.

## 5. O que mudou desde a auditoria anterior (para melhor e para pior)

**Para melhor:**
- Barra de progresso nativa de Stories, antes só descrita e nunca desenhada, agora existe de verdade.
- Elemento de citação (aspas) corrigido de escala.
- Nenhuma peça citou funcionalidade — desafio mais difícil que o da campanha anterior, cumprido com disciplina real.
- Zero excesso de mockup ou texto — ambos requisitos explícitos cumpridos com folga.

**Para pior / achado novo:**
- Bug crítico de duração: vídeo real mais curto que o planejado, CTA nunca renderizado, metadados do próprio sistema incorretos sobre a duração real do arquivo — o achado mais grave de toda a auditoria (esta ou a anterior).
- Nota geral da campanha caiu de 6,8 (anterior) para 5,5 (esta), com "vídeo" caindo de 5 para 3.
