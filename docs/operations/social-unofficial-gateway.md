# Publicação orgânica: gateway de sessões

Instagram, Facebook e TikTok entram como adapters do contrato `SocialPublishingProvider`, usando o
mesmo `SocialAccount`, composer, calendário, scheduler, outbox, retry, reconciliação, auditoria e
notificações. Meta/TikTok oficiais permanecem registrados e desligados por padrão.

## Conectar uma conta

Marketing → Integrações → rede → Conectar abre uma tela autenticada do Vorix com o navegador remoto.
O próprio cliente realiza login, MFA e confirmações. Clique no campo da rede e digite; no celular,
use o campo de entrada e “Enviar ao campo selecionado”. Cliques e arrastos reproduzem exclusivamente
o gesto do usuário, inclusive para verificações manuais. “Continuar” consulta a identidade
autenticada antes de criar/atualizar a conexão. Expiração: dez minutos; cancelamento encerra o contexto.
Não existe importação de cookies/JSON, senha armazenada ou mecanismo de solução automática de CAPTCHA.

## Isolamento e persistência

O serviço `social-provider-gateway` não tem porta pública, router Traefik, banco ou credenciais da
API. A API autentica e verifica RBAC, tenant e workspace em toda operação; o gateway verifica também
o usuário iniciador de cada fluxo. O token entre serviços permanece exclusivamente no servidor.

Somente cookies autenticados são persistidos, com AES-256-GCM, IV aleatório e AAD que inclui tenant,
workspace, rede e identificador. Catálogos e recibos também são cifrados. O Core persiste apenas a
referência opaca `socgw-*`. Desconexão remove a sessão, preservando os agendamentos e o histórico.
Não são persistidos valores de formulários, senhas, códigos MFA/recovery, localStorage, screenshots,
traces, vídeos ou perfis de navegador. Logs do gateway não contêm requisições nem exceções brutas;
o cliente RPC transforma falhas em códigos permitidos. O serializer HTTP da API não registra body
ou headers privados. Imagens de autenticação têm campos sensíveis mascarados e resposta `no-store`.

Um Chromium compartilhado recebe contextos separados, no máximo dois simultâneos por padrão.
Há fila FIFO limitada, timeout, fechamento no shutdown e relançamento após queda do browser.
Há uma única réplica do gateway, proprietária de seu volume e dos locks. Não escalar réplicas
compartilhando o volume sem substituir os locks por uma coordenação distribuída.

Navegação do browser fica restrita às redes e recursos de verificação; URLs arbitrárias, scripts,
seletores e uploads não são aceitos no canal interativo. Downloads de mídia usam a lista explícita
`SOCIAL_GATEWAY_MEDIA_ORIGINS`, HTTPS, sem redirects, rejeição de destinos privados e limites de
tamanho. O sandbox do Chromium fica desabilitado somente dentro do container isolado, executado
como `node`, com filesystem somente leitura, tmpfs, sem capabilities e com limites de processos/memória.

## Publicação e incerteza

O core mantém seus locks, limites e política de atraso. O gateway também serializa a execução por
conta. Um recibo cifrado de resultado desconhecido é gravado com fsync **antes** da ação final de
publicação. A mesma chave nunca envia novamente enquanto houver esse recibo. Apenas uma prova
positiva de criação ou confirmação da rede acompanhada do permalink estabelece publicação.
IDs de upload, containers ou tarefas não são tratados como posts publicados.

Se a resposta da API se perder mas o gateway obtiver a prova, a reconciliação encontra o recibo pelo
mesmo provider/chave. Sem prova, continua `RECONCILIATION_REQUIRED`. A decisão manual já existente do
cliente é encaminhada ao provider da tentativa; “não publicado” libera explicitamente o recibo
para retry, sem republicação automática. Uma prova positiva já registrada não pode ser sobrescrita
por uma confirmação negativa.

## Capabilities e limites de validação

Os adapters oferecem caminhos de execução para os formatos de cada rede; o health check restringe
as capabilities pelos controles disponíveis na sessão. Não são anunciados formatos ausentes.
Em particular, Instagram web costuma converter vídeos em Reels: `feed_video` só aparece com um
controle específico. Stories e posts de fotos dependem da interface oferecida à conta. Facebook
aceita `feed_text`, sem mídia. Texto de Story não é anunciado como legenda.

A música usa exclusivamente o seletor nativo acessível ao browser. Sem esse controle, busca e
seleção ficam ocultas. O catálogo, capas e previews são os que a sessão permite consultar; nenhum
catálogo completo é prometido. Seleção e trecho seguem o destino do post; áudio incorporado ao vídeo
continua separado como `EMBEDDED_AUDIO`.

Os testes com Chromium usam páginas locais controladas. Eles validam a implementação de interação,
upload/preparação, confirmação, busca/seleção e controles de trecho; **não** comprovam que as três
interfaces atuais das redes expõem esses mesmos controles. Mudanças de DOM exigem ajustar os drivers.
Não há validação real de login/publicação/música nesta rodada sem contas disponibilizadas pelo
proprietário. Mantenha `realPublishingValidated=false` até registrar evidência por rede/formato.

## Operação

`SOCIAL_GATEWAY_TOKEN` e `SOCIAL_GATEWAY_ENCRYPTION_KEY` são independentes e gerados no host por
`scripts/deploy/prepare-social-gateway.sh` (backup prévio do `.env.zuno`, sem imprimir valores).
Não substituir a chave de criptografia enquanto houver sessões que precisem continuar válidas.

A migration `0178` registra os switches dos três providers e amplia o constraint de formato.
Somente policies sem configuração explícita da versão anterior recebem o novo padrão. Policies
explicitamente alteradas por um administrador são preservadas. Tenants sem policy usam os três
providers não oficiais, sem criar contas fictícias. Somente uma conta autenticada pode publicar.

O deploy `all` inclui API, worker, gateway e web, com builds sequenciais, backup de código, banco,
ambiente e volume cifrado (quando já existir). Rollback da primeira instalação encerra o gateway
novo e preserva seu volume. Não reverte migrations nem apaga sessões. O health check de inicialização
do gateway abre um contexto Chromium antes de disponibilizar a porta interna.

O admin mantém os switches e a policy por tenant, com modos UNOFFICIAL, OFFICIAL ou AUTO. Os modos
que incluem o oficial exigem sua autorização prévia e conexão. Falhas de autenticação nunca disparam
fallback. As métricas administrativas incluem contas conectadas/saudáveis, reconexão e contagens de
sucesso, falha e resultado desconhecido por provider/rede no período consultado.
