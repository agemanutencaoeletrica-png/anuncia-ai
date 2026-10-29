-- =====================================================================
-- ANUNCIA AÍ — banco de dados (Supabase)
--
-- Como usar: no Supabase abra "SQL Editor" > "+" (nova consulta), cole
-- este arquivo inteiro e clique em "Run". Pode rodar de novo quando o app
-- for atualizado: nada é apagado.
--
-- Segurança:
--   * Cada empresa só vê e altera os PRÓPRIOS dados (regras RLS).
--   * Validade da assinatura, situação e pagamentos só mudam pelo servidor
--     (funções do Mercado Pago) ou pelo dono do Anuncia Aí (tabela admins).
--     A empresa não consegue se "liberar" sozinha.
-- =====================================================================

-- ---------- Tabelas ----------

create table if not exists public.admins (
  email text primary key
);

create table if not exists public.planos (
  id        text primary key,
  nome      text not null,
  preco     numeric(10, 2) not null check (preco > 0),
  meses     integer not null default 1 check (meses between 1 and 12),
  ativo     boolean not null default true,
  ordem     integer not null default 0
);

create table if not exists public.empresas (
  id                uuid primary key default gen_random_uuid(),
  dono              uuid not null unique,                 -- auth.users.id
  email             text not null,
  nome              text not null,
  ramo              text,
  cidade            text,
  whatsapp          text,
  instagram         text,
  site              text,
  cor1              text not null default '#7c3aed',
  cor2              text not null default '#f59e0b',
  logo              text,                                  -- caminho no Storage (bucket "logos")
  plano             text references public.planos (id),
  metodo            text check (metodo in ('cartao', 'pix')),
  status            text not null default 'teste'
                    check (status in ('teste', 'ativa', 'bloqueada', 'cancelada')),
  valido_ate        timestamptz not null default now() + interval '7 days',
  mp_assinatura     text,                                  -- id da assinatura (cartão) no Mercado Pago
  aceita_whatsapp   boolean not null default true,         -- receber avisos de cobrança no WhatsApp
  observacao        text,                                  -- anotação do dono do Anuncia Aí
  criado_em         timestamptz not null default now()
);

create table if not exists public.pagamentos (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references public.empresas (id) on delete cascade,
  mp_id       text not null unique,                        -- id do pagamento no Mercado Pago
  tipo        text not null check (tipo in ('pix', 'cartao', 'manual')),
  plano       text,
  valor       numeric(10, 2),
  status      text not null,                               -- approved, pending, rejected, ...
  pix_copia   text,                                        -- "copia e cola" do Pix (enquanto pendente)
  pix_qr      text,                                        -- QR do Pix (base64)
  pix_link    text,
  vence_em    timestamptz,                                 -- validade do Pix gerado
  aplicado    boolean not null default false,              -- já somou dias na validade
  criado_em   timestamptz not null default now(),
  pago_em     timestamptz
);

create table if not exists public.avisos (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references public.empresas (id) on delete cascade,
  tipo        text not null,                               -- d5, d3, d1, bloqueio, liberado
  canal       text not null,                               -- email, whatsapp, app
  referencia  date not null,                               -- data de vencimento a que o aviso se refere
  ok          boolean not null default true,
  erro        text,
  enviado_em  timestamptz not null default now(),
  unique (empresa_id, tipo, canal, referencia)             -- nunca manda o mesmo aviso duas vezes
);

create index if not exists empresas_valido_idx on public.empresas (valido_ate);
create index if not exists pagamentos_emp_idx on public.pagamentos (empresa_id, criado_em);
create index if not exists avisos_emp_idx on public.avisos (empresa_id, enviado_em);

insert into public.planos (id, nome, preco, meses, ordem) values
  ('mensal', 'Mensal', 29.90, 1, 1),
  ('anual', 'Anual (12 meses)', 299.00, 12, 2)
on conflict (id) do nothing;

-- ---------- Funções ----------

create or replace function public.eh_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.admins a
    where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- empresa pode usar o app? (teste ou ativa, dentro da validade; no cartão, 3 dias de
-- tolerância depois do vencimento enquanto o Mercado Pago tenta cobrar)
create or replace function public.acesso_liberado(e public.empresas) returns boolean
language sql stable as $$
  select e.status in ('teste', 'ativa')
     and (e.valido_ate > now()
          or (e.status = 'ativa' and e.metodo = 'cartao' and e.mp_assinatura is not null and e.valido_ate + interval '3 days' > now()));
