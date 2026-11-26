# Motor de vídeos da Vorix — reavaliação da arquitetura

Data: 2026-11-26. Escopo: decidir o executor de edição antes da Etapa B. Nada foi instalado ou
alterado no servidor; o levantamento lá foi somente leitura, mais um teste de codificação de 8 s
em prioridade mínima (detalhes em §4).

**Recomendação: arquitetura B (IA via API + FFmpeg), com o contrato de plano e a porta do executor
mantidos neutros para permitir o DaVinci Studio depois (C) só se um requisito concreto exigir.**
O DaVinci gratuito sai da solução de produção: ele não roda sem uma pessoa abrindo o programa.

---

## 1. O que está realmente implementado

| Componente | Onde | Estado real |
|---|---|---|
| Contrato do plano de edição + validador | `domain/video-editing/video-edit-plan.ts` | Testado (unitário). **Neutro em relação ao motor** |
| Compilador plano → operações DaVinci | `infrastructure/davinci-resolve/compile-edit-plan.ts` | Testado (unitário). Específico do DaVinci, mas a matemática é reaproveitável |
| Protocolo e ponte Lua | `bridge-protocol.ts`, `lua/VorixBridge.lua` | Testado no LuaJIT com Resolve **simulado**. **Nunca rodou no DaVinci** |
| Cliente de arquivo + executor DaVinci | `file-bridge-client.ts`, `davinci-resolve-executor.ts` | Testado contra **simulador**. FFmpeg real só no preparo de trilha e no PNG transparente |
| Análise de mídia + Quality Gate | `video-editing/ffmpeg-media-analysis.ts`, `application/video-editing/video-quality-gate.ts` | Testado com MP4 **real** gerado pelo FFmpeg |
| Porta do executor | `application/ports/video-edit-executor.port.ts` | Interface, sem dependência de motor |
| Sonda e script de prova | `lua/VorixProbe.lua`, `scripts/davinci/*` | Sonda testada no LuaJIT; prova nunca executada |

Commits: `be54ae0e` (Etapa A) e `8d22fc70` (sonda). Não existem ainda: planejador por IA, fila de
vídeo, rotas de API, interface, integração com storage/permissões, transcrição no fluxo.

**Já existia antes, e está em produção ou pronto:**
- Renderizador FFmpeg do pipeline Diego → Rafa (`infrastructure/video-rendering/`): `xfade`,
  `zoompan`, `drawtext`, `overlay`, `amix`, ducking. Usado pela CLI, não pela API.
- Provider Remotion (`infrastructure/motion-rendering/`): só CLI. O Chromium do Remotion **não está
  instalado** no container de produção.
- Worker de Meetings **em produção**: fila em Postgres (`FOR UPDATE SKIP LOCKED`, lease com
  heartbeat, retry com backoff, recuperação de worker morto), FFmpeg e **transcrição local com
  faster-whisper** (sem API paga), com papéis que podem ir para outro host.
- Gateway de IA com créditos (`ai-gateway`), Creative Engine e Quality Gate de imagem.

## 2. Responsabilidade de cada componente

| Papel | Quem faz | Observação |
|---|---|---|
| Entender o pedido e os materiais | IA via API (texto + visão) | Recebe transcrição com tempos, descrição de quadros/fotos, Perfil da Marca |
| Planejar cortes, cenas, ritmo, textos, transições, música | IA via API → **plano JSON** | A IA nunca renderiza nem gera código; o plano é validado e devolvido à IA com os erros até passar |
| Regras que não dependem de gosto | Validador + compilador (determinísticos) | Durações, áreas seguras, fidelidade de produto, quebra de texto, colisões |
| **Produzir o MP4** | **Executor**: FFmpeg (B) ou DaVinci (A) | É a única peça que muda entre as alternativas |
| Transcrever fala | faster-whisper local (já em produção) | Ligar `word_timestamps` para legenda palavra a palavra |
| Verificar | Quality Gate determinístico + IA de visão na folha de contato | Nunca aprova sozinho; revisão humana na prévia |
| Orquestrar | Fila Postgres + worker de vídeo separado da API | Mesmo padrão do Meetings |

No DaVinci, o "executor de edição" e o "renderizador" são o mesmo processo. Ele não planeja nada:
quem decide é sempre a IA + o compilador.

