-- =====================================================================
-- Anuncia Aí — 🤝 Comunidade (rode uma vez no SQL Editor; pode rodar de novo).
--   * Vitrine: página pública da empresa (só aparece quem ligar) com logo,
--     contatos, descrição e as artes que ela escolher mostrar.
--   * Guia: as vitrines por cidade e ramo (guia.html).
--   * Rede: cada empresa recomenda até 6 parceiros da comunidade; eles aparecem
--     na vitrine dela ("Recomendamos") e ela pode divulgar as artes deles.
-- O público só lê pelas funções vitrine_publica/guia (nunca e-mail, pagamento
-- ou situação da assinatura). O mesmo trecho está no schema.sql.
-- =====================================================================
alter table public.empresas add column if not exists vitrine   boolean not null default false;
alter table public.empresas add column if not exists slug      text;
alter table public.empresas add column if not exists bairro    text;
alter table public.empresas add column if not exists descricao text;
create unique index if not exists empresas_slug_idx on public.empresas (slug) where slug is not null;

create table if not exists public.vitrine_artes (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references public.empresas (id) on delete cascade,
  caminho     text not null,                                -- arquivo no bucket "vitrine" (pasta = id da empresa)
  legenda     text,
  criado_em   timestamptz not null default now()
);
create index if not exists vitrine_artes_emp_idx on public.vitrine_artes (empresa_id, criado_em desc);

create table if not exists public.parceiros (
  empresa_id  uuid not null references public.empresas (id) on delete cascade,   -- quem recomenda
  parceiro_id uuid not null references public.empresas (id) on delete cascade,   -- quem é recomendado
  criado_em   timestamptz not null default now(),
  primary key (empresa_id, parceiro_id),
  check (empresa_id <> parceiro_id)
);
create index if not exists parceiros_parc_idx on public.parceiros (parceiro_id);

-- cartão público de uma empresa (o que qualquer pessoa pode ver)
create or replace function public.cartao_publico(e public.empresas) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('nome', e.nome, 'slug', e.slug, 'ramo', e.ramo, 'cidade', e.cidade, 'bairro', e.bairro,
    'descricao', e.descricao, 'whatsapp', e.whatsapp, 'instagram', e.instagram, 'site', e.site,
    'cor1', e.cor1, 'cor2', e.cor2, 'logo', e.logo,
    'arte', (select a.caminho from public.vitrine_artes a where a.empresa_id = e.id order by a.criado_em desc limit 1));
$$;

-- empresa aparece para o público: ligou a vitrine, tem endereço e a assinatura está em dia
create or replace function public.na_vitrine(e public.empresas) returns boolean
language sql stable as $$ select e.vitrine and e.slug is not null and public.acesso_liberado(e); $$;

-- a empresa liga/desliga a vitrine e preenche endereço, bairro e descrição
create or replace function public.salvar_vitrine(p jsonb) returns public.empresas
language plpgsql volatile security definer set search_path = public as $$
declare
  e public.empresas;
  v_slug text := lower(trim(coalesce(p ->> 'slug', '')));
begin
  if v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(v_slug) not between 3 and 60 then
    raise exception 'Endereço inválido: use de 3 a 60 letras sem acento, números e hífen (ex.: age-eletrica).';
  end if;
  if exists (select 1 from public.empresas where slug = v_slug and dono <> auth.uid()) then
    raise exception 'Esse endereço já é de outra empresa. Escolha outro.';
  end if;
  update public.empresas set
    vitrine   = coalesce((p ->> 'vitrine')::boolean, vitrine),
    slug      = v_slug,
    bairro    = nullif(left(trim(coalesce(p ->> 'bairro', '')), 80), ''),
    descricao = nullif(left(trim(coalesce(p ->> 'descricao', '')), 500), '')
  where dono = auth.uid()
  returning * into e;
  if not found then raise exception 'Empresa não encontrada.'; end if;
  return e;
end $$;

-- 📌 põe uma arte na vitrine (fica com as 12 mais novas); devolve os arquivos que saíram, para o app apagar
create or replace function public.por_na_vitrine(p_caminho text, p_legenda text default null) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_emp uuid;
  v_sai jsonb;
begin
  select id into v_emp from public.empresas where dono = auth.uid();
  if v_emp is null then raise exception 'Empresa não encontrada.'; end if;
  if split_part(coalesce(p_caminho, ''), '/', 1) <> v_emp::text then raise exception 'Arquivo inválido.'; end if;
  insert into public.vitrine_artes (empresa_id, caminho, legenda, criado_em) values (v_emp, p_caminho, left(p_legenda, 600), clock_timestamp());
  with velhas as (
    select id, caminho from public.vitrine_artes where empresa_id = v_emp order by criado_em desc offset 12
  ), apagadas as (
    delete from public.vitrine_artes a using velhas v where a.id = v.id returning v.caminho
  )
  select coalesce(jsonb_agg(caminho), '[]'::jsonb) into v_sai from apagadas;
  return v_sai;