$$;

-- primeiro acesso: cria a empresa do usuário logado com 7 dias de teste
create or replace function public.criar_empresa(p_nome text, p_ramo text default null, p_cidade text default null,
                                                p_whatsapp text default null, p_instagram text default null)
returns public.empresas
language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_email text := coalesce(auth.jwt() ->> 'email', '');
  e public.empresas;
begin
  if v_uid is null then raise exception 'Entre com seu e-mail e senha.'; end if;
  if coalesce(trim(p_nome), '') = '' then raise exception 'Informe o nome da empresa.'; end if;
  select * into e from public.empresas where dono = v_uid;
  if found then return e; end if;
  insert into public.empresas (dono, email, nome, ramo, cidade, whatsapp, instagram, plano)
  values (v_uid, lower(v_email), left(trim(p_nome), 120), left(p_ramo, 60), left(p_cidade, 80),
          left(p_whatsapp, 30), left(p_instagram, 60), 'mensal')
  returning * into e;
  return e;
end $$;

-- a empresa só altera os dados de perfil (nunca validade, situação ou pagamento)
create or replace function public.salvar_perfil(p jsonb) returns public.empresas
language plpgsql volatile security definer set search_path = public as $$
declare e public.empresas;
begin
  update public.empresas set
    nome      = coalesce(nullif(left(trim(p ->> 'nome'), 120), ''), nome),
    ramo      = left(p ->> 'ramo', 60),
    cidade    = left(p ->> 'cidade', 80),
    whatsapp  = left(p ->> 'whatsapp', 30),
    instagram = left(p ->> 'instagram', 60),
    site      = left(p ->> 'site', 120),
    cor1      = coalesce(substring(p ->> 'cor1' from '^#[0-9a-fA-F]{6}$'), cor1),
    cor2      = coalesce(substring(p ->> 'cor2' from '^#[0-9a-fA-F]{6}$'), cor2),
    logo      = case when p ? 'logo' then nullif(p ->> 'logo', '') else logo end,
    plano     = case when p ->> 'plano' in (select id from public.planos where ativo) then p ->> 'plano' else plano end,
    aceita_whatsapp = coalesce((p ->> 'aceita_whatsapp')::boolean, aceita_whatsapp)
  where dono = auth.uid()
  returning * into e;
  if not found then raise exception 'Empresa não encontrada.'; end if;
  if e.logo is not null and split_part(e.logo, '/', 1) <> e.id::text then
    raise exception 'Logo inválido.';
  end if;
  return e;
end $$;

-- soma meses na validade a partir de hoje ou do vencimento (o que for maior).
-- Usada pelo servidor quando o Mercado Pago confirma o pagamento.
create or replace function public.aplicar_pagamento(p_mp_id text) returns public.empresas
language plpgsql volatile security definer set search_path = public as $$
declare
  pg public.pagamentos;
  e  public.empresas;
  v_meses integer;
begin
  select * into pg from public.pagamentos where mp_id = p_mp_id for update;
  if not found then raise exception 'Pagamento % não encontrado.', p_mp_id; end if;
  select * into e from public.empresas where id = pg.empresa_id for update;
  if pg.aplicado or pg.status <> 'approved' then return e; end if;
  select meses into v_meses from public.planos where id = coalesce(pg.plano, e.plano);
  update public.empresas set
    status = 'ativa',
    plano = coalesce(pg.plano, plano),
    valido_ate = greatest(now(), valido_ate) + make_interval(months => coalesce(v_meses, 1))
  where id = e.id returning * into e;
  update public.pagamentos set aplicado = true, pago_em = coalesce(pago_em, now()), pix_qr = null, pix_copia = null where id = pg.id;
  return e;
end $$;

-- ---------- Regras de acesso (RLS) ----------

alter table public.admins enable row level security;
alter table public.planos enable row level security;
alter table public.empresas enable row level security;
alter table public.pagamentos enable row level security;
alter table public.avisos enable row level security;

drop policy if exists admin_le on public.admins;
create policy admin_le on public.admins for select to authenticated using (public.eh_admin());

