# Recuperação do WhatsApp do Preço Baixo Club — 02/11/2026

## Diagnóstico e solução

O canal Atendimento continuava cadastrado em `tenant-vorix`, no espaço Preço Baixo Club. Não havia sido excluído: os registros de duas conversas, 42 mensagens e 95 contatos de Inbox estavam presentes. A sessão estava desconectada, e o Vorix havia passado para `logged_out`, fazendo a tela de Conversas informar que não havia canal conectado.

A tentativa de reconexão da sessão existente revelou `ClientOutdated` no gateway. A imagem em execução, `asternic/wuzapi:latest`, havia sido criada em 10/08/2026. O WhatsApp recusava o cliente antigo mesmo com o JID do dispositivo preservado.

Foi aplicada a versão oficial [WuzAPI 1.1.0](https://github.com/asternic/wuzapi/releases/tag/v1.1.0), publicada em 26/10/2026. Ela sucede a versão cuja [nota de correção de Client outdated (405)](https://github.com/asternic/wuzapi/blob/v1.0.9/release-notes.md) descreve a atualização do Whatsmeow. A imagem foi fixada por versão e digest no compose e no exemplo de ambiente, e a referência foi atualizada no ambiente privado de produção.

Imagem validada:

`asternic/wuzapi:1.1.0@sha256:d9139ddcd5b3293e7ba7cd9af210b39adc6eafb16a0e23e84f4fea0f385395be`

Somente o serviço WuzAPI foi recriado, com `--no-deps`. Os bancos, RabbitMQ, API, site, workers e os serviços de outros projetos mantiveram seus horários de inicialização. Tokens, credenciais e chave de criptografia foram comparados e preservados.

Uma checagem inicial inspecionou o ID do container já substituído e acionou rollback automático. A checagem foi corrigida para verificar apenas os IDs dos outros serviços, e a atualização foi reaplicada com sucesso.

O gateway voltou a reportar `connected=true` e `loggedIn=true` com a mesma sessão, sem novo QR Code. O status do canal no Vorix foi sincronizado pela rota autenticada `refresh-status`, mantendo o identificador do canal e seus vínculos. Não foi criado outro canal e não foram enviadas mensagens de teste.

## Backup e validação

Backup anterior à atualização, com gzip validado e arquivos privados em modo 0600:

`/opt/zuno/deploy_backups/whatsapp-recovery-20261103T010334Z`

Inclui os bancos do WuzAPI e Vorix, exportação do sistema de arquivos do container anterior, compose, ambiente privado e referência da imagem anterior para reversão.

- WuzAPI SQL SHA-256: `42466780e2f77e5e68cc4f9f539529d1ce48b2a02cf6f253a69ff435d3408dce`.
- Vorix SQL SHA-256: `58efb7c379b6272187ed81885a2d7a2f0f8e23eec1a7c3aba1b677dc078d6394`.
- Sistema de arquivos SHA-256: `5a75d975c8ed87fe827ff95bcd691d6a2c462c2eba716eb4f9b2c1a7d165c014`.

A conferência no site real, em 1440 px e 390 px, encontrou Atendimento com status Conectado e a ação Desconectar disponível. A navegação foi de leitura, sem erros de página ou gravações de negócio. Os registros de conversas, mensagens e contatos foram conferidos novamente após a recuperação.

Evidência estruturada: `whatsapp-recovery-20261102.validation.json`.
