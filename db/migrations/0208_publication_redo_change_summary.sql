-- Refação direcionada (27/11/2026): o que mudou e o que ficou igual na nova versão ("Mudou: texto da tela 3.
-- Mantive: imagens, legenda.") — vai na mensagem de aprovação pelo WhatsApp. Só acréscimo.
alter table publication_redo_requests add column if not exists change_summary text;