drop policy if exists planos_le on public.planos;
create policy planos_le on public.planos for select to anon, authenticated using (ativo or public.eh_admin());
drop policy if exists planos_admin on public.planos;
create policy planos_admin on public.planos for all to authenticated using (public.eh_admin()) with check (public.eh_admin());

drop policy if exists empresa_le on public.empresas;
create policy empresa_le on public.empresas for select to authenticated using (dono = auth.uid() or public.eh_admin());
drop policy if exists empresa_admin on public.empresas;
create policy empresa_admin on public.empresas for all to authenticated using (public.eh_admin()) with check (public.eh_admin());

drop policy if exists pag_le on public.pagamentos;
create policy pag_le on public.pagamentos for select to authenticated
  using (public.eh_admin() or empresa_id in (select id from public.empresas where dono = auth.uid()));
drop policy if exists pag_admin on public.pagamentos;
create policy pag_admin on public.pagamentos for all to authenticated using (public.eh_admin()) with check (public.eh_admin());

drop policy if exists avisos_le on public.avisos;
create policy avisos_le on public.avisos for select to authenticated
  using (public.eh_admin() or empresa_id in (select id from public.empresas where dono = auth.uid()));
drop policy if exists avisos_admin on public.avisos;
create policy avisos_admin on public.avisos for all to authenticated using (public.eh_admin()) with check (public.eh_admin());

revoke execute on function public.aplicar_pagamento(text) from public, anon, authenticated;
grant execute on function public.eh_admin() to anon, authenticated;
grant execute on function public.criar_empresa(text, text, text, text, text) to authenticated;
grant execute on function public.salvar_perfil(jsonb) to authenticated;