## 3. O que se aproveita

| Item | Destino |
|---|---|
| Contrato do plano + validador | **Mantém** como contrato único entre IA e qualquer executor |
| Quality Gate + análise FFmpeg | **Mantém** sem mudança |
| Porta `VideoEditExecutor` | **Mantém**; ganha a implementação FFmpeg |
| Matemática do compilador (enquadramento fill/fit, keyframes de movimento e transição, quebra de texto, colisão de legendas, posição do logo, janelas de ducking, preparo de trilha) | **Reaproveita** no compilador FFmpeg |
| Ponte Lua, cliente de arquivo, executor DaVinci, sonda | **Estaciona** no repositório (não apaga), fora do fluxo de produção. Volta só se a opção C for aprovada |
| Testes de cancelamento/timeout/disco/mídia ausente | Reaproveitam o mesmo roteiro para o executor FFmpeg |

## 4. Infraestrutura existente (VPS netcup 62.83.93.42)

| Recurso | Medido |
|---|---|
| Sistema | Debian 13 (trixie), kernel 6.12, Docker |
| CPU | 8 vCPUs virtuais (KVM, "QEMU Virtual CPU", AVX2), compartilhadas com outros 3 projetos |
| Carga habitual | média de 1,5–2,1 (cerca de 2 vCPUs ocupadas) |
| Memória | 15 GiB; 9,3 GiB disponíveis; **sem swap** |
| Disco | 314 GB; 96 GB livres (69% usado); `/tmp` é RAM (7,9 GB) |
| GPU | **Nenhuma** (só o adaptador VGA emulado) |
| FFmpeg no container | 7.0.2 com `drawtext`, `xfade`, `zoompan`, `subtitles`/`ass` (legenda estilizada), `loudnorm`, `sidechaincompress`, `blackdetect`, `libx264`, `libx265`, `aac`, `libfdk_aac` |
| Containers Vorix | API limitada a 1 GiB; worker de inbox 256 MiB; Meetings worker 2,4 GiB |

**Teste de capacidade (somente leitura, `nice 19`, saída descartada):** 10 s de vídeo 1080×1920 a
30 fps com movimento de câmera por recorte, faixa de texto e H.264 `veryfast` → **7,9 s usando
2 threads**, com o servidor sob carga de cerca de 5 no momento. Isso é um piso: uma edição real
(vários inputs, textos, transições, áudio) custa mais e precisa ser medida na prova B0.

Incidente do levantamento: o primeiro teste foi montado errado (`zoompan` com `d=300` gerou
90 mil quadros em vez de 300) e ocupou 2–4 vCPUs por cerca de 6 minutos em prioridade mínima. Foi
encerrado (processos, laço e `docker exec`). A carga voltou de 5,8 para 2,9 e nada ficou no disco
ou em `/tmp`. Lição registrada: todo teste em produção leva `timeout`.

**Leitura dos números:**
- Espaço em disco não é o limite. O limite é CPU compartilhada e memória sem swap.
- Um worker de vídeo com 2 vCPUs e 1 render por vez cabe hoje, desde que limitado no Docker
  (`cpus=2`, `memory≈2 GiB`). Estimativa a confirmar na B0: um Reels de 30 s em 1–3 minutos.
  Isso dá dezenas de vídeos por hora, o bastante para os primeiros clientes.
- Transcrição (faster-whisper `small`, CPU) disputa os mesmos núcleos: deve entrar na mesma fila.
- Remotion (Chromium) consome de 1 a 2 GB por render. Com o servidor sem swap, não deve rodar lá
  sem limite rígido.
- Separar sem contratar: container `video-worker` próprio, com limites, lendo a fila do Postgres.
  Quando a fila esperar demais, o **mesmo container** vai para uma VPS só de CPU, sem mudança de
  código (como o papel `transcribe` do Meetings).
- Vários clientes ao mesmo tempo: a latência cresce linearmente com a fila. A escala horizontal
  é mais workers CPU, sem GPU.

## 5. Comparação

