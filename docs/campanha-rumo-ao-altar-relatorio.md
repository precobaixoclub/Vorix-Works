# Relatório da campanha — Rumo ao Altar: "Organizar um casamento pode ser muito mais simples do que parece"

**Data de execução:** 2026-07-10
**Objetivo da campanha:** aumentar os cadastros de novos casais no Rumo ao Altar.
**Modo:** `LOCAL_PRODUCTION` (Developer Assisted Mode para imagem/vídeo). **Nada foi publicado de verdade** — Ana devolveu `local_ready`/`dry_run` nas 6 peças.
**Canal:** Instagram, identidade visual cadastrada do Rumo ao Altar (Clara).

---

## ⚠️ Aviso importante antes dos detalhes

Duas limitações do ambiente `LOCAL_PRODUCTION` afetam o que está sendo entregue e precisam ficar claras:

1. **Pixels/vídeo são placeholder.** Pedro e Rafa operam em Developer Assisted Mode: não existe gerador de imagem/vídeo real configurado nesta fase. Como não tenho uma ferramenta de geração de imagem/vídeo disponível neste ambiente, os arquivos PNG/MP4 salvos são **arquivos tecnicamente válidos (assinatura e resolução corretas) usados como placeholder**, não a arte final. O entregável criativo real são os **prompts completos** (seção 5) — prontos para serem usados em qualquer gerador de imagem/vídeo real ou por um designer.
2. **A copy e o conceito visual não variam por tema.** O `Ícaro` (camada de IA) usa nesta fase o `DeterministicFakeIcaroProvider` — um provider **determinístico, documentado no próprio código como "uso exclusivo para testes/demonstração"**, que devolve sempre a mesma resposta fixa para João (ângulo/mensagens-chave), Maria (legenda/hashtags) e Sofia (conceito visual), **independentemente do tema pedido**. Na prática: as 6 peças desta campanha têm a mesma legenda, os mesmos hashtags e o mesmo conceito visual de base (about "lista de presentes com taxa zero via Pix"), mesmo as peças sendo sobre RSVP, álbum colaborativo, cronograma etc. **O que realmente varia por peça, corretamente, é a camada estratégica do Eduardo** (seção 4) — formato, objetivo, emoção, prioridade de conversão e estrutura narrativa — porque essas decisões são heurísticas (não dependem do Ícaro). Para uma campanha real com copy/design distintos por tema, é necessário configurar um provider de IA real (fora do escopo desta execução, que foi "executar a pipeline normalmente").

Abaixo, o relatório completo do que foi decidido e gerado.

---

## 1. Estratégia da campanha (decisão de composição e sequência)

O pedido fixou a composição (1 carrossel, 1 Reels, 3 Stories, 1 imagem única) e os 6 pontos a explorar, mas não a ordem nem qual ponto vai em qual formato — essa parte da decisão coube a mim, como planejamento de campanha (o Campaign Manager do Zuno não foi usado aqui porque ele decide a composição sozinho a partir de duração; esta campanha tinha composição já fixada pelo usuário, então cada peça foi executada individualmente pela CLI, com o Eduardo decidindo a estratégia de cada uma). Sequência escolhida, com a lógica de cada posição:

| # | Formato | Tema | Papel na campanha |
|---|---|---|---|
| 1 | Reels | Site do casamento | Abertura de alto alcance — Reels tende a ter o maior alcance orgânico no Instagram; ótimo para o primeiro impacto "uau" mostrando a plataforma em movimento. |
| 2 | Carrossel | Painel dos noivos | Aprofundamento — carrossel é o formato certo para explicar em sequência como o painel centraliza tudo (site, presentes, RSVP, álbum, cronograma). |
| 3 | Imagem única | Lista de presentes com taxa zero | Maior gancho comercial da marca — merece uma peça isolada, sem concorrer por atenção com outras mensagens. |
| 4 | Story | RSVP | Lembrete rápido e direto — Story é o formato certo para uma mensagem única e de ação imediata. |
| 5 | Story | Álbum colaborativo | Conexão emocional/comunitária, em formato leve e rápido. |
| 6 | Story | Cronograma | Fechamento da campanha, reforçando organização e convidando ao cadastro — CTA final. |

## 2. Skills que participaram

| Skill | Papel | Participou em |
|---|---|---|
| Eduardo | Planejamento editorial (decide formato, objetivo, emoção, CTA, estrutura narrativa) | Todas as 6 peças |
| João | Estratégia de marketing | Todas as 6 |
| Maria | Copywriting | Todas as 6 |
| Sofia | Direção de arte | Peças 2, 3, 4, 5, 6 (pipeline de imagem) |
| Bianca | Design de redes sociais | Peças 2, 3, 4, 5, 6 |
| Pedro | Geração de imagem (Developer Assisted Mode) | Peças 2, 3, 4, 5, 6 |
| Bruno | Roteiro de vídeo | Peça 1 (Reels) |
| Vanessa | Direção de vídeo | Peça 1 |
| Diego | Edição de vídeo | Peça 1 |
| Rafa | Renderização de vídeo (Developer Assisted Mode) | Peça 1 |
| Lucas | Revisão de qualidade | Todas as 6 (revisão de imagem/copy nas peças 2-6; revisão de pacote de vídeo na peça 1) |
| Ana | Publicação (local_ready/dry_run) | Todas as 6 |