-- ---------- Logos (Storage) ----------
-- Pasta pública "logos" (o logo aparece nas artes). Cada empresa só envia
-- e troca arquivos dentro da própria pasta (id da empresa).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('logos', 'logos', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 2097152, allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp'];

drop policy if exists anuncia_logo_envia on storage.objects;
create policy anuncia_logo_envia on storage.objects for insert to authenticated
  with check (bucket_id = 'logos' and (storage.foldername(name))[1] in (select id::text from public.empresas where dono = auth.uid()));
drop policy if exists anuncia_logo_le on storage.objects;
create policy anuncia_logo_le on storage.objects for select to authenticated
  using (bucket_id = 'logos' and (storage.foldername(name))[1] in (select id::text from public.empresas where dono = auth.uid()));
drop policy if exists anuncia_logo_troca on storage.objects;
create policy anuncia_logo_troca on storage.objects for update to authenticated
  using (bucket_id = 'logos' and (storage.foldername(name))[1] in (select id::text from public.empresas where dono = auth.uid()));
drop policy if exists anuncia_logo_apaga on storage.objects;
create policy anuncia_logo_apaga on storage.objects for delete to authenticated
  using (bucket_id = 'logos' and ((storage.foldername(name))[1] in (select id::text from public.empresas where dono = auth.uid()) or public.eh_admin()));

-- ---------- Sugestões dos clientes (também em supabase/sugestoes.sql) ----------
create table if not exists public.sugestoes (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references public.empresas (id) on delete cascade,
  tipo        text not null default 'sugestao' check (tipo in ('sugestao', 'problema', 'elogio')),
  texto       text not null check (char_length(texto) between 3 and 1000),
  lida        boolean not null default false,
  resposta    text,
  criado_em   timestamptz not null default now()
);
create index if not exists sugestoes_data_idx on public.sugestoes (criado_em desc);

-- o cliente só envia pela função: grava na empresa dele e no máximo 10 por dia
create or replace function public.enviar_sugestao(p_tipo text, p_texto text) returns public.sugestoes
language plpgsql volatile security definer set search_path = public as $$
declare
  v_emp uuid;
  s public.sugestoes;
begin
  select id into v_emp from public.empresas where dono = auth.uid();
  if v_emp is null then raise exception 'Cadastre a sua empresa antes de enviar.'; end if;
  if char_length(trim(coalesce(p_texto, ''))) < 3 then raise exception 'Escreva a sua sugestão.'; end if;
  if (select count(*) from public.sugestoes where empresa_id = v_emp and criado_em > now() - interval '1 day') >= 10 then
    raise exception 'Você já enviou 10 mensagens hoje. Tente amanhã.';
  end if;
  insert into public.sugestoes (empresa_id, tipo, texto)
  values (v_emp, case when p_tipo in ('sugestao', 'problema', 'elogio') then p_tipo else 'sugestao' end, left(trim(p_texto), 1000))
  returning * into s;
  return s;
end $$;

alter table public.sugestoes enable row level security;
drop policy if exists sug_le on public.sugestoes;
create policy sug_le on public.sugestoes for select to authenticated
  using (public.eh_admin() or empresa_id in (select id from public.empresas where dono = auth.uid()));
drop policy if exists sug_admin on public.sugestoes;
create policy sug_admin on public.sugestoes for all to authenticated using (public.eh_admin()) with check (public.eh_admin());

revoke execute on function public.enviar_sugestao(text, text) from public, anon;
grant execute on function public.enviar_sugestao(text, text) to authenticated;

-- ---------- Publicar no Telegram (também em supabase/telegram.sql) ----------
create table if not exists public.telegram (
  empresa_id     uuid primary key references public.empresas (id) on delete cascade,
  canal          text not null,                 -- @canal ou -100... (id do canal/grupo)
  token          text not null,                 -- código do robô; nunca volta para o app
  atualizado_em  timestamptz not null default now()
);
alter table public.telegram enable row level security;
-- sem regras de acesso: nem a empresa nem o anon leem ou alteram direto
revoke all on public.telegram from anon, authenticated;

-- salva o canal e o código do robô da empresa do login (código vazio = mantém o já salvo)
create or replace function public.salvar_telegram(p_canal text, p_token text default null) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_emp uuid;
  v_canal text := trim(coalesce(p_canal, ''));
  v_token text := trim(coalesce(p_token, ''));
begin
  select id into v_emp from public.empresas where dono = auth.uid();
  if v_emp is null then raise exception 'Cadastre a sua empresa primeiro.'; end if;
  v_canal := regexp_replace(v_canal, '^(https?://)?(www\.)?(t|telegram)\.me/', '');
  if v_canal !~ '^-' and v_canal !~ '^@' then v_canal := '@' || v_canal; end if;
  if v_canal !~ '^(@[A-Za-z0-9_]{4,32}|-100[0-9]{5,20})$' then
    raise exception 'Canal inválido. Use o @ do canal (ex.: @minhaempresa) ou o link t.me/minhaempresa.';
  end if;
  if v_token = '' then
    if not exists (select 1 from public.telegram where empresa_id = v_emp) then raise exception 'Cole o código do robô (do @BotFather).'; end if;
    update public.telegram set canal = v_canal, atualizado_em = now() where empresa_id = v_emp;
  else
    if v_token !~ '^[0-9]{5,15}:[A-Za-z0-9_-]{30,60}$' then raise exception 'Código do robô inválido. Copie de novo a linha que o @BotFather mandou (números:letras).'; end if;
    insert into public.telegram (empresa_id, canal, token) values (v_emp, v_canal, v_token)
    on conflict (empresa_id) do update set canal = excluded.canal, token = excluded.token, atualizado_em = now();
  end if;
  return jsonb_build_object('canal', v_canal, 'configurado', true);
end $$;

-- o app só fica sabendo se há robô configurado e qual é o canal (nunca o código)
create or replace function public.telegram_status() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select jsonb_build_object('canal', t.canal, 'configurado', true)
                     from public.telegram t join public.empresas e on e.id = t.empresa_id
                    where e.dono = auth.uid()), jsonb_build_object('configurado', false));
$$;

create or replace function public.remover_telegram() returns void
language sql volatile security definer set search_path = public as $$
  delete from public.telegram where empresa_id in (select id from public.empresas where dono = auth.uid());
$$;

revoke execute on function public.salvar_telegram(text, text) from public, anon;
revoke execute on function public.telegram_status() from public, anon;
revoke execute on function public.remover_telegram() from public, anon;
grant execute on function public.salvar_telegram(text, text) to authenticated;
grant execute on function public.telegram_status() to authenticated;
grant execute on function public.remover_telegram() to authenticated;

-- ---------- Seu acesso de dono do Anuncia Aí ----------
-- Troque o e-mail, tire os dois traços do começo e rode só esta linha:
--
-- insert into public.admins (email) values ('seu-email@exemplo.com') on conflict do nothing;

-- ---------- 🤝 Comunidade: vitrine, guia e rede (também em supabase/comunidade.sql) ----------
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

