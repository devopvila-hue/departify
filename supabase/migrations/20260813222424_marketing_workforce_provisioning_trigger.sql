create or replace function public.ensure_marketing_workforce_rows()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.department_provisioned_at is not null then
    insert into public.department_employees
      (organization_id, department_id, employee_id, label, role, capabilities)
    values
      (new.organization_id, 'marketing', 'agent_content_strategist', 'Especialista en Contenido', 'Creación de contenido', '["content_creation","content_strategy","positioning_strategy"]'::jsonb),
      (new.organization_id, 'marketing', 'agent_social_media_manager', 'Especialista en Redes Sociales', 'Redes sociales', '["social_media","content_creation"]'::jsonb),
      (new.organization_id, 'marketing', 'agent_ads_specialist', 'Especialista en Publicidad', 'Publicidad y adquisición', '["advertising_paid","campaign_strategy"]'::jsonb)
    on conflict (organization_id, department_id, employee_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists company_dna_marketing_workforce on public.company_dna;
create trigger company_dna_marketing_workforce
after insert or update of department_provisioned_at on public.company_dna
for each row execute function public.ensure_marketing_workforce_rows();

revoke execute on function public.ensure_marketing_workforce_rows() from anon, authenticated;