Nenhuma Skill foi chamada manualmente — Caio encadeou automaticamente a saída de cada etapa na entrada da próxima via `inputBindings`, exatamente como em qualquer execução real.

## 3. Tempo de cada etapa

Os tempos abaixo são de execução **local, determinística** (sem chamada de rede real — `DeterministicFakeIcaroProvider` e arquivos assistidos já pré-posicionados antes de cada `--continue`). Em um cenário real, o tempo de geração de imagem/vídeo dependeria de quem/o que estiver produzindo o arquivo assistido, e a aprovação humana depende de quando a pessoa revisar — por isso o número que importa aqui é a **ordem de grandeza da orquestração em si** (baixíssima), não uma promessa de tempo real de produção.

| Peça | Duração total | Etapa mais longa |
|---|---|---|
| 1 — Reels (site do casamento) | 357ms | Aprovação (157ms, overhead do processo da CLI) |
| 2 — Carrossel (painel dos noivos) | 472ms | Aprovação (169ms) |
| 3 — Imagem única (taxa zero) | 421ms | Aprovação (157ms) |
| 4 — Story (RSVP) | 468ms | Aprovação (169ms) |
| 5 — Story (álbum colaborativo) | 479ms | Aprovação (176ms) |
| 6 — Story (cronograma) | 464ms | Aprovação (168ms) |

Em todas as peças, "Planejamento editorial" (Eduardo) levou 5-7ms, "Geração de imagem" 15-28ms (proporcional ao número de imagens), e as demais etapas 1-6ms cada — a etapa "Aprovação" é a mais longa apenas por overhead de reinicializar o processo Node a cada chamada da CLI, não por trabalho real.

## 4. Decisões estratégicas do Eduardo (por peça)

| Peça | `contentObjective` | `recommendedFormat` | Emoção principal | Estrutura narrativa | CTA | Profundidade / Complexidade / Prioridade de conversão |
|---|---|---|---|---|---|---|
| 1 — Reels (site) | `demonstracao` | `reels`, 30s | Clareza | Hook → Demonstração → Benefícios → CTA | Conheça o Rumo ao Altar | média / alta / média |
| 2 — Carrossel (painel) | `demonstracao` | `carrossel`, 4 slides | Clareza | Contexto → Mensagem central → Benefícios → CTA | Conheça o Rumo ao Altar | alta / média / média |
| 3 — Imagem única (taxa zero) | `conversao` | `imagem_unica` | Confiança | Mensagem central → CTA | Conheça o Rumo ao Altar | baixa / baixa / **alta** |
| 4 — Story (RSVP) | `awareness` | `story`, 3 telas | Leveza | Abertura → Informação principal → CTA | Conheça o Rumo ao Altar | baixa / baixa / média |
| 5 — Story (álbum) | `awareness` | `story`, 3 telas | Leveza | Abertura → Informação principal → CTA | Conheça o Rumo ao Altar | baixa / baixa / média |
| 6 — Story (cronograma) | `awareness` | `story`, 3 telas | Leveza | Abertura → Informação principal → CTA | Conheça o Rumo ao Altar | baixa / baixa / média |

### Por que cada formato/decisão faz sentido

- **Peça 1 (Reels, "mostrando como funciona o site"):** o verbo "mostrando" ativou a keyword de demonstração, e "reels" foi pedido explicitamente — o Eduardo corretamente reconheceu que demonstrar uma funcionalidade em vídeo curto reduz fricção de entendimento, daí `primaryEmotion: Clareza` e prioridade de conversão apenas média (é uma peça de topo de funil).
- **Peça 2 (Carrossel, "explicando o painel"):** a palavra "painel" bateu na mesma lista de keywords de demonstração (o Eduardo trata "explicar uma função central" como algo que pede profundidade alta — por isso `depthLevel: alto` aqui, o maior da campanha), coerente com carrossel ser o formato que melhor comporta explicação em sequência.
- **Peça 3 (Imagem única, "taxa zero"):** "taxa zero" é a keyword de conversão mais forte do vocabulário do Eduardo — por isso é a única peça com `contentObjective: conversao` e `conversionPriority: alta`, e a narrativa mais curta e direta (Mensagem central → CTA) da campanha, coerente com ser o gancho comercial mais forte.
- **Peças 4-6 (Stories):** nenhum dos três temas (RSVP, álbum, cronograma) bateu em alguma keyword fixa de objetivo, então o Eduardo classificou como `awareness` (padrão) — mas isso não prejudica o resultado, porque a estrutura narrativa do Story (Abertura → Informação principal → CTA) é a mesma independentemente do objetivo, e é exatamente o formato certo para mensagens rápidas e diretas como essas três.

