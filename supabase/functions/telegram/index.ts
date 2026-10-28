// Anuncia Aí — função "telegram" (Supabase Edge Function)
// Publica a arte (imagem + legenda) no canal ou grupo do Telegram da empresa logada,
// usando o robô DELA (código salvo pelo app em public.telegram, que o app não lê).
//   * { acao: "testar" }                       confere o robô e se ele pode publicar no canal
//   * { acao: "publicar", foto, legenda }      foto = data URL JPEG/PNG da arte
// Configuração em "Verify JWT": DESLIGADO (a própria função confere o login).

const env = (k: string) => (globalThis as any).Deno ? (globalThis as any).Deno.env.get(k) : (globalThis as any).process?.env?.[k];
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

async function db(caminho: string) {
  const r = await fetch(env("SUPABASE_URL") + "/rest/v1/" + caminho, {
    headers: { apikey: chaveServidor(), Authorization: "Bearer " + chaveServidor() },
  });
  const t = await r.text();
  if (!r.ok) throw new Error("Banco: " + r.status + " " + t);
  return t ? JSON.parse(t) : null;
}

async function usuarioLogado(req: Request) {
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const r = await fetch(env("SUPABASE_URL") + "/auth/v1/user", { headers: { apikey: chaveServidor(), Authorization: auth } });
  if (!r.ok) return null;
  return await r.json();
}

// mesma regra de public.acesso_liberado: teste ou ativa dentro da validade (cartão: 3 dias de tolerância)
function liberada(e: any) {
  const fim = new Date(e.valido_ate).getTime(), agora = Date.now();
  const cartao = e.status === "ativa" && e.metodo === "cartao" && !!e.mp_assinatura;
  return (e.status === "teste" || e.status === "ativa") && (fim > agora || (cartao && fim + 3 * 864e5 > agora));
}

// erros do Telegram em português, com o que fazer
function erroTelegram(desc: string) {
  const d = String(desc || "");
  if (/unauthorized|invalid token|not found/i.test(d) && /bot|unauthorized/i.test(d)) return "O código do robô não vale mais. Pegue de novo no @BotFather e salve em Minha marca.";
  if (/chat not found/i.test(d)) return "Canal não encontrado. Confira o @ do canal e se o robô foi adicionado nele.";
  if (/not enough rights|need administrator|not a member|bot was kicked|have no rights/i.test(d)) return "O robô não pode publicar no canal. Coloque o robô como administrador com a permissão \"Publicar mensagens\".";
  if (/too many requests|retry after/i.test(d)) return "O Telegram pediu para esperar um pouco. Tente de novo em 1 minuto.";
  return "Telegram: " + d;
}
async function tg(token: string, metodo: string, corpo: FormData | Record<string, unknown>) {
  const ehForm = corpo instanceof FormData;
  const r = await fetch("https://api.telegram.org/bot" + token + "/" + metodo, {
    method: "POST",
    headers: ehForm ? undefined : { "Content-Type": "application/json" },
    body: ehForm ? corpo as FormData : JSON.stringify(corpo),
  });
  const j = await r.json().catch(() => ({ ok: false, description: "resposta inválida (" + r.status + ")" }));
  if (!j.ok) throw new Error(erroTelegram(j.description));
  return j.result;
}

async function testar(t: any) {
  const eu = await tg(t.token, "getMe", {});
  const chat = await tg(t.token, "getChat", { chat_id: t.canal });
  const membro = await tg(t.token, "getChatMember", { chat_id: t.canal, user_id: eu.id });
  const podeCanal = membro.status === "creator" || (membro.status === "administrator" && membro.can_post_messages !== false);
  const podeGrupo = chat.type !== "channel" && ["creator", "administrator", "member"].includes(membro.status);
  if (!podeCanal && !podeGrupo) throw new Error(erroTelegram("not enough rights"));
  return { ok: true, robo: "@" + eu.username, canal: chat.title || t.canal, tipo: chat.type };
}

async function publicar(t: any, corpo: any) {
  const m = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/.exec(String(corpo.foto || ""));
  if (!m) throw new Error("Imagem inválida.");
  const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
  if (bytes.length > 8 * 1024 * 1024) throw new Error("Imagem muito grande (máximo 8 MB).");
  const legenda = String(corpo.legenda || "").slice(0, 4096);
  const fd = new FormData();
  fd.append("chat_id", t.canal);
  fd.append("photo", new Blob([bytes], { type: "image/" + m[1] }), "arte." + (m[1] === "png" ? "png" : "jpg"));
  // legenda de foto vai até 1024 letras; maior que isso, segue logo abaixo como mensagem
  const curta = legenda.length <= 1024;
  if (curta && legenda) fd.append("caption", legenda);
  const msg = await tg(t.token, "sendPhoto", fd);
  if (!curta) await tg(t.token, "sendMessage", { chat_id: t.canal, text: legenda, disable_web_page_preview: true });
  const usuario = msg.chat && msg.chat.username;
  return { ok: true, link: usuario ? "https://t.me/" + usuario + "/" + msg.message_id : null };
}

export async function handler(req: Request) {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return resposta({ erro: "Use POST." }, 405);
  try {
    const corpo = await req.json().catch(() => ({}));
    const u = await usuarioLogado(req);
    if (!u || !u.id) return resposta({ erro: "Entre de novo no app." }, 401);
    const empresa = (await db("empresas?select=*&dono=eq." + u.id))[0];
    if (!empresa) return resposta({ erro: "Empresa não encontrada." }, 404);
    if (!liberada(empresa)) return resposta({ erro: "Acesso pausado: regularize a assinatura para publicar." }, 403);
    const t = (await db("telegram?select=canal,token&empresa_id=eq." + empresa.id))[0];
    if (!t) return resposta({ erro: "Configure o Telegram em Minha marca." }, 400);
    if (corpo.acao === "testar") return resposta(await testar(t));
    if (corpo.acao === "publicar") return resposta(await publicar(t, corpo));
    return resposta({ erro: "Ação inválida." }, 400);
  } catch (e) {
    console.error(e);
    return resposta({ erro: String((e as Error).message || e) }, 500);
  }
}

if ((globalThis as any).Deno) (globalThis as any).Deno.serve(handler);
