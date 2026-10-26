-- Additive rollout. Existing identities, connections, jobs and official adapters are preserved.
insert into social_provider_switches (provider_type, enabled, approved, reason, updated_by)
values ('instagram_unofficial', true, true, 'Internal operator authorization; real platform validation tracked separately', 'migration:0178'),
       ('facebook_unofficial', true, true, 'Internal operator authorization; real platform validation tracked separately', 'migration:0178'),
       ('tiktok_unofficial', true, true, 'Internal operator authorization; real platform validation tracked separately', 'migration:0178')
on conflict (provider_type) do nothing;

-- Only untouched policies from the previous disabled default are upgraded. Explicit tenant
-- policies and official connections remain available for a later tenant-by-tenant switch.
update social_provider_policies
set preferred_provider = network || '_unofficial',
    enabled_providers = array[network || '_unofficial'],
    publishing_enabled = true,
    updated_by = 'migration:0178', updated_at = now()
where publishing_enabled = false and cardinality(enabled_providers) = 0 and updated_by is null;

-- Facebook text-only organic posts use the existing destination engine.
alter table social_post_destinations drop constraint if exists social_post_destinations_format_check;
alter table social_post_destinations add constraint social_post_destinations_format_check
check (format in ('feed_text','feed_image','feed_video','carousel','story_image','story_video','reel','short_video','photo_post'));