end $$;

create or replace function public.tirar_da_vitrine(p_id uuid) returns text
language plpgsql volatile security definer set search_path = public as $$
declare v_cam text;
begin
  delete from public.vitrine_artes where id = p_id and empresa_id in (select id from public.empresas where dono = auth.uid())
  returning caminho into v_cam;
  return v_cam;
end $$;

-- página pública de uma empresa (vitrine.html?e=endereco)
create or replace function public.vitrine_publica(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare e public.empresas;
begin
  select * into e from public.empresas where slug = lower(trim(p_slug));
  if not found or not public.na_vitrine(e) then return null; end if;
  return public.cartao_publico(e) || jsonb_build_object(
    'artes', coalesce((select jsonb_agg(jsonb_build_object('caminho', a.caminho, 'legenda', a.legenda, 'criado_em', a.criado_em) order by a.criado_em desc)
      from public.vitrine_artes a where a.empresa_id = e.id), '[]'::jsonb),
    'parceiros', coalesce((select jsonb_agg(public.cartao_publico(x) order by x.nome)
      from public.parceiros pr join public.empresas x on x.id = pr.parceiro_id where pr.empresa_id = e.id and public.na_vitrine(x)), '[]'::jsonb),
    'recomendada_por', (select count(*) from public.parceiros pr join public.empresas x on x.id = pr.empresa_id where pr.parceiro_id = e.id and public.na_vitrine(x)));
end $$;

-- guia: vitrines por cidade e ramo (sem diferença de maiúscula; a busca procura no nome, ramo, bairro e descrição)
create or replace function public.guia(p_cidade text default null, p_ramo text default null, p_busca text default null) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(c order by c ->> 'nome'), '[]'::jsonb) from (
    select public.cartao_publico(e) as c from public.empresas e
    where public.na_vitrine(e)
      and (coalesce(p_cidade, '') = '' or lower(trim(e.cidade)) = lower(trim(p_cidade)))
      and (coalesce(p_ramo, '') = '' or lower(trim(e.ramo)) = lower(trim(p_ramo)))
      and (coalesce(p_busca, '') = '' or lower(concat_ws(' ', e.nome, e.ramo, e.bairro, e.descricao)) like '%' || lower(trim(p_busca)) || '%')
    limit 300
  ) t;
$$;

-- cidades e ramos que têm vitrine (para os filtros do guia)
create or replace function public.guia_filtros() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    -- "Ibirité" e "ibirité " contam como a mesma cidade
    'cidades', coalesce((select jsonb_agg(c order by c) from (select min(trim(e.cidade)) c from public.empresas e
      where public.na_vitrine(e) and coalesce(trim(e.cidade), '') <> '' group by lower(trim(e.cidade))) t), '[]'::jsonb),
    'ramos', coalesce((select jsonb_agg(r order by r) from (select min(trim(e.ramo)) r from public.empresas e
      where public.na_vitrine(e) and coalesce(trim(e.ramo), '') <> '' group by lower(trim(e.ramo))) t), '[]'::jsonb));
$$;

-- 🤝 rede da empresa logada: parceiros, quem recomenda ela e sugestões da mesma cidade
create or replace function public.minha_rede() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare e public.empresas;
begin
  select * into e from public.empresas where dono = auth.uid();
  if not found then raise exception 'Empresa não encontrada.'; end if;
  return jsonb_build_object(
    'parceiros', coalesce((select jsonb_agg(public.cartao_publico(x) || jsonb_build_object('artes',
        coalesce((select jsonb_agg(jsonb_build_object('caminho', a.caminho, 'legenda', a.legenda) order by a.criado_em desc)
          from (select * from public.vitrine_artes where empresa_id = x.id order by criado_em desc limit 3) a), '[]'::jsonb)) order by x.nome)
      from public.parceiros pr join public.empresas x on x.id = pr.parceiro_id where pr.empresa_id = e.id and public.na_vitrine(x)), '[]'::jsonb),
    'me_recomendam', coalesce((select jsonb_agg(public.cartao_publico(x) || jsonb_build_object('ja_recomendo',
        exists (select 1 from public.parceiros p2 where p2.empresa_id = e.id and p2.parceiro_id = x.id)) order by x.nome)
      from public.parceiros pr join public.empresas x on x.id = pr.empresa_id where pr.parceiro_id = e.id and public.na_vitrine(x)), '[]'::jsonb),
    'sugestoes', coalesce((select jsonb_agg(public.cartao_publico(t.x)) from (
        select x from public.empresas x where public.na_vitrine(x) and x.id <> e.id
          and lower(trim(coalesce(x.cidade, ''))) = lower(trim(coalesce(e.cidade, '')))
          and lower(trim(coalesce(x.ramo, ''))) <> lower(trim(coalesce(e.ramo, '')))
          and not exists (select 1 from public.parceiros p3 where p3.empresa_id = e.id and p3.parceiro_id = x.id)
        order by random() limit 12) t), '[]'::jsonb));
