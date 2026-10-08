-- =====================================================================
-- ANUNCIA AÍ — agenda a cobrança diária (rode DEPOIS de criar as funções)
--
-- Antes de rodar, troque:
--   SEU-PROJETO   -> o código do seu projeto (está no endereço do Supabase,
--                    ex.: https://abcdxyz.supabase.co  =>  abcdxyz)
--   SEU-SEGREDO   -> o mesmo valor do CRON_SECRET que você colocou nos segredos
--                    das funções (Edge Functions > Secrets)
--
-- Roda todo dia às 9h (horário de Brasília = 12h UTC).
-- =====================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('anuncia-cobranca-diaria')
where exists (select 1 from cron.job where jobname = 'anuncia-cobranca-diaria');

select cron.schedule(
  'anuncia-cobranca-diaria',
  '0 12 * * *',
  $$
  select net.http_post(
    url     := 'https://SEU-PROJETO.supabase.co/functions/v1/cobranca-diaria',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer SEU-SEGREDO'),
    body    := '{}'::jsonb
  );
  $$
);

-- Para conferir se ficou agendado:
-- select jobname, schedule, active from cron.job;
-- Para ver as últimas execuções:
-- select status, return_message, start_time from cron.job_run_details order by start_time desc limit 5;
