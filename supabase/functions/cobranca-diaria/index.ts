// Anuncia Aí — função "cobranca-diaria" (Supabase Edge Function)
// Roda 1 vez por dia (agendada no banco, ver supabase/agendar.sql):
//   * 5, 3 e 1 dia antes do vencimento: avisa por e-mail e WhatsApp (com o Pix pronto);
//   * no vencimento sem pagamento: BLOQUEIA o acesso e avisa;
//   * cartão: só avisa na véspera (a cobrança é automática) e se o cartão falhar.
// Cada aviso é mandado uma vez só (tabela "avisos").
// Configuração em "Verify JWT": DESLIGADO (protegida pelo CRON_SECRET).

const env = (k: string) => (globalThis as any).Deno ? (globalThis as any).Deno.env.get(k) : (globalThis as any).process?.env?.[k];
const DIA = 24 * 3600 * 1000;
// cartão: o Mercado Pago cobra no dia do vencimento e tenta de novo se falhar; espera 3 dias antes de bloquear
export const CARENCIA_CARTAO_DIAS = 3;
export function cartaoAtivo(e: any) { return e.metodo === "cartao" && !!e.mp_assinatura && e.status === "ativa"; }

async function db(caminho: string, op: any = {}) {
  const r = await fetch(env("SUPABASE_URL") + "/rest/v1/" + caminho, {
    method: op.method || "GET",
    headers: {
      apikey: env("SUPABASE_SERVICE_ROLE_KEY"), Authorization: "Bearer " + env("SUPABASE_SERVICE_ROLE_KEY"),
      "Content-Type": "application/json", Prefer: op.prefer || "return=representation",
    },
    body: op.body === undefined ? undefined : JSON.stringify(op.body),
  });
  const t = await r.text();
  if (!r.ok) throw new Error("Banco: " + r.status + " " + t);
  return t ? JSON.parse(t) : null;
}

// data (AAAA-MM-DD) no horário de Brasília
export function dataBR(d: Date) {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  return p;
}
export function diasAte(validoAte: string, agora: Date) {
  return Math.round((Date.parse(dataBR(new Date(validoAte)) + "T00:00:00Z") - Date.parse(dataBR(agora) + "T00:00:00Z")) / DIA);
}
function dataVisivel(iso: string) { const [a, m, d] = dataBR(new Date(iso)).split("-"); return d + "/" + m + "/" + a; }

// o que fazer com a empresa hoje
export function decidir(e: any, agora: Date) {
  if (e.status === "cancelada") return null;
  const cartao = cartaoAtivo(e), limite = new Date(e.valido_ate).getTime() + (cartao ? CARENCIA_CARTAO_DIAS * DIA : 0);
  const vencido = limite <= agora.getTime();
  if (vencido && e.status !== "bloqueada") return { acao: "bloquear", tipo: "bloqueio" };
  if (vencido) return null;
  // cartão já venceu e está na tolerância: avisa que a cobrança não passou (pode pagar por Pix)
  if (cartao && new Date(e.valido_ate).getTime() + DIA <= agora.getTime()) return { acao: "avisar", tipo: "cartao_falhou", dias: 0 };
  if (cartao && new Date(e.valido_ate).getTime() <= agora.getTime()) return null;   // dia da cobrança: espera o Mercado Pago
  const dias = diasAte(e.valido_ate, agora);
  if (dias <= 1) return { acao: "avisar", tipo: "d1", dias };
  if (cartao) return null;                       // cartão renova sozinho: só lembra na véspera
  if (dias <= 3) return { acao: "avisar", tipo: "d3", dias };
  if (dias <= 5) return { acao: "avisar", tipo: "d5", dias };
  return null;
}

