-- Qual pedido cada mensagem enviada ao aprovador representa (imagem + texto do pedido): responder citando
-- a mensagem no WhatsApp ("Responder") decide aquele pedido sem precisar digitar o código.
alter table whatsapp_approval_outbound add column if not exists request_id text;
