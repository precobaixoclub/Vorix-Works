-- Mercado Livre OAuth: the state is also bound to the browser that started the flow (hash of an
-- HttpOnly cookie nonce). An authorize URL sent to someone else can no longer link their seller
-- account into the sender's tenant. Pending states created before this column are simply rejected
-- (they expire in 10 minutes anyway). Rollback: drop the column; no data depends on it.
alter table marketplace_oauth_states add column if not exists browser_hash text;
