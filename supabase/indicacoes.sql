-- =====================================================================
-- 🎁 ANUNCIA AÍ — INDIQUE E GANHE (também no final do schema.sql)
--
-- Cada empresa tem um código. Quem se cadastra com ele fica ligado a quem
-- indicou. Quando o indicado faz o PRIMEIRO pagamento aprovado, a indicação
-- fica "liberada" com o valor da recompensa; o dono do Anuncia Aí paga
-- (Pix para a chave que a pessoa cadastrou) e marca como "paga".
-- Pode rodar de novo: nada é apagado.
-- =====================================================================

alter table public.empresas add column if not exists codigo_indicacao text;
alter table public.empresas add column if not exists indicado_por uuid references public.empresas (id) on delete set null;
alter table public.empresas add column if not exists pix_indicacao text;   -- chave Pix para receber as recompensas
create unique index if not exists empresas_codigo_idx on public.empresas (upper(codigo_indicacao)) where codigo_indicacao is not null;

create table if not exists public.indicacao_config (
  id      integer primary key default 1 check (id = 1),
  valor   numeric(10, 2) not null default 10 check (valor >= 0),   -- recompensa por indicação que pagou
  ativo   boolean not null default true,
  regras  text
);
insert into public.indicacao_config (id) values (1) on conflict (id) do nothing;

create table if not exists public.indicacoes (
  id            uuid primary key default gen_random_uuid(),
  indicador_id  uuid not null references public.empresas (id) on delete cascade,
  indicado_id   uuid not null unique references public.empresas (id) on delete cascade,   -- cada empresa só pode ter sido indicada uma vez
  codigo        text,
  status        text not null default 'aguardando' check (status in ('aguardando', 'liberada', 'paga', 'cancelada')),
  valor         numeric(10, 2),
  liberada_em   timestamptz,
  paga_em       timestamptz,
  obs           text,
  criado_em     timestamptz not null default now(),
  constraint indicacoes_nao_propria check (indicador_id <> indicado_id)
);
create index if not exists indicacoes_indicador_idx on public.indicacoes (indicador_id, status);

-- código de 6 letras/números, sem 0/O e 1/I/L (fácil de ditar)
create or replace function public.gerar_codigo_indicacao() returns text
language plpgsql volatile security definer set search_path = public as $$
declare v text; b bytea; k integer; L constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
begin
  loop
    b := uuid_send(gen_random_uuid()); v := '';
    for k in 0..5 loop v := v || substr(L, get_byte(b, k) % 31 + 1, 1); end loop;
    exit when not exists (select 1 from public.empresas where upper(codigo_indicacao) = v);
  end loop;
  return v;
end $$;

-- o código da minha empresa (cria na primeira vez)
create or replace function public.meu_codigo_indicacao() returns text
language plpgsql volatile security definer set search_path = public as $$
declare e public.empresas;
begin
  select * into e from public.empresas where dono = auth.uid() for update;
  if not found then raise exception 'Empresa não encontrada.'; end if;
  if e.codigo_indicacao is null then
    update public.empresas set codigo_indicacao = public.gerar_codigo_indicacao() where id = e.id returning * into e;
  end if;
  return e.codigo_indicacao;
end $$;

-- "fui indicado por": só uma vez, antes do primeiro pagamento, até 30 dias depois do cadastro e não pelo próprio código
create or replace function public.usar_indicacao(p_codigo text) returns text
language plpgsql volatile security definer set search_path = public as $$
declare e public.empresas; ind public.empresas; v_cod text := upper(trim(coalesce(p_codigo, '')));
begin
  select * into e from public.empresas where dono = auth.uid() for update;
  if not found then raise exception 'Cadastre a sua empresa primeiro.'; end if;
  if v_cod = '' then raise exception 'Digite o código de indicação.'; end if;
  if exists (select 1 from public.indicacoes where indicado_id = e.id) then raise exception 'Sua empresa já foi indicada por alguém.'; end if;
  select * into ind from public.empresas where upper(codigo_indicacao) = v_cod;
  if not found then raise exception 'Código de indicação não encontrado. Confira as letras.'; end if;
  if ind.id = e.id then raise exception 'Você não pode usar o seu próprio código.'; end if;
  if ind.dono = e.dono then raise exception 'Você não pode indicar a sua própria empresa.'; end if;
  if exists (select 1 from public.pagamentos where empresa_id = e.id and aplicado) then raise exception 'O código vale só para quem ainda não fez o primeiro pagamento.'; end if;
  if e.criado_em < now() - interval '30 days' then raise exception 'O código precisa ser usado em até 30 dias depois do cadastro.'; end if;
  insert into public.indicacoes (indicador_id, indicado_id, codigo) values (ind.id, e.id, v_cod);
  update public.empresas set indicado_por = ind.id where id = e.id;
  return ind.nome;
end $$;

create or replace function public.salvar_pix_indicacao(p_pix text) returns void
language sql volatile security definer set search_path = public as $$
  update public.empresas set pix_indicacao = left(nullif(trim(p_pix), ''), 120) where dono = auth.uid();
$$;