export function mensagem(e: any, d: any, pix: any) {
  const app = (env("APP_URL") || "") + "/app.html#assinatura", data = dataVisivel(e.valido_ate);
  const teste = e.status === "teste", cartao = e.metodo === "cartao" && !!e.mp_assinatura;
  let assunto: string, texto: string;
  if (d.tipo === "cartao_falhou") {
    assunto = "Não conseguimos cobrar no seu cartão — Anuncia Aí";
    texto = "Olá, " + e.nome + "! A cobrança da sua assinatura no cartão ainda não foi aprovada. O Mercado Pago vai tentar de novo; " +
      "para não perder o acesso, confira o cartão no Mercado Pago ou pague pelo Pix.";
  } else if (d.tipo === "bloqueio") {
    assunto = "Seu acesso ao Anuncia Aí foi pausado";
    texto = "Olá, " + e.nome + "! " + (teste ? "Seu teste grátis terminou" : "Não identificamos o pagamento da sua assinatura") +
      " e o acesso ao Anuncia Aí foi pausado. Assim que o pagamento for feito, o acesso volta na hora.";
  } else {
    const quando = d.dias <= 0 ? "hoje" : d.dias === 1 ? "amanhã" : "em " + d.dias + " dias";
    assunto = (teste ? "Seu teste grátis do Anuncia Aí termina " : "Sua assinatura do Anuncia Aí vence ") + quando + " (" + data + ")";
    texto = "Olá, " + e.nome + "! " + (teste ? "Seu teste grátis termina " : "Sua assinatura vence ") + quando + ", em " + data + ". " +
      (cartao ? "A renovação é automática no seu cartão. Se o cartão não passar, pague pelo Pix para não perder o acesso." :
        "Para continuar usando sem interrupção, faça o pagamento até essa data. Depois disso o acesso é pausado.");
  }
  const linkPagar = pix && pix.link ? pix.link : app;
  return { assunto, texto, linkPagar, app, pixCopia: pix && pix.copia, valor: pix && pix.valor, data };
}

function html(m: any) {
  const esc = (t: string) => String(t || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" } as any)[c]);
  return '<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#1f2937">' +
    '<h2 style="color:#7c3aed;margin:0 0 12px">Anuncia Aí</h2><p style="font-size:16px;line-height:1.5">' + esc(m.texto) + "</p>" +
    (m.pixCopia ? '<p style="margin:18px 0 6px"><b>Pix copia e cola' + (m.valor ? " (R$ " + Number(m.valor).toFixed(2).replace(".", ",") + ")" : "") + ':</b></p>' +
      '<p style="background:#f3f4f6;padding:10px;border-radius:8px;word-break:break-all;font-family:monospace;font-size:12px">' + esc(m.pixCopia) + "</p>" : "") +
    '<p style="margin:22px 0"><a href="' + esc(m.linkPagar) + '" style="background:#7c3aed;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:bold">Pagar agora</a></p>' +
    '<p style="color:#6b7280;font-size:13px">Ou abra o app: <a href="' + esc(m.app) + '">' + esc(m.app) + "</a></p></div>";
}

export async function enviarEmail(e: any, m: any) {
  if (!env("BREVO_API_KEY") || !env("EMAIL_FROM")) return { pulado: "e-mail não configurado" };
  const r = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST", headers: { "api-key": env("BREVO_API_KEY"), "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify({ sender: { name: "Anuncia Aí", email: env("EMAIL_FROM") }, to: [{ email: e.email, name: e.nome }], subject: m.assunto, htmlContent: html(m) }),
  });
  if (!r.ok) throw new Error("Brevo " + r.status + ": " + (await r.text()).slice(0, 200));
  return { ok: true };
}

export function foneWhats(t: string) {
  let n = String(t || "").replace(/\D/g, "");
  if (n.length === 10 || n.length === 11) n = "55" + n;
  return n.length >= 12 ? n : null;
}
// WhatsApp oficial (Meta): precisa de um modelo de mensagem aprovado com 3 campos: {{1}} nome, {{2}} texto curto, {{3}} link
export async function enviarWhats(e: any, m: any, d: any) {
  if (!env("WHATSAPP_TOKEN") || !env("WHATSAPP_PHONE_ID")) return { pulado: "WhatsApp não configurado" };
  const para = foneWhats(e.whatsapp);
  if (!para || e.aceita_whatsapp === false) return { pulado: "sem WhatsApp" };
  const curto = d.tipo === "bloqueio" ? "seu acesso foi pausado por falta de pagamento" : d.tipo === "cartao_falhou" ? "a cobrança no seu cartão não passou" : "sua assinatura vence em " + m.data;
  const r = await fetch("https://graph.facebook.com/v21.0/" + env("WHATSAPP_PHONE_ID") + "/messages", {
    method: "POST", headers: { Authorization: "Bearer " + env("WHATSAPP_TOKEN"), "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to: para, type: "template", template: {
      name: env("WHATSAPP_TEMPLATE") || "aviso_vencimento", language: { code: "pt_BR" },
      components: [{ type: "body", parameters: [{ type: "text", text: e.nome }, { type: "text", text: curto }, { type: "text", text: m.linkPagar }] }] } }),
  });
  if (!r.ok) throw new Error("WhatsApp " + r.status + ": " + (await r.text()).slice(0, 200));
  return { ok: true };
}

