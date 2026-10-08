// Funções usadas pelo app das empresas, pelo painel do dono e pelo site.
(function () {
  "use strict";
  var CFG = window.ANUNCIA_CONFIG || {};
  var DIA = 864e5;

  function esc(t) {
    if (t === null || t === undefined) return "";
    return String(t).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
  }
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function data(v) { return new Date(v).toLocaleDateString("pt-BR"); }
  function dataHora(v) { var d = new Date(v); return d.toLocaleDateString("pt-BR") + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); }
  function dinheiro(v) { return Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
  function soDigitos(t) { return String(t || "").replace(/\D/g, ""); }
  function linkZap(tel, texto) { var n = soDigitos(tel); if (n.length === 10 || n.length === 11) n = "55" + n; return "https://wa.me/" + n + "?text=" + encodeURIComponent(texto); }

  // situação da assinatura (mesma regra do banco: cartão tem 3 dias de tolerância)
  function situacao(e, agora) {
    agora = agora || Date.now();
    var fim = new Date(e.valido_ate).getTime(), cartao = e.metodo === "cartao" && !!e.mp_assinatura && e.status === "ativa";
    var liberado = (e.status === "teste" || e.status === "ativa") && (fim > agora || (cartao && fim + 3 * DIA > agora));
    var dias = Math.ceil((fim - agora) / DIA);
    return { liberado: liberado, dias: dias, teste: e.status === "teste", cartao: cartao, bloqueada: !liberado };
  }

  function avisar(msg, tipo) {
    var c = $("#avisos");
    if (!c) { c = document.createElement("div"); c.id = "avisos"; c.setAttribute("role", "status"); document.body.appendChild(c); }
    var t = document.createElement("div"); t.className = "toast " + (tipo || ""); t.textContent = msg; c.appendChild(t);
    while (c.children.length > 3) c.removeChild(c.firstChild);
    setTimeout(function () { t.remove(); }, tipo === "erro" ? 6000 : 3500);
  }
  function msgErro(e) {
    if (!e) return "Erro desconhecido.";
    var m = e.message || e.error_description || e.erro || String(e);
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return "Sem internet ou servidor fora do ar. Tente de novo.";
    if (/Invalid login/i.test(m)) return "E-mail ou senha errados. Toque no 👁 para conferir a senha.";
    if (/already registered|already been registered/i.test(m)) return "Este e-mail já tem cadastro. Use “Entrar”.";
    if (/Password should be at least/i.test(m)) return "A senha precisa ter pelo menos 8 letras ou números.";
    if (/Email not confirmed/i.test(m)) return "Confirme o seu e-mail (abra a mensagem que enviamos) e entre de novo.";
    if (/JWT|expired/i.test(m)) return "Sua sessão expirou. Entre de novo.";
    return m;
  }
  function janela(html, op) {
    op = op || {};
    var f = document.createElement("div"); f.className = "fundo-modal";
    f.innerHTML = '<div class="modal ' + (op.larga ? "larga" : "") + '" role="dialog" aria-modal="true"><div class="cab"><h2>' + esc(op.titulo || "") +
      '</h2><button class="fechar" aria-label="Fechar">✕</button></div><div class="corpo">' + html + "</div></div>";
    document.body.appendChild(f); document.body.style.overflow = "hidden";
    var fechado = false;
    function fechar() { if (fechado) return; fechado = true; f.remove(); if (!$(".fundo-modal")) document.body.style.overflow = ""; if (op.aoFechar) op.aoFechar(); }
    $(".fechar", f).onclick = fechar;
    f.addEventListener("mousedown", function (ev) { if (ev.target === f && !op.fixa) fechar(); });
    return { el: $(".corpo", f), fechar: fechar };
  }
  function ocupado(b, sim, txt) {
    if (!b) return;
    if (sim) { b.dataset.orig = b.innerHTML; b.disabled = true; b.innerHTML = '<span class="carregando"></span> ' + esc(txt || "Aguarde..."); }
    else { b.disabled = false; if (b.dataset.orig !== undefined) b.innerHTML = b.dataset.orig; }
  }
  function campoSenha(id, rotulo, auto) {
    return '<label for="' + id + '">' + rotulo + '</label><div style="position:relative"><input id="' + id + '" type="password" autocomplete="' + auto +
      '" autocapitalize="none" autocorrect="off" spellcheck="false" required style="padding-right:52px"><button type="button" class="texto" data-ver-senha="' + id +
      '" aria-label="Mostrar a senha" style="position:absolute;right:2px;top:50%;transform:translateY(-50%);font-size:20px">👁</button></div>';
  }
  function ligarVerSenha(r) {
    $$("[data-ver-senha]", r).forEach(function (b) {
      b.onclick = function () { var i = $("#" + b.dataset.verSenha), v = i.type === "password"; i.type = v ? "text" : "password"; b.textContent = v ? "🙈" : "👁"; };
    });
  }
  function configurado() { return !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY); }
  function cliente() {
    if (!window.supabase || !window.supabase.createClient) throw new Error("Não foi possível carregar o sistema. Verifique a internet.");
    return window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
  }
  function telaSemConfig(alvo) {
    alvo.innerHTML = '<div class="entrada"><div class="logo-g">Anuncia <span>Aí</span></div><div class="cartao"><h2>Falta configurar</h2>' +
      "<p>Abra o arquivo <b>config.js</b> e preencha <b>SUPABASE_URL</b> e <b>SUPABASE_ANON_KEY</b> (passo a passo no LEIA-ME.md).</p></div></div>";
  }
  function copiar(texto, msg) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(texto).then(function () { avisar(msg || "Copiado", "ok"); }, function () { window.prompt("Copie:", texto); });
    window.prompt("Copie:", texto); return Promise.resolve();
  }
  function baixar(blob, nome) {
    var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = nome; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
  }
  // chama uma Edge Function do Supabase com o login do usuário
  function funcao(sb, nome, corpo) {
    return sb.auth.getSession().then(function (r) {
      var s = r.data && r.data.session;
      if (!s) throw new Error("Entre de novo no app.");
      return fetch(CFG.SUPABASE_URL + "/functions/v1/" + nome, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + s.access_token, apikey: CFG.SUPABASE_ANON_KEY },
        body: JSON.stringify(corpo || {})
      });
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok || j.erro) throw new Error(j.erro || "Erro " + r.status); return j; });
    });
  }

  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    window.addEventListener("load", function () { navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).catch(function () {}); });
  }

  window.AN = { CFG: CFG, DIA: DIA, esc: esc, $: $, $$: $$, data: data, dataHora: dataHora, dinheiro: dinheiro, soDigitos: soDigitos, linkZap: linkZap,
    situacao: situacao, avisar: avisar, msgErro: msgErro, janela: janela, ocupado: ocupado, campoSenha: campoSenha, ligarVerSenha: ligarVerSenha,
    configurado: configurado, cliente: cliente, telaSemConfig: telaSemConfig, copiar: copiar, baixar: baixar, funcao: funcao };
})();
