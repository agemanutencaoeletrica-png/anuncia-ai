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
drop policy if exists anuncia_logo_troca on storage.objects;
create policy anuncia_logo_troca on storage.objects for update to authenticated
  using (bucket_id = 'logos' and (storage.foldername(name))[1] in (select id::text from public.empresas where dono = auth.uid()));
drop policy if exists anuncia_logo_apaga on storage.objects;
create policy anuncia_logo_apaga on storage.objects for delete to authenticated
  using (bucket_id = 'logos' and ((storage.foldername(name))[1] in (select id::text from public.empresas where dono = auth.uid()) or public.eh_admin()));

-- ---------- Seu acesso de dono do Anuncia Aí ----------
-- Troque o e-mail, tire os dois traços do começo e rode só esta linha:
--
-- insert into public.admins (email) values ('seu-email@exemplo.com') on conflict do nothing;