-- minhas indicações (sem mostrar dados privados de quem foi indicado: só o nome e a situação)
create or replace function public.minhas_indicacoes() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'codigo', (select codigo_indicacao from public.empresas where dono = auth.uid()),
    'pix', (select pix_indicacao from public.empresas where dono = auth.uid()),
    'fui_indicado', exists (select 1 from public.indicacoes i join public.empresas e on e.id = i.indicado_id where e.dono = auth.uid()),
    'valor', (select valor from public.indicacao_config where id = 1),
    'ativo', (select ativo from public.indicacao_config where id = 1),
    'regras', (select regras from public.indicacao_config where id = 1),
    'lista', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'nome', d.nome, 'status', i.status, 'valor', i.valor, 'criado_em', i.criado_em, 'liberada_em', i.liberada_em, 'paga_em', i.paga_em) order by i.criado_em desc)
      from public.indicacoes i join public.empresas me on me.id = i.indicador_id join public.empresas d on d.id = i.indicado_id where me.dono = auth.uid()), '[]'::jsonb));
$$;

-- primeiro pagamento aprovado do indicado: libera a recompensa de quem indicou
create or replace function public.tg_indicacao_pagamento() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.aplicado and new.status = 'approved' and (tg_op = 'INSERT' or not coalesce(old.aplicado, false)) then
    update public.indicacoes set status = 'liberada', liberada_em = now(),
      valor = coalesce(valor, (select case when ativo then valor else 0 end from public.indicacao_config where id = 1))
    where indicado_id = new.empresa_id and status = 'aguardando';
  elsif tg_op = 'UPDATE' and old.status = 'approved' and new.status in ('refunded', 'charged_back') and new.aplicado
        and not exists (select 1 from public.pagamentos p where p.empresa_id = new.empresa_id and p.id <> new.id and p.aplicado and p.status = 'approved') then
    -- o pagamento do indicado foi estornado: a recompensa ainda não paga é cancelada; se já foi paga, fica o aviso para o dono
    update public.indicacoes set status = case when status = 'paga' then status else 'cancelada' end,
      obs = left(coalesce(obs || ' · ', '') || 'pagamento do indicado ' || case when new.status = 'refunded' then 'estornado' else 'contestado' end || ' em ' || to_char(now(), 'DD/MM/YYYY'), 500)
    where indicado_id = new.empresa_id and status in ('liberada', 'paga');
  end if;
  return new;
end $$;
drop trigger if exists indicacao_pagamento on public.pagamentos;
create trigger indicacao_pagamento after insert or update of aplicado, status on public.pagamentos for each row execute function public.tg_indicacao_pagamento();

-- dono do Anuncia Aí: liberar, marcar como paga ou cancelar
create or replace function public.admin_indicacao(p_id uuid, p_status text, p_valor numeric default null, p_obs text default null) returns public.indicacoes
language plpgsql volatile security definer set search_path = public as $$
declare r public.indicacoes;
begin
  if not public.eh_admin() then raise exception 'Acesso negado.'; end if;
  if p_status not in ('aguardando', 'liberada', 'paga', 'cancelada') then raise exception 'Situação inválida.'; end if;
  update public.indicacoes set status = p_status,
    valor = coalesce(p_valor, valor, case when p_status in ('liberada', 'paga') then (select valor from public.indicacao_config where id = 1) end),
    liberada_em = case when p_status in ('liberada', 'paga') then coalesce(liberada_em, now()) else liberada_em end,
    paga_em = case when p_status = 'paga' then coalesce(paga_em, now()) else null end,
    obs = coalesce(p_obs, obs)
  where id = p_id returning * into r;
  if not found then raise exception 'Indicação não encontrada.'; end if;
  return r;
end $$;

alter table public.indicacoes enable row level security;
alter table public.indicacao_config enable row level security;
drop policy if exists ind_admin on public.indicacoes;
create policy ind_admin on public.indicacoes for select to authenticated using (public.eh_admin());
drop policy if exists indcfg_le on public.indicacao_config;
create policy indcfg_le on public.indicacao_config for select to authenticated using (true);
drop policy if exists indcfg_admin on public.indicacao_config;
create policy indcfg_admin on public.indicacao_config for update to authenticated using (public.eh_admin()) with check (public.eh_admin());
revoke all on public.indicacoes, public.indicacao_config from anon;
revoke insert, update, delete on public.indicacoes from authenticated;
grant select on public.indicacoes, public.indicacao_config to authenticated;
grant update on public.indicacao_config to authenticated;

revoke execute on function public.gerar_codigo_indicacao() from public, anon, authenticated;
revoke execute on function public.meu_codigo_indicacao(), public.usar_indicacao(text), public.salvar_pix_indicacao(text), public.minhas_indicacoes(),
  public.admin_indicacao(uuid, text, numeric, text) from public, anon;
grant execute on function public.meu_codigo_indicacao(), public.usar_indicacao(text), public.salvar_pix_indicacao(text), public.minhas_indicacoes(),
  public.admin_indicacao(uuid, text, numeric, text) to authenticated;

notify pgrst, 'reload schema';
