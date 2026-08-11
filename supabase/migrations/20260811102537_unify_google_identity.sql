-- Customer Zero P0 — one Google identity, one durable credential row.
--
-- Older deployments wrote one row per surface (Gmail, Calendar, Drive). That
-- made the credential layer look like several auth systems and allowed a
-- scope granted for one surface to be projected onto the others. Keep the
-- newest token material, union the scopes actually recorded, and then enforce
-- one row per (organization, user).

alter table public.google_oauth_tokens
  add column if not exists operational_capabilities text[] not null default '{}';

create temporary table _google_identity_canonical on commit drop as
with latest as (
  select distinct on (organization_id, user_id)
    id,
    organization_id,
    user_id,
    access_token,
    refresh_token,
    expires_at,
    email,
    display_name,
    operational_verified_at,
    operational_probe_error,
    created_at,
    updated_at
  from public.google_oauth_tokens
  order by organization_id, user_id, updated_at desc
), scopes as (
  select
    organization_id,
    user_id,
    array(
      select distinct scope
      from public.google_oauth_tokens row_scope
      cross join unnest(row_scope.scopes) as scope
      where row_scope.organization_id = grouped.organization_id
        and row_scope.user_id = grouped.user_id
      order by scope
    )::text[] as scopes
  from public.google_oauth_tokens grouped
  group by organization_id, user_id
), refreshes as (
  select
    organization_id,
    user_id,
    (
      array_agg(nullif(refresh_token, '') order by updated_at desc)
      filter (where nullif(refresh_token, '') is not null)
    )[1] as refresh_token
  from public.google_oauth_tokens
  group by organization_id, user_id
)
select
  latest.id as survivor_id,
  latest.organization_id,
  latest.user_id,
  'gmail'::text as provider,
  latest.access_token,
  coalesce(latest.refresh_token, refreshes.refresh_token) as refresh_token,
  latest.expires_at,
  coalesce(scopes.scopes, '{}'::text[]) as scopes,
  latest.email,
  latest.display_name,
  latest.operational_verified_at,
  latest.operational_probe_error,
  case
    when latest.operational_verified_at is not null
      then array['email.read']::text[]
    else '{}'::text[]
  end as operational_capabilities,
  latest.created_at,
  latest.updated_at
from latest
join scopes using (organization_id, user_id)
join refreshes using (organization_id, user_id);

delete from public.google_oauth_tokens target
using _google_identity_canonical canonical
where target.organization_id = canonical.organization_id
  and target.user_id = canonical.user_id
  and target.id <> canonical.survivor_id;

update public.google_oauth_tokens target
set
  provider = canonical.provider,
  access_token = canonical.access_token,
  refresh_token = canonical.refresh_token,
  expires_at = canonical.expires_at,
  scopes = canonical.scopes,
  email = canonical.email,
  display_name = canonical.display_name,
  operational_verified_at = canonical.operational_verified_at,
  operational_probe_error = canonical.operational_probe_error,
  operational_capabilities = canonical.operational_capabilities,
  created_at = canonical.created_at,
  updated_at = canonical.updated_at
from _google_identity_canonical canonical
where target.id = canonical.survivor_id;

alter table public.google_oauth_tokens
  drop constraint if exists google_oauth_tokens_organization_id_user_id_provider_key;

alter table public.google_oauth_tokens
  add constraint google_oauth_tokens_organization_id_user_id_key
  unique (organization_id, user_id);

comment on table public.google_oauth_tokens is
  'One durable Google identity per organization/user. Capabilities are derived from the granted scopes array.';
