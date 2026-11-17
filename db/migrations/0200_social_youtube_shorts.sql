-- YouTube usa o mesmo calendário, fila e histórico das demais redes sociais.
alter table social_accounts drop constraint if exists social_accounts_network_check;
alter table social_accounts add constraint social_accounts_network_check
  check (network in ('instagram','facebook','tiktok','youtube'));

alter table social_provider_policies drop constraint if exists social_provider_policies_network_check;
alter table social_provider_policies add constraint social_provider_policies_network_check
  check (network in ('instagram','facebook','tiktok','youtube'));

alter table social_post_destinations drop constraint if exists social_post_destinations_network_check;
alter table social_post_destinations add constraint social_post_destinations_network_check
  check (network in ('instagram','facebook','tiktok','youtube'));
