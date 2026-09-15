-- 0121 — Módulo Conversas: reações e respostas citadas, pedidas explicitamente pelo usuário em
-- produção ("quando alguem responde uma mensagem não esta mostrando o conteudo corretamente... e
-- ajuste tambem para quando alguem reagir a uma mensagem").
--
-- `reactions` — nunca uma mensagem nova (WhatsApp ReactionMessage é uma ATUALIZAÇÃO de uma
-- mensagem já existente, ver applyMessageReaction/inbox-use-cases.ts): array de no máximo uma
-- entrada por `reactorId` (`emoji: ""` removeria a entrada, nunca fica um registro "vazio").
--
-- `quoted_message` — snapshot da mensagem CITADA no momento do envio (stanzaID/participant/
-- fallback de corpo+tipo) — nunca resolvido de novo depois; o frontend prefere resolver contra a
-- própria timeline já carregada quando possível (conteúdo sempre atualizado), usando isto só como
-- fallback quando a mensagem original não estiver mais na página.

alter table inbox_messages
  add column if not exists reactions jsonb not null default '[]'::jsonb,
  add column if not exists quoted_message jsonb;
