# Recursos do servidor e login social remoto — 02/11/2026

Diagnóstico na produção `143.198.47.74`, com amostras de cgroup por segundo durante 30 segundos,
healthchecks, memória disponível/swap e processos por serviço. O host tem aproximadamente 2 GiB
de RAM e compartilha recursos com outra aplicação; os resultados abaixo não atribuem o consumo
dessa aplicação ao Vorix.

## Causas medidas

- RabbitMQ: média de 9,42% de um núcleo e pico de 114,79% na janela, com `rabbitmq-diagnostics ping`
  a cada 15 segundos. Cada verificação observada demorava entre 1,2 e 1,8 segundo, iniciando uma
  VM Erlang adicional. Os percentuais são de um núcleo; não significam 115% de toda a máquina.
- Gateway social: aproximadamente 165,5 MiB mesmo ocioso, mantendo o Chromium aberto após a
  verificação de inicialização e após fechar os contextos.
- API: aproximadamente 116 MiB; interface: aproximadamente 93 MiB; workers: aproximadamente
  39 e 20 MiB. Havia cerca de 612 MiB disponíveis no host na primeira coleta e 810 MiB em swap.
- No login remoto, cada caractere gerava um POST e aguardava a mesma fila usada pela captura da
  tela. A imagem era atualizada a cada 1,5 segundo, inclusive com a aba escondida.

Abrimos somente páginas públicas de login em contextos temporários, sem credenciais e sem concluir
qualquer conexão. Foram enviados apenas eventos Tab, todos os contextos de diagnóstico foram
fechados e nenhuma publicação foi feita. Maior latência de entrada observada antes da correção:
Facebook 1.957 ms, Instagram 1.560 ms e TikTok 4.172 ms.

## Correções

- Chromium fecha após 30 segundos sem contextos ativos, respeitando a fila e os logins em andamento.
  As conexões salvas continuam no armazenamento cifrado e não dependem de manter o processo aberto.
- Capturas concorrentes compartilham uma operação por fluxo, depois de validar seu escopo. Não
  bloqueiam cliques ou teclado. Não há cache persistente de capturas, senhas ou códigos.
- Texto é agrupado em janelas de 60 ms, limitado a 2.000 caracteres por envio, preservando ordem
  em relação a Tab, Enter, Backspace e cliques. Finalizar aguarda o texto pendente; cancelar/sair
  descarta entradas ainda não entregues. Colagem e composição de texto continuam disponíveis.
- A interface atualiza mais rapidamente após uma entrada e reduz a frequência quando ociosa;
  abas escondidas não pedem capturas.
- API/gateway verificam HTTP com curl, evitando iniciar um Node só para o healthcheck. A interface
  conserva a verificação HTTP da página de login, usando o cliente HTTP nativo mais leve.
- RabbitMQ passa a verificar, por HTTP local autenticado, os vhosts e o listener AMQP. Os endpoints
  foram testados na versão instalada, sem executar comandos que iniciam outra VM Erlang.

Não foram reduzidos limites de memória arbitrariamente nem desligados serviços de outras aplicações.
O listener AMQP, a rede privada, as credenciais e os volumes persistentes do broker são mantidos.

## Validação local

- Build da API e build de produção da interface aprovados, incluindo TypeScript.
- 63 testes de API, browser pool, isolamento, publicação, reautenticação e operação aprovados.
- 234 testes unitários web aprovados.
- 12 cenários Chromium em desktop e celular aprovados: digitação agrupada, ordem, última letra,
  pausa em aba escondida, checkpoint, conexão, composer, calendário e retry.
- Configurações Compose validadas com os arquivos de ambiente reais, sem imprimir segredos.

Uma fixture de agendamento foi corrigida para fornecer o mesmo relógio simulado ao orquestrador e
ao dispatcher. Não houve alteração do agendador de produção para fazer os testes passarem.

## Fontes técnicas

