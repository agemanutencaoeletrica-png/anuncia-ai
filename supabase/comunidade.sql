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
-- 📍 localização no mapa (opcional): quem atende em casa ou no cliente mostra só a região (~1 km), nunca o ponto exato
alter table public.empresas add column if not exists lat         double precision;
alter table public.empresas add column if not exists lng         double precision;
alter table public.empresas add column if not exists endereco    text;
alter table public.empresas add column if not exists local_exato boolean not null default false;
alter table public.empresas add column if not exists raio_km     integer;
alter table public.empresas add column if not exists maps_url    text;      -- link do Perfil da Empresa no Google (avaliações)
alter table public.empresas add column if not exists redes       jsonb not null default '{}'::jsonb;   -- 🔗 outras redes: {facebook, tiktok, youtube, ...}

-- só as redes conhecidas, com link https:// ou @usuário (nada de javascript: ou texto solto)
create or replace function public.limpar_redes(j jsonb) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_object_agg(k, left(trim(v), 200)), '{}'::jsonb)
  from jsonb_each_text(case when jsonb_typeof(j) = 'object' then j else '{}'::jsonb end) as t(k, v)
  where k in ('facebook', 'tiktok', 'youtube', 'telegram', 'kwai', 'threads', 'linkedin', 'x', 'pinterest')
    and (trim(v) ~* '^https://[^\s]+$' or trim(v) ~ '^@?[A-Za-z0-9._-]{2,60}$');
$$;

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
-- ponto que o público vê: o exato (loja/escritório) ou arredondado (~1 km) para quem não quer mostrar onde fica
create or replace function public.lat_publica(e public.empresas) returns double precision
language sql immutable as $$ select case when e.lat is null then null when e.local_exato then e.lat else round(e.lat::numeric, 2)::double precision end; $$;
create or replace function public.lng_publica(e public.empresas) returns double precision
language sql immutable as $$ select case when e.lng is null then null when e.local_exato then e.lng else round(e.lng::numeric, 2)::double precision end; $$;
-- distância em km (fórmula de haversine)
create or replace function public.distancia_km(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision) returns double precision
language sql immutable as $$
  select 6371 * 2 * asin(sqrt(power(sin(radians(lat2 - lat1) / 2), 2) + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)));
$$;

create or replace function public.cartao_publico(e public.empresas) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('nome', e.nome, 'slug', e.slug, 'ramo', e.ramo, 'cidade', e.cidade, 'bairro', e.bairro,
    'descricao', e.descricao, 'whatsapp', e.whatsapp, 'instagram', e.instagram, 'site', e.site,
    'cor1', e.cor1, 'cor2', e.cor2, 'logo', e.logo,
    'lat', public.lat_publica(e), 'lng', public.lng_publica(e), 'exato', e.local_exato and e.lat is not null,
    'endereco', case when e.local_exato then e.endereco end, 'raio_km', e.raio_km, 'maps_url', e.maps_url, 'redes', coalesce(e.redes, '{}'::jsonb),
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
    descricao = nullif(left(trim(coalesce(p ->> 'descricao', '')), 500), ''),
    -- localização: só muda se vier no pedido; ponto fora do mapa é ignorado
    lat         = case when not (p ? 'lat') then lat when (p ->> 'lat') ~ '^-?[0-9]+(\.[0-9]+)?$' and abs((p ->> 'lat')::double precision) <= 90 then (p ->> 'lat')::double precision else null end,
    lng         = case when not (p ? 'lng') then lng when (p ->> 'lng') ~ '^-?[0-9]+(\.[0-9]+)?$' and abs((p ->> 'lng')::double precision) <= 180 then (p ->> 'lng')::double precision else null end,
    endereco    = case when p ? 'endereco' then nullif(left(trim(coalesce(p ->> 'endereco', '')), 200), '') else endereco end,
    local_exato = coalesce((p ->> 'local_exato')::boolean, local_exato),
    raio_km     = case when not (p ? 'raio_km') then raio_km when (p ->> 'raio_km') ~ '^[0-9]{1,3}$' and (p ->> 'raio_km')::int between 1 and 300 then (p ->> 'raio_km')::int else null end,
    maps_url    = case when not (p ? 'maps_url') then maps_url when (p ->> 'maps_url') ~* '^https://' then left(trim(p ->> 'maps_url'), 300) else null end,
    redes       = case when p ? 'redes' then public.limpar_redes(p -> 'redes') else redes end
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

-- 📍 perto de mim: vitrines com localização até p_km do ponto, da mais perto para a mais longe
-- (a distância usa o ponto público, então não revela o endereço de quem mostra só a região)
create or replace function public.guia_perto(p_lat double precision, p_lng double precision, p_km double precision default 30,
                                             p_ramo text default null, p_busca text default null) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(c || jsonb_build_object('distancia_km', round(d::numeric, 1)) order by d), '[]'::jsonb) from (select * from (
    select public.cartao_publico(e) as c, public.distancia_km(p_lat, p_lng, public.lat_publica(e), public.lng_publica(e)) as d
    from public.empresas e
    where public.na_vitrine(e) and e.lat is not null and e.lng is not null
      and (coalesce(p_ramo, '') = '' or lower(trim(e.ramo)) = lower(trim(p_ramo)))
      and (coalesce(p_busca, '') = '' or lower(concat_ws(' ', e.nome, e.ramo, e.bairro, e.descricao)) like '%' || lower(trim(p_busca)) || '%')
  ) t0 where d <= least(greatest(coalesce(p_km, 30), 1), 300) order by d limit 200) t
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
grant execute on function public.guia_perto(double precision, double precision, double precision, text, text) to anon, authenticated;

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

-- ---------- ✨ Outros projetos: a empresa pede para ser avisada quando um app novo lançar ----------
create table if not exists public.interesses (
  empresa_id  uuid not null references public.empresas (id) on delete cascade,
  projeto     text not null check (projeto ~ '^[a-z0-9-]{2,40}$'),
  criado_em   timestamptz not null default now(),
  primary key (empresa_id, projeto)
);
create or replace function public.quero_ser_avisado(p_projeto text, p_sim boolean default true) returns void
language plpgsql volatile security definer set search_path = public as $$
declare v_emp uuid;
begin
  select id into v_emp from public.empresas where dono = auth.uid();
  if v_emp is null then raise exception 'Empresa não encontrada.'; end if;
  if coalesce(p_projeto, '') !~ '^[a-z0-9-]{2,40}$' then raise exception 'Projeto inválido.'; end if;
  if p_sim then insert into public.interesses (empresa_id, projeto) values (v_emp, p_projeto) on conflict do nothing;
  else delete from public.interesses where empresa_id = v_emp and projeto = p_projeto; end if;
end $$;
alter table public.interesses enable row level security;
drop policy if exists int_le on public.interesses;
create policy int_le on public.interesses for select to authenticated
  using (public.eh_admin() or empresa_id in (select id from public.empresas where dono = auth.uid()));
drop policy if exists int_admin on public.interesses;
create policy int_admin on public.interesses for all to authenticated using (public.eh_admin()) with check (public.eh_admin());
revoke execute on function public.quero_ser_avisado(text, boolean) from public, anon;
grant execute on function public.quero_ser_avisado(text, boolean) to authenticated;

notify pgrst, 'reload schema';
