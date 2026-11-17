# YouTube Shorts no Vorix

O YouTube está integrado em **Marketing → Redes sociais → Integrações**, junto de Instagram,
Facebook e TikTok. O cliente autoriza seu canal diretamente no Google. Depois da autorização,
o canal aparece no composer e pode receber Shorts imediatamente ou pelo calendário do Vorix.

## Configuração do ambiente

1. No Google Cloud, habilite a **YouTube Data API v3**, configure a tela de consentimento OAuth
   e crie um cliente OAuth do tipo **Aplicativo da Web**.
2. Cadastre como URI de redirecionamento a URL pública do frontend seguida de `/youtube/callback`.
   O endereço precisa ser exatamente igual ao configurado no Google.
3. Configure no ambiente da API (o Docker Compose já repassa estas variáveis):

   ```dotenv
   YOUTUBE_ENABLED=true
   YOUTUBE_CLIENT_ID=seu-client-id
   YOUTUBE_CLIENT_SECRET=seu-client-secret
   YOUTUBE_OAUTH_REDIRECT_URI=https://seu-dominio/youtube/callback
   YOUTUBE_SCOPES=https://www.googleapis.com/auth/youtube.upload,https://www.googleapis.com/auth/youtube.readonly
   PUBLICATION_SCHEDULER_ENABLED=true
   ```

4. Execute as migrações (`npm run db:migrate`) e reinicie a API com as novas variáveis.
   A migração `0200_social_youtube_shorts.sql` adiciona YouTube às contas, políticas e destinos.
5. Em **Marketing → Redes sociais → Integrações**, clique em **Conectar YouTube Shorts**,
   entre na conta Google que possui o canal e conceda as duas permissões solicitadas.

`YOUTUBE_ENABLED=true` ativa o provider oficial e sua autorização operacional inicial. Essa
autorização é interna do Vorix e não representa verificação do aplicativo pelo Google ou validação
de postagem real. Switches e políticas já gravados pelo administrador continuam prevalecendo,
assim como permissões do usuário, acesso do tenant ao Marketing e bloqueios da assinatura.
Sem credenciais configuradas, a integração aparece indisponível. Tokens nunca são enviados ao frontend.

## Publicação e agendamento

- Selecione o canal YouTube no composer e envie **um vídeo vertical ou quadrado de até 180 segundos**.
  O servidor verifica dimensões e duração; se não conseguir obtê-las, bloqueia o envio como Short.
- O limite operacional deste adaptador é 500 MB; formatos aceitos: MP4 e QuickTime.
- A primeira linha da legenda forma o título (até 100 caracteres). A legenda e as hashtags formam
  a descrição. A visibilidade usada pelo composer social é pública.
- Música deve estar incorporada ao vídeo. A integração não oferece o catálogo de música do YouTube.
- Agendamento usa o fuso do workspace e a fila persistente existente do Vorix. A API e o scheduler
  precisam continuar em execução; este fluxo não delega o agendamento ao `status.publishAt` do YouTube.
- Reconexão atualiza o mesmo canal. Desconectar preserva os agendamentos e o histórico.
  A política de atraso da integração decide o que acontece quando o canal volta a funcionar.

## Autorização e segurança

O OAuth usa PKCE S256 e state de uso único com validade de 10 minutos, vinculado ao tenant e ao
usuário. O state usa o armazenamento compartilhado existente (Postgres quando configurado), para
funcionar após reinícios e entre instâncias da API. O caminho de retorno é guardado no servidor.
O refresh token fica no cofre de credenciais e permite renovar o access token durante a publicação.
Se o Google revogar o acesso, será necessário reconectar o canal.

## Verificação

`npm run test:youtube` cobre OAuth, upload, permissões, isolamento, validação dos Shorts,
agendamento, idempotência, histórico e migração. As chamadas ao Google são simuladas nos testes;
homologar uma postagem real exige configurar o aplicativo e conectar um canal autorizado.

Referências oficiais: [upload pela API](https://developers.google.com/youtube/data/reference/rest/v3/videos/insert),
[regras de Shorts](https://support.google.com/youtube/answer/15424877),
[OAuth do Google](https://developers.google.com/identity/protocols/oauth2/web-server).
