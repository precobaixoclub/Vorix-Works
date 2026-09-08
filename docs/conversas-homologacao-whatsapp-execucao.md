# Módulo Conversas — Roteiro de EXECUÇÃO da homologação real do WhatsApp

Complementa `docs/conversas-homologacao-whatsapp.md` (o checklist original) com os comandos
exatos pra executar cada item. Feito pra você rodar sozinho, com um número de telefone de
homologação dedicado (nunca um número de cliente real), e me devolver os resultados/logs pra eu
classificar cada item como `VERIFIED_RUNTIME` / `FAILED` / `BLOCKED` / `NOT_SUPPORTED` /
`NOT_EXECUTED`.

Ambiente: produção real (`api.vorixworks.com`), `conversas-gateway` já ligado (WuzAPI 8 dias no
ar, nunca pareado ainda). `CONVERSATIONS_MODULE_ENABLED` está `false` na API pra clientes normais
— os passos 0.1/0.5 abaixo ligam e desligam isso só durante a sua sessão de teste.

## 0. Preparação (uma vez só)

**0.1 — Ligar o módulo temporariamente (só durante o teste):**

```bash
ssh root@209.97.152.212
sed -i 's/^CONVERSATIONS_MODULE_ENABLED=false/CONVERSATIONS_MODULE_ENABLED=true/' /opt/zuno/.env.zuno
cd /opt/zuno && docker compose -f docker-compose.zuno.yml --env-file .env.zuno up -d zuno-api
```

**0.2 — Login (use sua conta real de dono da plataforma) e guarde o `accessToken`:**

```bash
curl -s -X POST https://api.vorixworks.com/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"SEU_EMAIL","password":"SUA_SENHA"}' | tee /tmp/login.json
export TOKEN=$(python3 -c "import json;print(json.load(open('/tmp/login.json'))['data']['accessToken'])")
```

**0.3 — Pegue seu `workspaceId` real** (ou use um workspace de teste dedicado, recomendado):

```bash
curl -s https://api.vorixworks.com/v1/workspaces -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
export WORKSPACE_ID="cole_o_id_aqui"
```

**0.4 — Crie a conexão:**

```bash
curl -s -X POST https://api.vorixworks.com/v1/inbox/connections \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"workspaceId\":\"$WORKSPACE_ID\",\"displayName\":\"Homologacao WhatsApp\"}" | tee /tmp/connection.json
export CONNECTION_ID=$(python3 -c "import json;print(json.load(open('/tmp/connection.json'))['data']['id'])")
```

**0.5 — Ao TERMINAR todos os testes, desligar de volta:**

```bash
ssh root@209.97.152.212
sed -i 's/^CONVERSATIONS_MODULE_ENABLED=true/CONVERSATIONS_MODULE_ENABLED=false/' /opt/zuno/.env.zuno
cd /opt/zuno && docker compose -f docker-compose.zuno.yml --env-file .env.zuno up -d zuno-api
```

## 1. QR

```bash
curl -s "https://api.vorixworks.com/v1/inbox/connections/$CONNECTION_ID/qr?workspaceId=$WORKSPACE_ID" \
  -H "Authorization: Bearer $TOKEN" | python3 -c "import json,sys; d=json.load(sys.stdin)['data']; print(d['expiresAt']); open('/tmp/qr.png','wb').write(__import__('base64').b64decode(d['qrCode'].split(',')[-1]))"
```
Abra `/tmp/qr.png` (copie pro seu computador com `scp`) e escaneie com o WhatsApp do celular de
homologação (Aparelhos conectados → Conectar um aparelho). **Evidência:** horário do scan,
screenshot do QR, `connectionId`.

## 2. CONNECTED

```bash
curl -s -X POST "https://api.vorixworks.com/v1/inbox/connections/$CONNECTION_ID/refresh-status" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"workspaceId\":\"$WORKSPACE_ID\"}" | python3 -m json.tool
```
Confirme `status: "connected"` e `phoneNumber` preenchido com o número real do celular de teste.

## 3. Inbound texto

Do celular de teste, mande uma mensagem de texto qualquer PARA o número que acabou de conectar
(mensagem pra si mesmo via outro contato, ou peça pra alguém te mandar uma mensagem de teste).
Depois:
```bash
curl -s "https://api.vorixworks.com/v1/inbox/conversations?workspaceId=$WORKSPACE_ID" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```
Pegue o `conversationId` da conversa nova e confira as mensagens:
```bash
curl -s "https://api.vorixworks.com/v1/inbox/conversations/CONVERSATION_ID/messages?workspaceId=$WORKSPACE_ID" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```
**Evidência:** `externalMessageId`, corpo da mensagem, `occurredAt`, comparar com o horário real
de envio no celular.