// reserva o aviso antes de mandar: se já existe (mesmo tipo, canal e vencimento), não manda de novo
async function reservar(e: any, tipo: string, canal: string) {
  const ref = dataBR(new Date(e.valido_ate));
  const r = await db("avisos?on_conflict=empresa_id,tipo,canal,referencia", {
    method: "POST", prefer: "return=representation,resolution=ignore-duplicates",
    body: { empresa_id: e.id, tipo, canal, referencia: ref, ok: false, erro: "enviando" },
  });
  return r && r[0] ? r[0].id : null;
}
async function marcar(id: string, ok: boolean, erro: string | null) {
  await db("avisos?id=eq." + id, { method: "PATCH", prefer: "return=minimal", body: { ok, erro } });
}

async function gerarPix(e: any) {
  if (cartaoAtivo(e) && new Date(e.valido_ate).getTime() > Date.now()) return null;
  try {
    const r = await fetch(env("SUPABASE_URL") + "/functions/v1/assinar", {
      method: "POST", headers: { Authorization: "Bearer " + env("CRON_SECRET"), "Content-Type": "application/json" },
      body: JSON.stringify({ metodo: "pix", empresa_id: e.id }),
    });
    const j = await r.json();
    return j.pix || null;
  } catch (_) { return null; }
}

export async function rodar(agora = new Date()) {
  const lista = await db("empresas?select=*&status=in.(teste,ativa)&valido_ate=lt." + encodeURIComponent(new Date(agora.getTime() + 6 * DIA).toISOString()));
  const resumo: any = { verificadas: lista.length, avisos: 0, bloqueadas: 0, erros: [] as string[] };
  for (const e of lista) {
    const d = decidir(e, agora);
    if (!d) continue;
    try {
      if (d.acao === "bloquear") {
        // só bloqueia se continuar vencida (se pagou enquanto a função rodava, não bloqueia)
        const limite = new Date(agora.getTime() - (cartaoAtivo(e) ? CARENCIA_CARTAO_DIAS * DIA : 0)).toISOString();
        await db("empresas?id=eq." + e.id + "&valido_ate=lte." + encodeURIComponent(limite), { method: "PATCH", prefer: "return=minimal", body: { status: "bloqueada" } });
        resumo.bloqueadas++;
      }
      let pix: any = undefined;
      for (const canal of ["email", "whatsapp"]) {
        const id = await reservar(e, d.tipo, canal);
        if (!id) continue;
        if (pix === undefined) pix = await gerarPix(e);
        const m = mensagem(e, d, pix);
        try {
          const r: any = canal === "email" ? await enviarEmail(e, m) : await enviarWhats(e, m, d);
          await marcar(id, !!r.ok, r.pulado || null);
          if (r.ok) resumo.avisos++;
        } catch (err) {
          await marcar(id, false, String((err as Error).message || err).slice(0, 300));
          resumo.erros.push(e.nome + " (" + canal + "): " + String((err as Error).message || err));
        }
      }
    } catch (err) {
      resumo.erros.push(e.nome + ": " + String((err as Error).message || err));
    }
  }
  return resumo;
}

export async function handler(req: Request): Promise<Response> {
  if (!env("CRON_SECRET") || req.headers.get("Authorization") !== "Bearer " + env("CRON_SECRET")) return new Response("não autorizado", { status: 401 });
  try {
    const r = await rodar();
    console.log("cobranca-diaria", JSON.stringify(r));
    return new Response(JSON.stringify(r), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error("cobranca-diaria erro", e);
    return new Response(String((e as Error).message || e), { status: 500 });
  }
}

if ((globalThis as any).Deno) (globalThis as any).Deno.serve(handler);