A documentação do RabbitMQ explica o custo de executar ferramentas CLI repetidamente e descreve
os checks HTTP de [monitoramento](https://www.rabbitmq.com/docs/4.1/monitoring) e os
[endpoints de saúde](https://www.rabbitmq.com/docs/http-api-reference). A captura mantém as opções
de máscara do [Playwright](https://playwright.dev/docs/api/class-page#page-screenshot).

## Resultado publicado

Release `f7ebda948a0b94ef852d52ec062d0f6a499bc18b`, enviada à branch `main` e publicada em
produção. O deploy finalizou com `DEPLOY_DONE`, API pronta, interface HTTP 200, imagens atuais
saudáveis e zero erros fatais no recorte de logs do deploy. Não há migration nova nesta correção.

A troca do healthcheck do RabbitMQ foi aplicada separadamente, sem trocar sua imagem, remover
volumes ou reiniciar o WuzAPI. Foram preservadas as 37 filas duráveis; os sete consumidores
reconectaram e a conferência final encontrou zero mensagens pendentes/em processamento. O arquivo
de ambiente do broker manteve o mesmo hash. A operação só iniciou após confirmar filas vazias.

O worker de atendimento registra sete reinícios durante essa manutenção do broker. Seu último
início foi às 18:45:37 (America/Sao_Paulo); a conferência às 18:56 continuava com o mesmo contador,
saudável, sem OOM e sem erros fatais nos três minutos anteriores. Os demais serviços conferidos
estavam com contador zero. Esse evento de manutenção é separado da medição de consumo em repouso.

| Serviço | CPU média antes | CPU média depois | Pico antes | Pico depois |
| --- | ---: | ---: | ---: | ---: |
| RabbitMQ | 9,42% | 0,71% | 114,79% | 4,91% |
| API | 3,81% | 1,18% | 58,95% | 6,11% |
| Interface | 1,27% | 0,46% | 37,88% | 13,65% |
| Gateway social | 1,23% | 0,21% | 34,71% | 6,23% |

Percentuais de um núcleo; cada janela teve 30 segundos, sem build ou diagnóstico de login em
execução. São amostras operacionais, não um teste de carga nem garantia de consumo constante.
Outros serviços do host continuaram ativos e não foram alterados.

| Rede | Mediana da entrada antes | Depois | Maior latência antes | Depois |
| --- | ---: | ---: | ---: | ---: |
| Facebook | 807 ms | 464 ms | 1.957 ms | 727 ms |
| Instagram | 516 ms | 134 ms | 1.560 ms | 238 ms |
| TikTok | 1.353 ms | 373 ms | 4.172 ms | 1.268 ms |

Foram três eventos Tab por rede em páginas públicas, sem credenciais. A duração de carregar a
página, de produzir a imagem, da rede do cliente e de concluir login/MFA é distinta dessa latência.
As capturas ainda podem demorar mais, especialmente durante o carregamento inicial do TikTok;
elas passaram a ocorrer independentemente da fila de entrada. Não foi comprovado login completo
nas contas dos clientes nem publicação nas redes.

### Memória de processos e cache

Foi confirmado em produção `activeContexts=0`, `interactiveFlows=0` e `browserRunning=false`
depois do período ocioso. Em uma verificação pareada no mesmo container, após encerrar um contexto
de diagnóstico mas ainda com o Chromium aberto, a memória anônima era 179,7 MiB. Depois do timer
de ociosidade ela caiu para 72,6 MiB: **107,1 MiB liberados**, sem forçar coleta, descarte de cache
ou encerramento de sessões alheias. O pequeno processo de diagnóstico estava presente nas duas
leituras; não se deve interpretar 72,6 MiB como o custo exclusivo do gateway.

O indicador de working set do Docker variou de 165,5 para 214,8 MiB na coleta geral, que ocorreu
após carregar as três redes para diagnóstico. Isso inclui páginas de arquivos ainda consideradas
ativas pelo kernel. A inspeção confirmou somente o Node no gateway, com cerca de 62 MiB de
memória anônima naquele instante e aproximadamente 145 MiB de cache ativo de arquivos. Portanto,
essa variação não comprova aumento do heap ou permanência do Chromium: não foi escondida nem
comparada como se todas as páginas de cache fossem memória privada de processos.

O host apresentou 716 MiB disponíveis na conferência posterior, contra 612 MiB na primeira leitura;
o valor depende também dos outros serviços e do cache. Não foi realizado `drop_caches` nem alteração
de limites para produzir uma redução artificial no painel.

### Backups e evidências

- Código: `/opt/zuno/deploy_backups/pre-f7ebda9-20261102213526.tgz`.
- Banco: `/opt/zuno/deploy_backups/db-pre-f7ebda9-20261102213526.sql.gz`.
- Configuração principal: `/root/.env.zuno.pre-f7ebda9-20261102213526`.
- Broker: Compose anterior em `/root/vorix-rabbit-compose-pre-f7ebda9.yml` e ambiente preservado
  em `/root/.env.conversas.pre-f7ebda9`.
- Logs: `/var/log/vorix-deploy-f7ebda9-20261102213526.log` e
  `/var/log/vorix-rabbit-performance-f7ebda9.log`.
- [Medições e validação estruturadas](social-login-performance-validation-20261102.json).

Os sete arquivos principais também tiveram SHA-256 conferido contra o commit publicado.
Conexões salvas permanecem no volume cifrado. Janelas de autenticação abertas antes da troca do
gateway precisam ser reabertas para carregar o fluxo atualizado.
