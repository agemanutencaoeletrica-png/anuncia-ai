// Anuncia Aí — função "mp-webhook" (Supabase Edge Function)
// O Mercado Pago chama este endereço quando um pagamento muda (Pix pago — evento "order" —, cobrança do
// cartão aprovada, assinatura cancelada...). A função NÃO confia no que chega: busca o
// pagamento direto no Mercado Pago com o seu token e só então libera o acesso.
// Configuração em "Verify JWT": DESLIGADO (quem chama é o Mercado Pago).

const env = (k: string) => (globalThis as any).Deno ? (globalThis as any).Deno.env.get(k) : (globalThis as any).process?.env?.[k];
// chave de servidor: a antiga (service_role) ou, se ela não existir, a nova (sb_secret_...)
function chaveServidor() {
  const antiga = env("SUPABASE_SERVICE_ROLE_KEY");
  if (antiga) return antiga;
  try { const k = JSON.parse(env("SUPABASE_SECRET_KEYS") || "{}"); return k.default || Object.values(k)[0] || ""; } catch { return ""; }
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
async function mp(caminho: string) {
  const r = await fetch("https://api.mercadopago.com" + caminho, { headers: { Authorization: "Bearer " + env("MP_ACCESS_TOKEN") } });
  const t = await r.text();
  if (!r.ok) throw new Error("Mercado Pago " + caminho + ": " + r.status);
  return t ? JSON.parse(t) : {};
}

// assinatura do aviso (x-signature) — só confere se MP_WEBHOOK_SECRET estiver configurado
async function assinaturaOk(req: Request, dataId: string) {
  const segredo = env("MP_WEBHOOK_SECRET");
  if (!segredo) return true;
  const sig = req.headers.get("x-signature") || "", reqId = req.headers.get("x-request-id") || "";
  const partes: Record<string, string> = {};
  sig.split(",").forEach((p) => { const [k, v] = p.split("=").map((x) => (x || "").trim()); if (k) partes[k] = v; });
  if (!partes.ts || !partes.v1) return false;
  const chave = await crypto.subtle.importKey("raw", new TextEncoder().encode(segredo), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  // a documentação manda usar o id em minúsculas; há relatos de pedidos (ORD...) assinados como vieram — aceita os dois
  for (const id of new Set([dataId.toLowerCase(), dataId])) {
    const manifesto = "id:" + id + ";request-id:" + reqId + ";ts:" + partes.ts + ";";
    const mac = new Uint8Array(await crypto.subtle.sign("HMAC", chave, new TextEncoder().encode(manifesto)));
    const hex = Array.from(mac).map((b) => b.toString(16).padStart(2, "0")).join("");
    if (iguais(hex, partes.v1.toLowerCase())) return true;
  }
  return false;
}

// comparação em tempo constante (não revela quantos caracteres da assinatura batem)
function iguais(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// plano de uma cobrança do cartão: sai da assinatura no Mercado Pago (de quantos em quantos meses ela cobra),
// nunca do plano gravado no cadastro da empresa. Sem assinatura conhecida, conta como o plano mais curto.
// valorPago: quando a assinatura não veio no próprio pagamento, só vale a assinatura já autorizada e com o mesmo valor.
async function planoDaCobranca(preapprovalId: string | null, valorPago: number | null = null) {
  let meses = 0;
  if (preapprovalId) {
    const a = await mp("/preapproval/" + encodeURIComponent(preapprovalId));
    const ar = a.auto_recurring || {};
    const confere = valorPago === null || (a.status === "authorized" && Math.abs(Number(ar.transaction_amount) - valorPago) < 0.01);
    if (confere && ar.frequency_type === "months") meses = Number(ar.frequency) || 0;
  }
  const ps = meses ? await db("planos?select=id&meses=eq." + meses + "&order=ativo.desc&limit=1") : [];
  if (ps && ps[0]) return ps[0].id;
  const curto = await db("planos?select=id&order=meses.asc&limit=1");
  return curto && curto[0] ? curto[0].id : null;
}

async function empresaPor(ref: string | null, assinatura: string | null) {
  if (ref && /^[0-9a-f-]{36}$/i.test(ref)) {
    const e = (await db("empresas?select=*&id=eq." + ref))[0];
    if (e) return e;
  }
  if (assinatura) return (await db("empresas?select=*&mp_assinatura=eq." + encodeURIComponent(assinatura)))[0] || null;
  return null;
}

// grava (ou atualiza) o pagamento e, se aprovado, soma os meses na validade
async function registrarPagamento(p: any, empresa: any, tipo: string, plano: () => Promise<string | null>) {
  const mpId = String(p.id);
  const atual = (await db("pagamentos?select=*&mp_id=eq." + encodeURIComponent(mpId)))[0];
  if (atual) {
    await db("pagamentos?mp_id=eq." + encodeURIComponent(mpId), { method: "PATCH", prefer: "return=minimal",
      body: { status: p.status, pago_em: p.status === "approved" ? (p.date_approved || new Date().toISOString()) : null } });
  } else {
    await db("pagamentos", { method: "POST", prefer: "return=minimal,resolution=ignore-duplicates",
      body: { empresa_id: empresa.id, mp_id: mpId, tipo, plano: await plano(), valor: Number(p.transaction_amount) || null, status: p.status,
        pago_em: p.status === "approved" ? (p.date_approved || new Date().toISOString()) : null } });
  }
  if (p.status !== "approved") return { mpId, status: p.status, aplicado: false };
  await db("rpc/aplicar_pagamento", { method: "POST", body: { p_mp_id: mpId } });
  await db("empresas?id=eq." + empresa.id, { method: "PATCH", prefer: "return=minimal", body: { metodo: tipo === "pix" ? (empresa.metodo || "pix") : "cartao" } });
  return { mpId, status: p.status, aplicado: true };
}

// pedido (Order) do Pix -> mesmo formato de pagamento usado no resto da função
function pagamentoDoPedido(o: any) {
  const pago = o.status === "processed" && (!o.status_detail || o.status_detail === "accredited");
  const st = pago ? "approved" : o.status === "refunded" ? "refunded" : (o.status === "canceled" || o.status === "expired" || o.status === "failed") ? "cancelled" : "pending";
  return { id: o.id, status: st, transaction_amount: o.total_paid_amount || o.total_amount, date_approved: pago ? (o.last_updated_date || null) : null };
}

export async function processar(tipo: string, id: string) {
  if (tipo === "order") {
    const o = await mp("/v1/orders/" + encodeURIComponent(id));
    const empresa = await empresaPor(o.external_reference || null, null);
    if (!empresa) return { ignorado: "empresa não encontrada", id };
    // o Pix é gravado pela função "assinar" com o plano e o valor cobrados; se não estiver lá, conta como o plano mais curto
    return await registrarPagamento(pagamentoDoPedido(o), empresa, "pix", () => planoDaCobranca(null));
  }
  if (tipo === "payment") {
    const p = await mp("/v1/payments/" + encodeURIComponent(id));
    // o Pix é criado como pedido (Order) e já é contado pelo aviso "order"; o pagamento interno
    // desse pedido também chega aqui como "payment" — contar de novo somaria o mês duas vezes
    if (p.payment_method_id === "pix" || (p.order && p.order.id)) return { ignorado: "pagamento de pedido (contado pelo aviso order)", id };
    const assin = (p.metadata && (p.metadata.preapproval_id || p.metadata.subscription_id)) || (p.point_of_interaction && p.point_of_interaction.transaction_data && p.point_of_interaction.transaction_data.subscription_id) || null;
    const empresa = await empresaPor(p.external_reference || null, assin);
    if (!empresa) return { ignorado: "empresa não encontrada", id };
    return await registrarPagamento(p, empresa, p.payment_method_id === "pix" ? "pix" : "cartao",
      () => assin ? planoDaCobranca(String(assin)) : planoDaCobranca(empresa.mp_assinatura || null, Number(p.transaction_amount) || 0));
  }
  if (tipo === "subscription_authorized_payment") {
    const ap = await mp("/authorized_payments/" + encodeURIComponent(id));
    const empresa = await empresaPor(ap.external_reference || null, ap.preapproval_id || null);
    if (!empresa) return { ignorado: "empresa não encontrada", id };
    const pid = ap.payment && ap.payment.id;
    if (!pid) return { ignorado: "cobrança sem pagamento ainda", id };
    const p = await mp("/v1/payments/" + encodeURIComponent(String(pid)));
    return await registrarPagamento(p, empresa, "cartao", () => planoDaCobranca(ap.preapproval_id ? String(ap.preapproval_id) : null));
  }
  if (tipo === "subscription_preapproval") {
    const a = await mp("/preapproval/" + encodeURIComponent(id));
    const empresa = await empresaPor(a.external_reference || null, String(a.id));
    if (!empresa) return { ignorado: "empresa não encontrada", id };
    if (a.status === "authorized") {
      await db("empresas?id=eq." + empresa.id, { method: "PATCH", prefer: "return=minimal", body: { metodo: "cartao", mp_assinatura: String(a.id) } });
    } else if (a.status === "cancelled" || a.status === "paused") {
      // cartão cancelado: continua valendo até o vencimento; daí em diante a cobrança é por Pix
      await db("empresas?id=eq." + empresa.id + "&mp_assinatura=eq." + encodeURIComponent(String(a.id)), { method: "PATCH", prefer: "return=minimal", body: { metodo: "pix", mp_assinatura: null } });
    }
    return { assinatura: a.status };
  }
  return { ignorado: "tipo " + tipo };
}

export async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const corpo = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const tipo = corpo.type || url.searchParams.get("type") || url.searchParams.get("topic") || "";
  const id = String((corpo.data && corpo.data.id) || url.searchParams.get("data.id") || url.searchParams.get("id") || "");
  if (!tipo || !id) return new Response("ok", { status: 200 });
  if (!(await assinaturaOk(req, id))) return new Response("assinatura inválida", { status: 401 });
  try {
    const r = await processar(tipo, id);
    console.log("mp-webhook", tipo, id, JSON.stringify(r));
    return new Response(JSON.stringify(r), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error("mp-webhook erro", tipo, id, e);
    // 500 faz o Mercado Pago tentar de novo mais tarde
    return new Response("erro", { status: 500 });
  }
}

if ((globalThis as any).Deno) (globalThis as any).Deno.serve(handler);
