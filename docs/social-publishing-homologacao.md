# Social Publishing: checklist de homologação real

Este roteiro é para executar quando existirem os apps aprovados e as credenciais de produção.

Enquanto ele não for cumprido com evidência, o estado oficial continua assim:

| Provider | Publicação real |
|---|---|
| `META_REAL_PUBLISHING` | NOT_TESTED |
| `TIKTOK_REAL_PUBLISHING` | NOT_TESTED |

O provider só vira `realPublishingValidated = true` (no código) e homologado (no admin) depois de **todos** os itens obrigatórios marcados.

## Pré-requisitos (ambos)

- [ ] Migrations `0176_social_publishing_multiprovider` e `0177_oauth_states` aplicadas no ambiente.
- [ ] Uma empresa de teste, um workspace e uma conta de rede de teste exclusivos da homologação. Nunca usar conta de cliente.
- [ ] Kill switch do provider ligado só no ambiente de homologação: `META_OFFICIAL_GLOBAL_ENABLED=true` e/ou `TIKTOK_OFFICIAL_GLOBAL_ENABLED=true`, ou pelo Admin → Social Providers.
- [ ] Provider marcado como **homologado** no admin apenas para a sessão de teste.
- [ ] Política liberada **só** para a empresa de teste: Admin → Social Providers → Política por empresa.
- [ ] Registrar para cada item: data e hora, rede, formato, id/URL do post e captura da tela do Vorix.

## Meta (Instagram e Facebook)

**Configuração**

- [ ] App Meta em modo Live, com aprovação das permissões de publicação:
  - Instagram: `instagram_basic`, `instagram_content_publish`;
  - Facebook: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`;
  - outras que a Business Login exigir.
- [ ] `META_APP_ID`, `META_APP_SECRET`, `META_INSTAGRAM_OAUTH_REDIRECT_URI` (ou `META_LOGIN_CONFIG_ID`) e `META_INSTAGRAM_ENABLED=true` configurados.

**Conexão**

- [ ] **OAuth real:** Marketing → Integrações → Conectar Instagram abre o Facebook Login, e no retorno o Vorix conclui sem erro.
- [ ] **State persistente:** conectar com a API rodando em 2 instâncias, ou reiniciar a API entre o início e o retorno. A conexão precisa concluir.
- [ ] **Replay:** reabrir a URL de retorno já usada precisa ser recusado ("autorização expirou ou já foi usada").
- [ ] **Importação de conta:** com 2 ou mais Páginas/contas, o seletor aparece e só as escolhidas são conectadas.

**Publicação**

- [ ] **Imagem no feed (Instagram):** publicar agora. Conferir o post na rede e o link "Ver no Instagram".
- [ ] **Imagem no feed (Facebook):** publicar agora na Página.
- [ ] **Vídeo:** Reel no Instagram e vídeo no feed do Facebook.
- [ ] **Carrossel:** de 2 a 10 imagens (Instagram e Facebook).
- [ ] **Story:** imagem e vídeo (Instagram e Facebook), conforme a permissão aprovada.
- [ ] **Publicação agendada:** agendar para daqui a 10 minutos no fuso do workspace e conferir o horário real na rede.

**Falhas e recuperação**

- [ ] **Token/reautorização:** revogar o app nas configurações da conta Meta e então:
  1. o health check ou a próxima publicação marca a conta como "Reconexão necessária";
  2. o agendamento fica "Aguardando reconexão";
  3. a notificação chega;
  4. reconectar libera a fila conforme a política de atraso.
- [ ] **Erro:** publicar uma mídia fora do padrão (por exemplo, proporção inválida). A mensagem aparece traduzida, sem código técnico, e o destino fica "Falhou".
- [ ] **Retry:** "Tentar novamente" só na rede que falhou. As outras não republicam.
- [ ] **Resultado desconhecido:** simular um timeout depois do envio (proxy com corte de resposta ou limite de rede). O destino fica "Confirmação de publicação pendente" e o Vorix não republica. Confirmar manualmente que saiu e verificar que nenhum post duplicado foi criado.
- [ ] **Reconciliação:** quando houver id de mídia, a manutenção confirma sozinha.

## TikTok

**Configuração**

- [ ] App TikTok com Content Posting API aprovada para publicação direta (`video.publish`) e auditoria concluída. Sem isso, os posts ficam restritos ou privados.
- [ ] `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_OAUTH_REDIRECT_URI` e `TIKTOK_ENABLED=true` configurados.

**Conexão**

- [ ] **OAuth real:** Marketing → Integrações → Conectar TikTok, com retorno concluído.
- [ ] **State persistente:** mesmo teste de 2 instâncias ou restart descrito na seção Meta.
- [ ] **Conta:** o nome e o avatar aparecem no card.

**Publicação**

- [ ] **Vídeo:** publicar agora e conferir na rede.
- [ ] **Photo post:** quando a conta e o app suportarem.
- [ ] **Publicar agora** e **agendar** (horário no fuso do workspace).

**Falhas e recuperação**

- [ ] **Reauth:** revogar o acesso no TikTok. A conta fica "Reconexão necessária", o agendamento é preservado e reconectar retoma.
- [ ] **Falha:** vídeo fora do padrão. A mensagem aparece traduzida e o destino fica "Falhou".
- [ ] **Retry:** só no TikTok.
- [ ] **Resultado desconhecido e reconciliação:** com `publish_id`, a verificação de status confirma publicado ou não publicado sem republicar.

## Encerramento

- [ ] Anexar as evidências em `docs/qa/` com data.
- [ ] Atualizar `realPublishingValidated` do provider no código, com commit próprio e a evidência citada.
- [ ] Marcar como homologado no Admin → Social Providers.
- [ ] Só então liberar empresas reais, uma por vez.
