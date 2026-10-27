-- =====================================================================
-- Anuncia Aí — sugestões dos clientes (rode uma vez no SQL Editor).
-- O cliente envia pela aba "💡 Sugestões" do app; você lê e responde no
-- painel do dono (aba "Sugestões"). O mesmo trecho está no schema.sql.
-- =====================================================================
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