## 5. Prompts gerados (o entregável criativo real desta execução)

Prompts completos de Pedro (imagem) e Rafa (vídeo) salvos como arquivos de texto dentro de cada pasta de artefato — prontos para uso em qualquer gerador de imagem/vídeo real:

- **Peça 1 (Reels):** `artifacts/workflow-execution-mrf7zj30-yo153q/video-prompt.txt` (especificação técnica: MP4, 1080x1920, 9:16, 30s, 30fps, H.264/AAC).
- **Peça 2 (Carrossel):** `artifacts/workflow-execution-mrf80y0i-a3zxbi/image-prompt-slide-01.txt` a `-04.txt` (4 imagens, 1080x1350, 4:5).
- **Peça 3 (Imagem única):** `artifacts/workflow-execution-mrf81s9f-2b1g68/image-prompt.txt` (1 imagem, 1080x1350, 4:5).
- **Peça 4 (Story RSVP):** `artifacts/workflow-execution-mrf823ra-bo5s1h/image-prompt-slide-01.txt` a `-03.txt` (3 imagens, 1080x1920, 9:16).
- **Peça 5 (Story álbum):** `artifacts/workflow-execution-mrf82bbo-6kjvim/image-prompt-slide-01.txt` a `-03.txt` (3 imagens, 1080x1920, 9:16).
- **Peça 6 (Story cronograma):** `artifacts/workflow-execution-mrf82pc2-3x7kac/image-prompt-slide-01.txt` a `-03.txt` (3 imagens, 1080x1920, 9:16).

Todas as proporções de Story saíram em 1080x1920 (9:16), confirmando que a correção de proporção/resolução (BUG-06) continua funcionando corretamente para todos os cenários reais desta campanha.

## 6. Artefatos gerados (por peça)

| Peça | executionId | Imagens/Vídeo | HTML | ZIP | publication.txt | Tamanho total |
|---|---|---|---|---|---|---|
| 1 — Reels | `workflow-execution-mrf7zj30-yo153q` | 1 vídeo (`videos/final-video.mp4`) | ✅ | — (vídeo único, sem ZIP) | ✅ | 461 KB |
| 2 — Carrossel | `workflow-execution-mrf80y0i-a3zxbi` | 4 imagens | ✅ | ✅ `carousel.zip` | ✅ | 2,3 MB |
| 3 — Imagem única | `workflow-execution-mrf81s9f-2b1g68` | 1 imagem | ✅ | — (imagem única, sem ZIP) | ✅ | 497 KB |
| 4 — Story RSVP | `workflow-execution-mrf823ra-bo5s1h` | 3 imagens | ✅ | ✅ `carousel.zip` | ✅ | 1,7 MB |
| 5 — Story álbum | `workflow-execution-mrf82bbo-6kjvim` | 3 imagens | ✅ | ✅ `carousel.zip` | ✅ | 1,7 MB |
| 6 — Story cronograma | `workflow-execution-mrf82pc2-3x7kac` | 3 imagens | ✅ | ✅ `carousel.zip` | ✅ | 1,7 MB |

Cada pasta (`artifacts/<executionId>/`) contém: `index.html` (entrega visual), `caption.txt`, `hashtags.txt`, `metadata.json`, `execution-report.json`, `publication.txt`, os prompts (seção 5) e as imagens/vídeo. O ZIP é gerado automaticamente sempre que há mais de uma imagem (carrossel e os três Stories de 3 telas) — não apenas em carrosséis "de nome".

Todas as 6 peças terminaram em `COMPLETED`, revisão do Lucas `approved`, e Ana em `overallStatus: local_ready` / `publishMode: dry_run` — **nada foi publicado de verdade**, conforme pedido.

## 7. Próximos passos recomendados

1. Gerar as imagens/vídeo reais a partir dos prompts da seção 5 (via um gerador de imagem/vídeo real ou por um designer), substituindo os arquivos placeholder em cada pasta.
2. Se quiser copy e conceito visual realmente distintos por tema (RSVP, álbum, cronograma etc., em vez do texto genérico sobre taxa zero), será necessário configurar um provider de IA real para o Ícaro — o `DeterministicFakeIcaroProvider` usado aqui é só para demonstração/teste.
3. Revisar manualmente `caption.txt`/`hashtags.txt` de cada peça antes de qualquer publicação real, já que o texto atual não é específico do tema de cada peça (ver aviso no topo deste relatório).
