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

Os números finais após publicação serão registrados junto do resultado de deploy e das novas
amostras. O diagnóstico de transporte não comprova login completo/MFA nas contas das redes.
