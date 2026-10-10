// Anuncia Aí — função "assinar" (Supabase Edge Function)
// Cria a cobrança no Mercado Pago:
//   * cartão: assinatura que cobra sozinha todo mês (ou a cada 12 meses no plano anual);
//   * Pix: gera o QR e o "copia e cola" pela API de Orders (vale 3 dias). Se já existe um Pix em aberto, devolve o mesmo.
// Quem chama: o app (empresa logada) ou a função "cobranca-diaria" (com o CRON_SECRET).
// Configuração em "Verify JWT": DESLIGADO (a própria função confere o login).

const env = (k: string) => (globalThis as any).Deno ? (globalThis as any).Deno.env.get(k) : (globalThis as any).process?.env?.[k];
// chave de servidor: a antiga (service_role) ou, se ela não existir, a nova (sb_secret_...)
function chaveServidor() {
  const antiga = env("SUPABASE_SERVICE_ROLE_KEY");
  if (antiga) return antiga;
  try { const k = JSON.parse(env("SUPABASE_SECRET_KEYS") || "{}"); return k.default || Object.values(k)[0] || ""; } catch { return ""; }
}
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function resposta(dados: unknown, status = 200) {
  return new Response(JSON.stringify(dados), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

async function db(caminho: string, op: any = {}) {
  const r = await fetch(env("SUPABASE_URL") + "/rest/v1/" + caminho, {
    method: op.method || "GET",
    headers: {
      apikey: chaveServidor(), Authorization: "Bearer " + chaveServidor(),
      "Content-Type": "application/json", Prefer: op.prefer || "return=representation",
    },
    body: op.body === undefined ? undefined : JSON.stringify(op.body),
  });
  const t = await r.text();
  if (!r.ok) throw new Error("Banco: " + r.status + " " + t);
  return t ? JSON.parse(t) : null;
}

async function mp(caminho: string, op: any = {}) {
  const r = await fetch("https://api.mercadopago.com" + caminho, {
    method: op.method || "GET",
    headers: {
      Authorization: "Bearer " + env("MP_ACCESS_TOKEN"), "Content-Type": "application/json",
      ...(op.idem ? { "X-Idempotency-Key": op.idem } : {}),
    },
    body: op.body === undefined ? undefined : JSON.stringify(op.body),
  });
  const t = await r.text();
  const j = t ? JSON.parse(t) : {};
  if (!r.ok) throw new Error("Mercado Pago: " + (j.message || (j.errors && j.errors[0] && (j.errors[0].message || j.errors[0].code)) || r.status));
  return j;
}

async function usuarioLogado(req: Request) {
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const r = await fetch(env("SUPABASE_URL") + "/auth/v1/user", { headers: { apikey: chaveServidor(), Authorization: auth } });
  if (!r.ok) return null;
  return await r.json();
}

export async function criarPix(empresa: any, plano: any) {
  const agora = Date.now();
  const abertos = await db("pagamentos?select=*&empresa_id=eq." + empresa.id + "&tipo=eq.pix&status=eq.pending&order=criado_em.desc&limit=1");
  const a = abertos && abertos[0];
  if (a && a.pix_copia && a.vence_em && new Date(a.vence_em).getTime() - agora > 6 * 3600 * 1000 && a.plano === plano.id) {
    return { copia: a.pix_copia, qr: a.pix_qr, link: a.pix_link, vence_em: a.vence_em, valor: Number(a.valor) };
  }
  const vence = new Date(agora + 3 * 24 * 3600 * 1000);
  const valor = Number(plano.preco).toFixed(2);
  // Pix pela API de Orders do Mercado Pago (a API de Payments será descontinuada).
  // O aviso de pagamento chega pelo webhook configurado no painel (evento "Order").
  const o = await mp("/v1/orders", {
    method: "POST", idem: crypto.randomUUID(),
    body: {
      type: "online", processing_mode: "automatic", total_amount: valor, external_reference: empresa.id,
      payer: { email: empresa.email },
      transactions: { payments: [{ amount: valor, payment_method: { id: "pix", type: "bank_transfer" }, expiration_time: "P3D" }] },
    },
  });
  const pg = (o.transactions && o.transactions.payments && o.transactions.payments[0]) || {};
  const pm = pg.payment_method || {};
  await db("pagamentos", {
    method: "POST", prefer: "return=minimal,resolution=ignore-duplicates",
    body: { empresa_id: empresa.id, mp_id: String(o.id), tipo: "pix", plano: plano.id, valor: Number(plano.preco), status: "pending",
      pix_copia: pm.qr_code || null, pix_qr: pm.qr_code_base64 || null, pix_link: pm.ticket_url || null, vence_em: vence.toISOString() },
  });
  return { copia: pm.qr_code, qr: pm.qr_code_base64, link: pm.ticket_url, vence_em: vence.toISOString(), valor: Number(plano.preco) };
}

export async function criarAssinaturaCartao(empresa: any, plano: any) {
  const a = await mp("/preapproval", {
    method: "POST", idem: crypto.randomUUID(),
    body: {
      reason: "Anuncia Aí — " + plano.nome, external_reference: empresa.id, payer_email: empresa.email,
      back_url: (env("APP_URL") || "") + "/app.html#assinatura", status: "pending",
      auto_recurring: { frequency: Number(plano.meses) || 1, frequency_type: "months", transaction_amount: Number(plano.preco), currency_id: "BRL" },
    },
  });
  await db("empresas?id=eq." + empresa.id, { method: "PATCH", prefer: "return=minimal", body: { mp_assinatura: String(a.id), plano: plano.id } });
  return { link: a.init_point };
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return resposta({ erro: "Use POST." }, 405);
  try {
    const corpo = await req.json().catch(() => ({}));
    let empresa;
    const auth = req.headers.get("Authorization") || "";
    if (env("CRON_SECRET") && auth === "Bearer " + env("CRON_SECRET") && corpo.empresa_id) {
      empresa = (await db("empresas?select=*&id=eq." + encodeURIComponent(corpo.empresa_id)))[0];
    } else {
      const u = await usuarioLogado(req);
      if (!u || !u.id) return resposta({ erro: "Entre de novo no app." }, 401);
      empresa = (await db("empresas?select=*&dono=eq." + u.id))[0];
    }
    if (!empresa) return resposta({ erro: "Empresa não encontrada." }, 404);
    const idPlano = corpo.plano || empresa.plano || "mensal";
    const plano = (await db("planos?select=*&ativo=eq.true&id=eq." + encodeURIComponent(idPlano)))[0];
    if (!plano) return resposta({ erro: "Plano não encontrado." }, 400);
    if (corpo.metodo === "cartao") return resposta(await criarAssinaturaCartao(empresa, plano));
    if (corpo.metodo === "pix") return resposta({ pix: await criarPix(empresa, plano) });
    return resposta({ erro: "Escolha cartão ou Pix." }, 400);
  } catch (e) {
    console.error(e);
    return resposta({ erro: String((e as Error).message || e) }, 500);
  }
}

if ((globalThis as any).Deno) (globalThis as any).Deno.serve(handler);