| Critério | A — IA + DaVinci | B — IA + FFmpeg (+ Remotion opcional) | C — Híbrida |
|---|---|---|---|
| Automação sem humano | **Gratuito: não.** Sem scripting externo, sem `-nogui`, ponte iniciada à mão a cada abertura, recuperação manual. **Studio: sim**, via scripting externo e `-nogui` (documentado em espelhos do README; não confirmado por nós) | Sim, já roda assim no Meetings | B para tudo; Studio só em jobs marcados |
| Infra | Máquina **com GPU** (Windows, ou Linux só com Studio, que codifica H.264 no Linux) | VPS atual; depois VPS só de CPU | Os dois |
| Licença | Gratuito: EULA a revisar para uso como serviço. Studio: licença por máquina (cerca de US$ 295, preço de vitrine) e limite de ativações, o que atrapalha escalar workers | FFmpeg: sem custo (a build atual inclui `libfdk_aac`, que tem restrição de redistribuição; uso em servidor é ok, mas não distribuir a imagem). Remotion: grátis até 3 funcionários; acima disso, licença Company com cobrança por render automatizado | Soma das duas |
| O que a API de script expõe | Timeline, cortes, Fusion (keyframes), títulos, render. **Não expõe**: inserir transições, volume/automação de áudio (Fairlight), boa parte da correção de cor fina; muitos recursos de IA do DaVinci são só Studio e nem todos são acessíveis por script | Tudo que existe no FFmpeg: dezenas de transições `xfade`, LUT 3D para cor, `loudnorm` (padrão −14 LUFS das redes), ducking por `sidechaincompress`, legendas animadas com libass | — |
| Qualidade visual | O teto do programa é alto, mas o que vale é o que o plano consegue pedir pela API, e a API cobre pouco além do que o FFmpeg faz | Depende dos nossos modelos de composição. Movimento, tipografia e transições de nível de anúncio são viáveis; motion graphics complexos ficam melhores no Remotion | Igual a B no comum |
| Estabilidade | App gráfico com GPU dirigido por ponte de arquivos dentro de um app fechado; muda a cada versão (o 21.1 removeu Python do gratuito) | Processo CLI por job, determinístico, fácil de matar e repetir | Duas superfícies de falha |
| Escalabilidade | Uma instância DaVinci = 1 render; escala com máquinas GPU + licenças | Escala com vCPU barata | — |
| Complexidade/manutenção | Alta (ponte, versão do app, drivers, sessão gráfica) | Média (grafo de filtros), contida pelo compilador com testes | Mais alta das três |
| Prova feita | Nenhuma real (DaVinci não instalado) | Renderizador FFmpeg já gerou MP4 real 1080×1920 de 30 s em 22,6 s (relatório do pipeline Rafa) | — |

O DaVinci não produz vídeo melhor só por ser um editor profissional. A diferença dele está em
ferramentas manuais (cor, Fusion interativo, Fairlight, IA de máscara/voz) que, numa operação
automática, só ajudam se a API as expuser e se o plano souber pedi-las. Hoje não é o caso.

## 6. Custos adicionais estimados

| Item | B recomendado (agora) | A (Studio) |
|---|---|---|
| Servidor de render | R$ 0: container na VPS atual | Máquina com GPU dedicada: na faixa de algumas centenas de US$/mês (nuvem Windows com GPU ligada 24 h) ou servidor GPU dedicado Linux; cotar |
| Licença do motor | R$ 0 (FFmpeg); Remotion conforme o porte da empresa | Studio por máquina (cerca de US$ 295 cada) |
| Processamento de mídia | CPU já paga; quando escalar, VPS só de CPU (dezenas de €/mês) | Incluído na máquina GPU |
| Transcrição | R$ 0 de API (faster-whisper local) | Igual |
| IA de planejamento | Por vídeo, pelo gateway com créditos. Ordem de centavos de dólar (texto + algumas imagens); medir na B0 | Igual |
| Narração (TTS) | Não habilitada. API paga por caractere ou voz local gratuita de qualidade menor; decidir depois | Igual |
| Trilha sonora | **Lacuna**: o projeto só tem uma faixa de validação. Precisa de biblioteca licenciada para uso comercial | Igual |
| Vídeo generativo | Futuro, cobrado por segundo; não habilitado | Igual |

Valores de nuvem e licença são de referência e precisam de cotação antes de qualquer contratação.

## 7. Limitações e riscos (da recomendação B)

