# Integração DaVinci Resolve — Etapa A (motor de execução)

Status: **ponte, adaptador, compilador e Quality Gate implementados e testados contra simulação.
A prova ao vivo (MP4 exportado pelo DaVinci) ainda NÃO foi executada: o DaVinci Resolve não está
instalado na máquina de desenvolvimento.** Este documento separa o que foi verificado do que ainda
depende da prova.

## 1. Por que uma ponte própria (e não as três de referência)

| Repositório | Licença | Transporte | Problema que impede uso direto |
|---|---|---|---|
| flamexnreal/davinci-resolve-ai-bridge-mcp | MIT | Arquivos assinados (HMAC) + worker Lua | Conector Lua não localizado no repositório para revisão; Windows declarado "sem verificação ao vivo"; servidor MCP Python inteiro como dependência |
| kingjamesch/davinci-resolve-mcp | MIT | Pastas com nome hex + `fusion:SetData` | **Executa Lua arbitrário** (`run` → `loadstring` + `_G` como fallback). Somente macOS |
| KirolosYassa/Davinci_Resolve_Free_Edition_MCP | MIT | `command.json` disparado manualmente a cada comando | Não fica escutando (cada comando exige clique no menu); sem render no caminho gratuito; caminho fixo `C:\Tools\...` |

Regra do projeto: nenhum código Lua/Python, comando ou caminho vindo do pedido do usuário. Duas das
três pontes violam isso por desenho, e a terceira não automatiza. Por isso `VorixBridge.lua` foi
escrita do zero, reaproveitando só as ideias:

- **Lista fechada de 16 operações** (`bridge-protocol.ts` ↔ tabela `OPS` em Lua), com argumentos
  validados dos dois lados. Não existe operação de executar código.
- **Sem `loadstring`, `dofile`, `require`, `os.execute`, `io.popen`.** JSON lido por parser próprio
  que só produz dados (limite de aninhamento e de tamanho). Há teste que falha se alguma dessas
  primitivas aparecer no arquivo.
- **Caminhos montados pela ponte**: `BRIDGE_ROOT` (gravado na instalação) + `jobs/<jobId>/<arquivo>`,
  com `jobId` e nome de arquivo por padrão estrito (sem pasta, sem `..`, extensões de mídia).
- **Sem rede.** Um pedido por vez via `inbox/request.json` → `outbox/response.json`; batimento em
  `status.json`. Nada escuta porta; nada a expor à internet.

## 2. O que a edição gratuita permite (estado da pesquisa)

Fontes: documentação de compatibilidade da flamexnreal (testes em macOS Free 21.1.2.10, out/2026),
README da kingjamesch (Free 21.1.2) e espelhos não oficiais da API (extremraym v21.0.4, deric). A
documentação oficial da Blackmagic (`Developer/Scripting/README.txt`) vem com a instalação e será
conferida na prova.

| Capacidade | Gratuito 21.1+ | Studio | Observação |
|---|---|---|---|
| Scripting externo (Python/`fusionscript` de fora do app) | **Bloqueado** | Sim | Relatado por duas pontes independentes |
| Scripts Python no menu Workspace > Scripts | **Removido no 21.1** | Sim | |
| Scripts Lua no menu Workspace > Scripts | Sim | Sim | Único caminho no gratuito — exige o app aberto e um clique para iniciar a ponte |
| `io` no Lua | **Ausente no build macOS testado** | ? | Risco nº 1 da prova. Se faltar também no Windows, o transporte precisa mudar (ver §6) |
| Projeto, mídia, timeline, AppendToTimeline com in/out e `recordFrame` | Sim | Sim | |
| Transformações do clipe (`ZoomX/Y`, `Pan`, `Tilt`, `Opacity`) | Sim | Sim | Valores estáticos |
| Fusion (keyframes, Text+, Transform, Merge) | Sim | Sim | Página Fusion faz parte do gratuito |
| Inserir transição pela API | **Não existe** em nenhuma versão | — | Resolvido com sobreposição V1/V2 + animação Fusion |
| Volume/automação de áudio (Fairlight) | Não exposto | Não exposto | Trilha preparada no FFmpeg (ganho, fades, ducking) |
| Render H.264 MP4 | Windows/macOS sim; **Linux gratuito não codifica H.264/AAC** | Sim | Limita o worker Linux gratuito (ver §5) |
| Resolução/fps de entrega | até UHD 3840×2160, 60 fps | maior | Os formatos da Vorix (1080×1920, 1080×1080, 1920×1080, 30 fps) cabem |
| `-nogui` (sem interface) | Documentado só para Studio | Sim | Gratuito precisa de sessão gráfica |

## 3. Arquitetura implementada

