-- =====================================================================
-- Anuncia Aí — publicar no Telegram (rode uma vez no SQL Editor).
-- Cada empresa usa o PRÓPRIO robô (criado no @BotFather) e o canal dela.
-- O código do robô fica nesta tabela, que o app NÃO consegue ler: só a
-- função "telegram" do servidor (chave de servidor) usa para publicar.
-- O mesmo trecho está no schema.sql.
-- =====================================================================
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