- **Disputa de CPU** com os outros projetos na VPS, que não tem swap. Mitigação: limites no Docker,
  concorrência 1, `nice`, `timeout` em todo processo, fila com prioridade.
- **Movimento de câmera com `zoompan`** é lento e pode tremer. Usar escala + recorte com expressão
  (o método do teste) ou pré-escala.
- **Grafos de filtro grandes** são difíceis de depurar. Mitigação: compilador com testes e
  renderização por clipe com cache (reedição sem refazer tudo).
- **Vídeos enviados pelos clientes**: tamanho, formatos variados e retenção. Normalizar na entrada,
  limitar duração e tamanho, purgar intermediários.
- **Planejador inventando trechos**: a IA só escolhe intervalos que existem na transcrição; o
  validador recusa trecho fora da mídia e fala que não existe.
- **Fidelidade de produto**: o executor só move, escala e recorta; nunca altera cor nem estampa.
  O Quality Gate de visão confere.
- **Música e narração** dependem de decisão de licença e custo.
- **Qualidade final** é responsabilidade nossa (modelos de composição), não do motor. Precisa de
  revisão visual nas provas, não só de testes.

## 8. Arquitetura recomendada

```
Marketing › Criar conteúdo › Criar vídeo com IA (web)
  └─ API: upload para o storage do workspace, cria video_job (feature flag por workspace)
       └─ Postgres: video_jobs (lease, heartbeat, retry, cancelamento, progresso por etapa)
            └─ video-worker (container próprio, cpus/mem limitados, 1 render por vez)
                 1. normalizar e medir mídia (FFmpeg)
                 2. transcrever fala (faster-whisper, tempos por palavra)
                 3. detectar cenas e amostrar quadros (scene-detection existente)
                 4. planejar: IA via gateway com créditos → VideoEditPlan → validar → corrigir
                 5. executar: FfmpegEditExecutor (mesmo plano, mesma porta)
                 6. Quality Gate determinístico + IA de visão na folha de contato
                 7. salvar versão (plano + MP4 + relatório) → Revisão/aprovação
  Edição por conversa: IA altera o plano (diff) → re-render só dos clipes afetados
```

Nada roda no computador pessoal: o worker vive no servidor, e o único requisito é CPU.

## 9. Plano de implementação

1. **Prova B0** (abaixo). Sem ela, nada de Etapa B.
2. **B1, fila e worker:** tabela `video_jobs` (padrão `meeting_jobs`), container `video-worker` com
   limites, feature flag só no seu workspace, rollback desligando a flag.
3. **B2, planejamento e interface:** planejador via gateway, integração com Perfil da Marca,
   biblioteca e Creative Engine; tela "Criar vídeo com IA" (editar vídeo / criar com imagens);
   prévia e aprovação na Revisão.
4. **B3, edição por conversa e versões:** diff do plano, cache por clipe, histórico e comparação.
5. **C, opcional:** worker DaVinci Studio com GPU **só** se uma comparação lado a lado mostrar um
   requisito que o FFmpeg não atende (exemplo: correção de cor avançada em vídeo de cliente).

## 10. Próxima prova técnica: B0

Objetivo: provar que o **mesmo** `VideoEditPlan` vira MP4 profissional pelo FFmpeg, sem humano, nos
três formatos, com custo medido.

- Implementar `FfmpegEditExecutor` (porta existente), reaproveitando a matemática do compilador.
- Renderizar o plano de prova (gravação + fotos, dissolve, push, zoom, dip, Ken Burns, títulos,
  legendas, logo, trilha com ducking) em 9:16, 1:1 e 16:9.
- Um teste com fala real em português: faster-whisper → legendas sincronizadas.
- Medir tempo, pico de memória e CPU com 2 threads.
- Critérios de aceite: Quality Gate `ready_for_review` nos três formatos; revisão visual da folha
  de contato sem defeito (texto cortado, preto, tremor, sobreposição); tempo de render de um vídeo
  de 15 s com 2 threads dentro do que a fila suporta; pico de memória abaixo de 2 GiB.
- Local nesta máquina (FFmpeg empacotado). Depois, **com sua autorização**, uma rodada no
  servidor num container temporário com `cpus=2` e `memory=2g`, sem dados de clientes, para medir a
  capacidade real.