```
Plano de edição (domain/video-editing/video-edit-plan.ts)       ← IA planejadora (Etapa B/C)
  └─ validateVideoEditPlan  (puro: formatos, continuidade, limites do gratuito, fidelidade)
compileEditPlan (infrastructure/davinci-resolve/compile-edit-plan.ts)
  └─ quadros, enquadramento, keyframes, quebra de texto, colisões, logo → operações da ponte
DavinciResolveExecutor (…/davinci-resolve-executor.ts)          ← implementa VideoEditExecutor
  ├─ pasta isolada do job (cópia da mídia autorizada), checagem de disco
  ├─ FFmpeg auxiliar: portador de texto transparente, trilha preparada
  ├─ FileBridgeClient → VorixBridge.lua (dentro do DaVinci)
  ├─ progresso real por etapa; render acompanhado por GetRenderJobStatus
  ├─ cancelamento (StopRendering), timeout, fecha o projeto em falha
  └─ MP4 copiado para o destino
Quality Gate (application/video-editing/video-quality-gate.ts) + ffmpeg-media-analysis.ts
  └─ arquivo, codec, resolução, fps, duração, decodificação completa, pretos inesperados,
     áudio (presença, volume, saturação, silêncio), texto, legendas, fidelidade, logo
```

Layout de trilhas: V1/V2 conteúdo alternado (transições na sobreposição), V3 logo, V4 portador de
textos (títulos e legendas numa composição Fusion, fora do zoom dos clipes), A1/A2 fala, A3 trilha.

O pipeline antigo de motion graphics (Diego → Rafa → FFmpeg, `video-rendering.port.ts`) **não foi
alterado**. A porta dele não tem corte por trecho da mídia de origem, necessário para editar
gravações; por isso o plano novo é um contrato próprio. O binário FFmpeg e o padrão seguro de
`spawn` são os mesmos.

## 4. Convenções a calibrar na prova ao vivo

Estão isoladas em `ResolveConventions` (TS) e no topo da ponte (Lua) para correção em um ponto:

- `endFrameInclusive` do `AppendToTimeline` (assumido inclusivo).
- Sinais de `Pan`/`Tilt` (assumido +x direita, +y cima) e unidade (pixels).
- `TEXT_SIZE_FACTOR` do Text+ (tamanho relativo à largura ou à altura).
- `COMPN_GlobalStart` como deslocamento dos keyframes do Fusion no clipe.
- Animação de `Center` via `XYPath` e `ProcessAlpha` no BrightnessContrast.
- Se imagens estáticas respeitam `endFrame` (houve relato de 120 quadros fixos).
- Diálogo de "ajustar fps/resolução ao clipe" na primeira importação.

## 5. Infraestrutura

- **Protótipo (agora):** DaVinci aberto numa máquina Windows com GPU, ponte iniciada por um clique,
  worker Node na mesma máquina. Serve para demonstração e para o seu workspace; **não é
  processamento automático em nuvem**: depende de sessão gráfica, do app aberto e de reinício
  manual se o DaVinci travar.
- **Servidor atual de produção:** não comporta (sem GPU, sem sessão gráfica, Linux sem H.264 no
  gratuito). Nada foi instalado lá.
- **Worker dedicado para clientes:** VM Windows com GPU (sessão gráfica permanente, autologon do
  usuário de serviço, DaVinci iniciado com a ponte), fila com um render por instância, disco local
  para jobs com limpeza por retenção, sem porta de entrada (o worker busca jobs da API). Alternativa
  Linux exige Studio (H.264) ou exportar intermediário (DNxHR) + transcodificar no FFmpeg.
- **Licença:** a EULA do gratuito permite uso comercial dos vídeos; o uso como serviço automatizado
  para terceiros precisa de leitura jurídica da EULA antes de abrir para clientes.

## 6. Plano B se o `io` do Lua faltar no Windows

A ponte detecta e avisa no console. O transporte alternativo já usado pela comunidade é ler pedidos
por `MediaStorage:GetSubFolderList` (dados em nomes de pastas) e responder por `fusion:SetData`
(gravado em `Fusion.prefs`). Só será implementado se a prova mostrar que é necessário.

## 7. Como rodar a prova

1. Instalar o DaVinci Resolve gratuito (registro e licença feitos pelo responsável da conta).
2. `npm run build && node scripts/davinci/install-bridge.mjs`
3. Abrir o DaVinci (qualquer projeto) → Workspace > Scripts > VorixBridge.
4. `node scripts/davinci/proof-render.mjs --ping` (confirma versão e produto)
5. `node scripts/davinci/proof-render.mjs --aspect 9:16` (repetir com `1:1` e `16:9`)

Saída em `artifacts/davinci-proof/<data>/`: `proof.mp4`, `plan.json`, `report.json` (tempos,
recursos, Quality Gate) e `contact-sheet.png` para revisão visual.

## 8. Testes

- `tests/video-edit-plan.test.mjs`: validação, compilação, transições, enquadramento, legendas, protocolo.
- `tests/davinci-bridge-lua.test.mjs`: a ponte Lua real no LuaJIT com Resolve simulado; operações compiladas passam; pedidos maliciosos recusados; ausência de primitivas de execução.
- `tests/davinci-executor.test.mjs`: cliente e executor contra simulador de ponte (indisponível, protocolo, timeout, fila, falha, mídia ausente, disco, render falho, cancelamento, timeout de render) e Quality Gate com MP4 real do FFmpeg.

Os testes com simulador comprovam a lógica da Vorix, **não** a integração com o DaVinci.
