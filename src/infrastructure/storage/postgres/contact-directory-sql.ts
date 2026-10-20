/** Perfis preenchidos ou com atividade comercial continuam visíveis enquanto o número é resolvido. */
export const CONTACT_DIRECTORY_PROTECTED_SQL = `(
  nullif(trim(c.company), '') is not null or nullif(trim(c.document), '') is not null
  or nullif(trim(c.notes), '') is not null or c.owner_user_id is not null or c.team_id is not null
  or c.tags <> '[]'::jsonb or (c.custom_fields - 'phone') <> '{}'::jsonb
  or exists (select 1 from deals d where d.contact_id = c.id)
  or exists (select 1 from proposals p where p.contact_id = c.id)
  or exists (select 1 from tasks t where t.contact_id = c.id)
  or exists (select 1 from deal_participants dp where dp.contact_id = c.id)
  or exists (select 1 from proposal_recipients pr where pr.contact_id = c.id)
  or exists (select 1 from site_inquiries si where si.contact_id = c.id)
)`;
