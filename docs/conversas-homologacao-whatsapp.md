# Módulo Conversas — Checklist de Homologação Real do WhatsApp

Roteiro curto para fechar `RUNTIME_VALIDATION_PENDING_QR` quando houver um número de telefone
disponível para teste. Nenhum item aqui pode ser marcado validado sem execução real — este
documento é só o roteiro, não a validação em si.

Para cada item: capturar um fixture sanitizado do payload real recebido (mesmo padrão já usado no
spike da Fase 2 — `captureSpikeFixture`, remove tudo sensível antes de salvar) e anexar ao
registro da homologação.

## Roteiro

1. **QR** — `GET /inbox/connections/:id/qr` gera um QR válido; escanear com o WhatsApp do celular
   de teste.
2. **CONNECTED** — após escanear, `messaging_connections.status` vira `connected` (via evento de
   fila ou `refresh-status`); `phoneNumber` preenchido corretamente.
3. **Inbound texto** — enviar uma mensagem de texto do celular de teste para o número conectado;
   confirmar que aparece na Inbox em tempo real (SSE) com o conteúdo correto.
4. **Outbound texto** — responder pela Inbox; confirmar entrega no celular de teste.
5. **Delivered** — confirmar que o outbound acima transiciona para `delivered` (recibo de
   entrega real do WhatsApp, não só `sent`).
6. **Read** — abrir a mensagem no celular de teste; confirmar transição para `read`.
7. **Imagem** — enviar uma imagem do celular de teste; confirmar que chega correta na Inbox
   (mídia baixada e reenviada ao storage do Vorix, nunca linkada direto da URL do WuzAPI).
8. **Áudio** — mesmo teste, para nota de voz/áudio.
9. **Vídeo** — mesmo teste, para vídeo.
10. **Documento** — mesmo teste, para um PDF/documento.
11. **Desconexão temporária** — desligar o Wi-Fi/dados do celular de teste por alguns minutos (ou
    forçar o WuzAPI a perder o socket); confirmar que `messaging_connections.status` reflete
    `disconnected`/`reconnecting`, sem falso `connected`.
12. **Reconexão** — restaurar a conectividade; confirmar reconexão automática e retorno a
    `connected` sem intervenção manual.
13. **Logout/revogação** — fazer logout pelo próprio celular (WhatsApp > Aparelhos conectados >
    remover); confirmar que o Vorix marca `logged_out` e **não tenta reconectar sozinho** (ver
    `MESSAGING_CONNECTION_TERMINAL_STATUSES` — comportamento intencional, validar que se mantém
    real).
14. **Novo pareamento** — depois do logout, gerar um novo QR e parear de novo; confirmar que a
    conexão volta a funcionar normalmente (novo `externalSessionId`, histórico de conversas antigo
    preservado).

## Campos de mídia de ENVIO (seção 6 do escopo da Fase 7)

`sendImage`/`sendAudio`/`sendVideo`/`sendDocument` no `WuzApiClient` foram escritos por analogia
com `sendText` (único endpoint confirmado ao vivo no spike da Fase 2) — os nomes exatos de campo
(`Image`/`Audio`/`Video`/`Document`/`Caption`/`FileName`) **não foram confirmados contra uma
instância real**. O próprio código já documenta isso explicitamente
(`src/infrastructure/messaging/wuzapi/wuzapi-client.ts`, comentário "PENDENTE DE CONFIRMAÇÃO").
Ao homologar os itens 7–10 acima, se o envio de mídia falhar, o primeiro lugar a checar é o nome
exato dos campos no corpo da requisição — não presumir que o formato de `sendText` se aplica.