end $$;

create or replace function public.recomendar(p_slug text, p_sim boolean default true) returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  e public.empresas;
  x public.empresas;
begin
  select * into e from public.empresas where dono = auth.uid();
  if not found then raise exception 'Empresa não encontrada.'; end if;
  select * into x from public.empresas where slug = lower(trim(p_slug));
  if not found then raise exception 'Empresa não encontrada no guia.'; end if;
  if not p_sim then delete from public.parceiros where empresa_id = e.id and parceiro_id = x.id; return; end if;
  if not public.na_vitrine(e) then raise exception 'Ligue a sua vitrine antes de recomendar parceiros (eles aparecem nela).'; end if;
  if not public.na_vitrine(x) then raise exception 'Essa empresa não está na vitrine.'; end if;
  if x.id = e.id then raise exception 'Você não pode recomendar a sua própria empresa.'; end if;
  if (select count(*) from public.parceiros where empresa_id = e.id) >= 6 then raise exception 'Você já tem 6 parceiros. Tire um para colocar outro.'; end if;
  insert into public.parceiros (empresa_id, parceiro_id) values (e.id, x.id) on conflict do nothing;
end $$;

-- ---------- regras de acesso ----------
alter table public.vitrine_artes enable row level security;
drop policy if exists vit_le on public.vitrine_artes;
create policy vit_le on public.vitrine_artes for select to authenticated
  using (public.eh_admin() or empresa_id in (select id from public.empresas where dono = auth.uid()));
drop policy if exists vit_admin on public.vitrine_artes;
create policy vit_admin on public.vitrine_artes for all to authenticated using (public.eh_admin()) with check (public.eh_admin());

alter table public.parceiros enable row level security;
drop policy if exists parc_le on public.parceiros;
create policy parc_le on public.parceiros for select to authenticated
  using (public.eh_admin() or empresa_id in (select id from public.empresas where dono = auth.uid()));
drop policy if exists parc_admin on public.parceiros;
create policy parc_admin on public.parceiros for all to authenticated using (public.eh_admin()) with check (public.eh_admin());

revoke execute on function public.cartao_publico(public.empresas) from public, anon, authenticated;
revoke execute on function public.salvar_vitrine(jsonb) from public, anon;
revoke execute on function public.por_na_vitrine(text, text) from public, anon;
revoke execute on function public.tirar_da_vitrine(uuid) from public, anon;
revoke execute on function public.minha_rede() from public, anon;
revoke execute on function public.recomendar(text, boolean) from public, anon;
grant execute on function public.salvar_vitrine(jsonb) to authenticated;
grant execute on function public.por_na_vitrine(text, text) to authenticated;
grant execute on function public.tirar_da_vitrine(uuid) to authenticated;
grant execute on function public.minha_rede() to authenticated;
grant execute on function public.recomendar(text, boolean) to authenticated;
grant execute on function public.vitrine_publica(text) to anon, authenticated;
grant execute on function public.guia(text, text, text) to anon, authenticated;
grant execute on function public.guia_filtros() to anon, authenticated;

-- Pasta pública "vitrine" (as artes que a empresa escolheu mostrar). Cada empresa só mexe na própria pasta.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('vitrine', 'vitrine', true, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 3145728, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];
drop policy if exists anuncia_vit_envia on storage.objects;
create policy anuncia_vit_envia on storage.objects for insert to authenticated
  with check (bucket_id = 'vitrine' and (storage.foldername(name))[1] in (select id::text from public.empresas where dono = auth.uid()));
drop policy if exists anuncia_vit_le on storage.objects;
create policy anuncia_vit_le on storage.objects for select to authenticated
  using (bucket_id = 'vitrine' and (storage.foldername(name))[1] in (select id::text from public.empresas where dono = auth.uid()));
drop policy if exists anuncia_vit_apaga on storage.objects;
create policy anuncia_vit_apaga on storage.objects for delete to authenticated
  using (bucket_id = 'vitrine' and ((storage.foldername(name))[1] in (select id::text from public.empresas where dono = auth.uid()) or public.eh_admin()));

notify pgrst, 'reload schema';