## 4. Outbound texto

```bash
curl -s -X POST "https://api.vorixworks.com/v1/inbox/conversations/CONVERSATION_ID/messages" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"workspaceId\":\"$WORKSPACE_ID\",\"body\":\"Teste de homologacao - outbound\"}" | tee /tmp/outbound.json
```
Confirme no celular de teste que a mensagem chegou. **Evidência:** `messageId` interno (resposta
acima), horário de chegada no celular.

## 5. Delivered / 6. Read

Repita a consulta de mensagens (passo 3) alguns segundos depois de enviar (passo 4) e de novo
depois de ABRIR a mensagem no celular de teste:
```bash
curl -s "https://api.vorixworks.com/v1/inbox/conversations/CONVERSATION_ID/messages?workspaceId=$WORKSPACE_ID" \
  -H "Authorization: Bearer $TOKEN" | python3 -c "import json,sys; [print(m['id'], m['status']) for m in json.load(sys.stdin)['data']]"
```
**Evidência:** timestamps de cada transição (`sent` → `delivered` → `read`), e quanto tempo levou
cada uma — isso é o dado real que falta pra fechar a janela de corrida documentada na seção 8.

## 7-10. Mídia (imagem, áudio, vídeo, documento)

Mande cada tipo do celular de teste PARA o número conectado (mesmo padrão do item 3) e confirme
que aparece corretamente na Inbox (passo de consulta de mensagens). **Se algum tipo falhar ao
ENVIAR pela Inbox** (Vorix → WhatsApp), o primeiro lugar a checar é
`src/infrastructure/messaging/wuzapi/wuzapi-client.ts` — os nomes de campo de `sendImage`/
`sendAudio`/`sendVideo`/`sendDocument` nunca foram confirmados contra uma instância real (só
`sendText` foi, no spike da Fase 2). Não corrija adivinhando — me mande o erro exato retornado
pelo WuzAPI (`docker logs conversas-gateway-wuzapi-1 --tail 50` no momento da falha) que eu ajusto
o client com a forma real.

## 11. Desconexão temporária / 12. Reconexão

Desligue Wi-Fi/dados do celular por ~2 minutos. Repita o `refresh-status` do passo 2 — deve virar
algo diferente de `connected` (`disconnected`/`reconnecting`). Religue a internet do celular,
espere ~1 minuto, repita `refresh-status` de novo — deve voltar a `connected` sozinho, sem você
mexer em nada no Vorix. **Evidência:** os dois horários (queda/volta) e o `status` retornado em
cada consulta.

## 13. Logout / revogação

No celular: WhatsApp → Aparelhos conectados → remover o aparelho "Homologacao WhatsApp".
```bash
curl -s -X POST "https://api.vorixworks.com/v1/inbox/connections/$CONNECTION_ID/refresh-status" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"workspaceId\":\"$WORKSPACE_ID\"}" | python3 -m json.tool
```
Confirme `status: "logged_out"`. Espere alguns minutos e repita — **o status TEM que continuar
`logged_out`** (nunca voltar sozinho a `connected`/`connecting`). Se voltar sozinho, isso é uma
falha real do princípio "estado terminal nunca ressuscita por evento atrasado" — reporte como
`FAILED`, não corrija.

## 14. Novo pareamento

Crie uma NOVA conexão (repita o passo 0.4 com outro `displayName`) e refaça o passo 1 (QR) com
essa nova conexão. Confirme que funciona normalmente e que a conversa/histórico da conexão ANTIGA
continua visível (`GET /v1/inbox/conversations?workspaceId=...` deve listar as duas conexões).

## Template de evidência (preencha por item)

| # | Item | Horário | connectionId | conversationId | messageId | externalMessageId | Resultado | Observação |
|---|------|---------|--------------|-----------------|-----------|--------------------|-----------|------------|
| 1 | QR | | | | | | | |
| 2 | Connected | | | | | | | |
| ... | | | | | | | | |

`Resultado` = `VERIFIED_RUNTIME` / `FAILED` / `BLOCKED` / `NOT_SUPPORTED` / `NOT_EXECUTED`.
Nunca marque `VERIFIED_RUNTIME` sem ter executado de verdade — se pular um item, marque
`NOT_EXECUTED` e diga por quê.

Me devolva a tabela preenchida (+ qualquer log de erro relevante, sem conteúdo sensível) que eu
consolido no relatório final.
