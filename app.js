// Anuncia Aí — app da empresa: criar artes, minha marca e assinatura.
(function () {
  "use strict";
  var A = window.AN, R = window.AN_ARTES, esc = A.esc, $ = A.$, $$ = A.$$;
  var app = $("#app"), sb = null, E = null, PLANOS = [], logoImg = null, logoDe = null;
  var ABAS = [["criar", "🎨 Criar arte"], ["marca", "🏷️ Minha marca"], ["assinatura", "💳 Assinatura"]];
  var arte = { modelo: "promocao", formato: "post", campos: {}, fotos: [], legendaEditada: false };
  var vigiaPix = null;

  function q(p) { return p.then(function (r) { if (r.error) throw r.error; return r.data; }); }

  function iniciar() {
    if (!A.configurado()) { A.telaSemConfig(app); return; }
    try { sb = A.cliente(); } catch (e) { app.innerHTML = '<div class="entrada"><div class="aviso erro">' + esc(A.msgErro(e)) + "</div></div>"; return; }
    var recuperando = /type=recovery/.test(location.hash);
    sb.auth.onAuthStateChange(function (ev) {
      if (ev === "SIGNED_OUT") telaLogin();
      if (ev === "PASSWORD_RECOVERY") { recuperando = true; telaNovaSenha(); }
    });
    sb.auth.getSession().then(function (r) {
      if (recuperando && r.data && r.data.session) { telaNovaSenha(); return; }
      if (r.data && r.data.session) carregar(); else telaLogin();
    }).catch(function () { telaLogin(); });
  }

  // ---------- entrar / criar conta ----------
  function telaLogin(msg, criar) {
    window.removeEventListener("hashchange", rota);
    app.innerHTML = '<div class="entrada"><div class="logo-g">Anuncia <span>Aí</span></div><p class="mudo" style="text-align:center;margin:4px 0 16px">Artes prontas para divulgar o seu negócio</p>' +
      '<form class="cartao" id="f-login"><div class="linha" style="margin-bottom:6px"><button type="button" class="peq ' + (criar ? "" : "prim") + '" id="l-entrar">Entrar</button>' +
      '<button type="button" class="peq ' + (criar ? "prim" : "") + '" id="l-criar">Criar conta (7 dias grátis)</button></div>' +
      '<label for="l-email">E-mail</label><input id="l-email" type="email" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required>' +
      A.campoSenha("l-senha", criar ? "Crie uma senha (mínimo 8)" : "Senha", criar ? "new-password" : "current-password") +
      '<div id="l-msg">' + (msg ? '<div class="aviso">' + esc(msg) + "</div>" : "") + '</div><div class="acoes"><button class="prim" type="submit">' + (criar ? "Criar conta grátis" : "Entrar") + "</button></div>" +
      (criar ? "" : '<button type="button" class="texto peq" id="l-esqueci" style="margin-top:8px">Esqueci a senha</button>') + "</form></div>";
    A.ligarVerSenha(app);
    $("#l-entrar").onclick = function () { telaLogin(null, false); };
    $("#l-criar").onclick = function () { telaLogin(null, true); };
    var erro = function (m, tipo) { $("#l-msg").innerHTML = '<div class="aviso ' + (tipo || "erro") + '">' + m + "</div>"; };
    if ($("#l-esqueci")) $("#l-esqueci").onclick = function () {
      var email = $("#l-email").value.trim().toLowerCase(), b = this;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { erro("Escreva o seu e-mail acima e toque de novo em “Esqueci a senha”."); return; }
      A.ocupado(b, true, "Enviando...");
      sb.auth.resetPasswordForEmail(email, { redirectTo: location.href.split("#")[0] }).then(function (r) {
        A.ocupado(b, false); if (r.error) throw r.error;
        erro("Enviamos um e-mail para trocar a senha. Abra o link <b>neste aparelho</b> (olhe também o Spam).", "ok");
      }).catch(function (e) { A.ocupado(b, false); erro(esc(/rate limit|seconds/i.test(A.msgErro(e)) ? "Aguarde alguns minutos e tente de novo." : A.msgErro(e))); });
    };
    $("#f-login").onsubmit = function (ev) {
      ev.preventDefault();
      var b = $("button[type=submit]", this), email = $("#l-email").value.trim().toLowerCase(), senha = $("#l-senha").value;
      if (criar && senha.length < 8) { erro("A senha precisa ter pelo menos 8 letras ou números."); return; }
      A.ocupado(b, true, criar ? "Criando..." : "Entrando...");
      var p = criar ? sb.auth.signUp({ email: email, password: senha, options: { emailRedirectTo: location.href.split("#")[0] } }) : sb.auth.signInWithPassword({ email: email, password: senha });
      p.then(function (r) {
        if (r.error) throw r.error;
        if (criar && !(r.data && r.data.session)) { A.ocupado(b, false); erro("Quase lá! Enviamos um e-mail para <b>" + esc(email) + "</b>. Abra o link para confirmar e depois entre.", "ok"); return; }
        return carregar();
      }).catch(function (e) { A.ocupado(b, false); erro(esc(A.msgErro(e))); });
    };
  }
  function telaNovaSenha() {
    app.innerHTML = '<div class="entrada"><div class="logo-g">Anuncia <span>Aí</span></div><form class="cartao" id="f-nova"><h2>Criar senha nova</h2>' +
      A.campoSenha("n-senha", "Senha nova (mínimo 8)", "new-password") + '<div id="n-msg"></div><div class="acoes"><button class="prim" type="submit">Salvar</button></div></form></div>';
    A.ligarVerSenha(app);
    $("#f-nova").onsubmit = function (ev) {
      ev.preventDefault();
      var s = $("#n-senha").value, b = $("button[type=submit]", this);
      if (s.length < 8) { $("#n-msg").innerHTML = '<div class="aviso erro">Mínimo 8 letras ou números.</div>'; return; }
      A.ocupado(b, true, "Salvando...");
      sb.auth.updateUser({ password: s }).then(function (r) { if (r.error) throw r.error; history.replaceState(null, "", location.href.split("#")[0]); A.avisar("Senha trocada.", "ok"); carregar(); })
        .catch(function (e) { A.ocupado(b, false); $("#n-msg").innerHTML = '<div class="aviso erro">' + esc(A.msgErro(e)) + "</div>"; });
    };
  }

  // ---------- dados ----------
  function carregar() {
    app.innerHTML = '<div class="vazio"><span class="carregando"></span> Carregando...</div>';
    return Promise.all([q(sb.from("empresas").select("*").limit(1)), q(sb.from("planos").select("*").eq("ativo", true).order("ordem"))]).then(function (r) {
      PLANOS = r[1] || [];
      if (!r[0] || !r[0].length) { telaPrimeiroAcesso(); return; }
      E = r[0][0]; carregarLogo(); montar();
    }).catch(function (e) { telaLogin(A.msgErro(e)); });
  }
  function urlLogo() { return E.logo ? sb.storage.from("logos").getPublicUrl(E.logo).data.publicUrl : null; }
  function carregarLogo() {
    var u = urlLogo();
    if (!u) { logoImg = null; logoDe = null; return Promise.resolve(); }
    if (logoDe === u && logoImg) return Promise.resolve();
    return new Promise(function (ok) {
      var im = new Image(); im.crossOrigin = "anonymous";
      im.onload = function () { logoImg = im; logoDe = u; ok(); if ($("#cv-arte")) redesenhar(); };
      im.onerror = function () { logoImg = null; ok(); };
      im.src = u;
    });
  }
  function opcoesRamo(atual) {
    return '<option value="">Escolha o ramo</option>' + Object.keys(R.RAMOS).map(function (k) { return '<option' + (k === atual ? " selected" : "") + ">" + esc(k) + "</option>"; }).join("");
  }
  function telaPrimeiroAcesso() {
    app.innerHTML = '<div class="entrada" style="max-width:520px"><div class="logo-g">Anuncia <span>Aí</span></div><form class="cartao" id="f-emp"><h2>Sua empresa</h2>' +
      '<p class="mudo peq">Esses dados aparecem nas artes. Você ganha <b>7 dias grátis</b> para testar.</p>' +
      '<label for="pe-nome">Nome da empresa *</label><input id="pe-nome" maxlength="120" required>' +
      '<label for="pe-ramo">Ramo</label><select id="pe-ramo">' + opcoesRamo("") + "</select>" +
      '<div class="duas"><div><label for="pe-cid">Cidade</label><input id="pe-cid" maxlength="80"></div><div><label for="pe-zap">WhatsApp</label><input id="pe-zap" type="tel" maxlength="30" placeholder="(31) 99999-9999"></div></div>' +
      '<label for="pe-ig">Instagram</label><input id="pe-ig" maxlength="60" placeholder="@suaempresa">' +
      '<div id="pe-msg"></div><div class="acoes"><button class="prim" type="submit">Começar</button></div></form>' +
      '<p style="text-align:center"><button class="texto peq" id="pe-sair">Sair</button></p></div>';
    $("#pe-sair").onclick = function () { sb.auth.signOut(); };
    $("#f-emp").onsubmit = function (ev) {
      ev.preventDefault();
      var b = $("button[type=submit]", this);
      A.ocupado(b, true, "Criando...");
      q(sb.rpc("criar_empresa", { p_nome: $("#pe-nome").value.trim(), p_ramo: $("#pe-ramo").value || null, p_cidade: $("#pe-cid").value.trim() || null,
        p_whatsapp: $("#pe-zap").value.trim() || null, p_instagram: $("#pe-ig").value.trim() || null })).then(function () { location.hash = "#marca"; return carregar(); })
        .catch(function (e) { A.ocupado(b, false); $("#pe-msg").innerHTML = '<div class="aviso erro">' + esc(A.msgErro(e)) + "</div>"; });
    };
  }

  // ---------- estrutura ----------
  function montar() {
    app.innerHTML = '<div class="topo"><div class="marca">Anuncia <span>Aí</span></div><div class="peq" style="opacity:.9">' + esc(E.nome) + "</div>" +
      '<div class="dir"><button class="peq" id="b-sair">Sair</button></div></div><nav class="abas" id="abas"></nav><div id="faixa"></div><main id="conteudo"></main>';
    $("#b-sair").onclick = function () { sb.auth.signOut(); };
    window.removeEventListener("hashchange", rota); window.addEventListener("hashchange", rota);
    rota();
  }
  function faixa() {
    var s = A.situacao(E), h = "";
    if (s.bloqueada) h = '<div class="aviso erro" style="margin:12px 16px 0"><b>Acesso pausado.</b> ' + (E.status === "teste" || s.teste ? "O teste grátis terminou." : "Não identificamos o pagamento.") +
      ' <a href="#assinatura">Pague aqui</a> e o acesso volta na hora.</div>';
    else if (s.teste) h = '<div class="aviso" style="margin:12px 16px 0">🎁 Teste grátis: <b>' + (s.dias <= 1 ? "termina hoje" : s.dias + " dias restantes") + '</b>. <a href="#assinatura">Assinar</a></div>';
    else if (s.dias <= 5 && !s.cartao) h = '<div class="aviso" style="margin:12px 16px 0">Sua assinatura vence em <b>' + A.data(E.valido_ate) + '</b>. <a href="#assinatura">Pagar agora</a></div>';
    $("#faixa").innerHTML = h;
  }
  function rota() {
    var aba = location.hash.slice(1) || "criar";
    if (!ABAS.some(function (a) { return a[0] === aba; })) aba = "criar";
    if (A.situacao(E).bloqueada && aba !== "assinatura") aba = "assinatura";
    if (vigiaPix && aba !== "assinatura") { clearInterval(vigiaPix); vigiaPix = null; }
    $("#abas").innerHTML = ABAS.map(function (a) { return '<a href="#' + a[0] + '" class="' + (a[0] === aba ? "ativa" : "") + '">' + a[1] + "</a>"; }).join("");
    faixa();
    var c = $("#conteudo");
    ({ criar: verCriar, marca: verMarca, assinatura: verAssinatura })[aba](c);
  }

  // ---------- criar arte ----------
  var temporizador = null;
  function redesenhar() {
    clearTimeout(temporizador);
    temporizador = setTimeout(function () {
      var cv = $("#cv-arte");
      if (!cv) return;
      R.desenhar(cv, { modelo: arte.modelo, formato: arte.formato, campos: arte.campos, fotos: arte.fotos, empresa: E, logo: logoImg });
      if (!arte.legendaEditada && $("#ar-leg")) $("#ar-leg").value = R.legenda(arte.modelo, arte.campos, E);
    }, 120);
  }
  function verCriar(c) {
    var M = R.MODELOS[arte.modelo];
    if (!Object.keys(arte.campos).length) M.campos.forEach(function (f) { arte.campos[f[0]] = f[2]; });
    c.innerHTML = '<div class="cartao"><h3 style="margin-bottom:10px">1. Escolha o modelo</h3><div class="modelos">' +
      Object.keys(R.MODELOS).map(function (k) { var m = R.MODELOS[k]; return '<button data-modelo="' + k + '" class="' + (k === arte.modelo ? "ativo" : "") + '"><span class="ic">' + m.ic + "</span>" + esc(m.nome) + "</button>"; }).join("") +
      '</div></div><div class="editor"><div class="cartao"><h3>2. Preencha</h3><label for="ar-fmt">Formato</label><select id="ar-fmt">' +
      Object.keys(R.FORMATOS).map(function (k) { return '<option value="' + k + '"' + (k === arte.formato ? " selected" : "") + ">" + R.FORMATOS[k][2] + "</option>"; }).join("") + "</select>" +
      M.campos.map(function (f) {
        var longo = f[0] === "itens" || f[0] === "texto";
        return '<label for="ar-' + f[0] + '">' + esc(f[1]) + "</label>" + (longo ? '<textarea id="ar-' + f[0] + '" data-campo="' + f[0] + '" rows="3" maxlength="300"></textarea>' :
          '<input id="ar-' + f[0] + '" data-campo="' + f[0] + '" maxlength="80"' + (f[0] === "de" || f[0] === "por" ? ' inputmode="decimal"' : "") + ">");
      }).join("") +
      (M.fotos ? '<label>' + (M.fotos === 2 ? "Fotos (antes e depois)" : "Foto") + '</label><div class="linha">' + [0, 1].slice(0, M.fotos).map(function (i) {
        return '<label class="botao peq" style="margin:0;cursor:pointer">📷 ' + (M.fotos === 2 ? (i ? "Depois" : "Antes") : "Escolher foto") + '<input type="file" accept="image/*" data-foto="' + i + '" class="oculto"></label>';
      }).join("") + "</div>" : "") +
      (!E.logo ? '<div class="aviso peq">Dica: coloque o seu logo em <a href="#marca">Minha marca</a> para ele aparecer nas artes.</div>' : "") +
      '<label for="ar-leg">Legenda do post</label><textarea id="ar-leg" rows="7"></textarea><button class="texto peq" id="ar-regera">↻ Gerar a legenda de novo</button></div>' +
      '<div><div class="previa cartao" style="padding:10px"><canvas id="cv-arte" aria-label="Prévia da arte"></canvas></div>' +
      '<div class="acoes" style="margin-top:0">' + (podeCompartilhar() ? '<button class="prim" id="ar-postar">📤 Postar (Instagram, Facebook, WhatsApp, Telegram...)</button>' : "") +
      '<button id="ar-baixar"' + (podeCompartilhar() ? "" : ' class="prim"') + '>⬇ Baixar imagem</button><button id="ar-copiar">📋 Copiar legenda</button></div>' +
      '<p class="mudo peq">No Instagram a legenda não vai junto automaticamente: ela já fica copiada, é só colar no post.</p></div></div>';
    $$("[data-modelo]", c).forEach(function (b) {
      b.onclick = function () { arte.modelo = b.dataset.modelo; arte.campos = {}; arte.fotos = []; arte.legendaEditada = false; verCriar(c); };
    });
    $$("[data-campo]", c).forEach(function (i) {
      i.value = arte.campos[i.dataset.campo] || "";
      i.oninput = function () { arte.campos[i.dataset.campo] = i.value; redesenhar(); };
    });
    $("#ar-fmt", c).onchange = function () { arte.formato = this.value; redesenhar(); };
    $$("[data-foto]", c).forEach(function (inp) {
      inp.onchange = function () {
        var f = inp.files && inp.files[0]; if (!f) return;
        var im = new Image(); im.onload = function () { arte.fotos[Number(inp.dataset.foto)] = im; redesenhar(); }; im.src = URL.createObjectURL(f);
      };
    });
    $("#ar-leg", c).oninput = function () { arte.legendaEditada = true; };
    $("#ar-regera", c).onclick = function () { arte.legendaEditada = false; redesenhar(); };
    function blob() { return new Promise(function (ok) { $("#cv-arte").toBlob(ok, "image/jpeg", 0.92); }); }
    function nome() { return "anuncia-ai-" + arte.modelo + "-" + Date.now() + ".jpg"; }
    $("#ar-baixar", c).onclick = function () { blob().then(function (b) { A.baixar(b, nome()); A.copiar($("#ar-leg").value, "Imagem baixada e legenda copiada."); }); };
    $("#ar-copiar", c).onclick = function () { A.copiar($("#ar-leg").value, "Legenda copiada."); };
    if ($("#ar-postar", c)) $("#ar-postar", c).onclick = function () {
      var t = $("#ar-leg").value;
      A.copiar(t, "Legenda copiada").then(blob).then(function (b) {
        return navigator.share({ files: [new File([b], nome(), { type: "image/jpeg" })], text: t });
      }).catch(function (e) { if (!e || e.name !== "AbortError") A.avisar("Não abriu o compartilhar. Use ⬇ Baixar imagem.", "erro"); });
    };
    redesenhar();
  }
  function podeCompartilhar() { try { return !!(navigator.canShare && navigator.canShare({ files: [new File(["x"], "x.jpg", { type: "image/jpeg" })] })); } catch (e) { return false; } }

  // ---------- minha marca ----------
  function verMarca(c) {
    c.innerHTML = '<div class="cartao"><h2>🏷️ Minha marca</h2><p class="mudo peq">O que aparece nas artes.</p>' +
      '<label for="mm-nome">Nome da empresa</label><input id="mm-nome" maxlength="120">' +
      '<label for="mm-ramo">Ramo</label><select id="mm-ramo">' + opcoesRamo(E.ramo) + "</select>" +
      '<div class="duas"><div><label for="mm-cid">Cidade</label><input id="mm-cid" maxlength="80"></div><div><label for="mm-zap">WhatsApp</label><input id="mm-zap" type="tel" maxlength="30"></div></div>' +
      '<div class="duas"><div><label for="mm-ig">Instagram</label><input id="mm-ig" maxlength="60" placeholder="@suaempresa"></div><div><label for="mm-site">Site (opcional)</label><input id="mm-site" maxlength="120"></div></div>' +
      '<div class="duas"><div><label for="mm-cor1">Cor principal</label><input type="color" id="mm-cor1"></div><div><label for="mm-cor2">Cor de destaque</label><input type="color" id="mm-cor2"></div></div>' +
      '<label>Logo</label><div class="linha"><img id="mm-logo-v" alt="" style="width:72px;height:72px;object-fit:contain;background:#fff;border-radius:12px;border:1px solid var(--borda)' + (E.logo ? "" : ";display:none") + '">' +
      '<label class="botao peq" style="margin:0;cursor:pointer">📁 Enviar logo (PNG ou JPG)<input type="file" accept="image/png,image/jpeg,image/webp" id="mm-logo" class="oculto"></label>' +
      (E.logo ? '<button class="peq" id="mm-tira">Tirar logo</button>' : "") + "</div>" +
      '<label class="marca-linha" style="font-weight:400"><input type="checkbox" id="mm-zapok"> Receber avisos de cobrança no WhatsApp</label>' +
      '<div id="mm-msg"></div><div class="acoes"><button class="prim" id="mm-salvar">Salvar</button></div></div>';
    $("#mm-nome").value = E.nome || ""; $("#mm-cid").value = E.cidade || ""; $("#mm-zap").value = E.whatsapp || ""; $("#mm-ig").value = E.instagram || "";
    $("#mm-site").value = E.site || ""; $("#mm-cor1").value = E.cor1 || "#7c3aed"; $("#mm-cor2").value = E.cor2 || "#f59e0b"; $("#mm-zapok").checked = E.aceita_whatsapp !== false;
    if (E.logo) $("#mm-logo-v").src = urlLogo();
    function salvar(extra) {
      var p = Object.assign({ nome: $("#mm-nome").value.trim(), ramo: $("#mm-ramo").value, cidade: $("#mm-cid").value.trim(), whatsapp: $("#mm-zap").value.trim(),
        instagram: $("#mm-ig").value.trim(), site: $("#mm-site").value.trim(), cor1: $("#mm-cor1").value, cor2: $("#mm-cor2").value, aceita_whatsapp: $("#mm-zapok").checked }, extra || {});
      return q(sb.rpc("salvar_perfil", { p: p })).then(function (n) { E = Array.isArray(n) ? n[0] : n; return carregarLogo(); });
    }
    $("#mm-salvar").onclick = function () {
      var b = this; A.ocupado(b, true, "Salvando...");
      salvar().then(function () { A.ocupado(b, false); A.avisar("Salvo", "ok"); $(".topo .peq").textContent = E.nome; })
        .catch(function (e) { A.ocupado(b, false); $("#mm-msg").innerHTML = '<div class="aviso erro">' + esc(A.msgErro(e)) + "</div>"; });
    };
    if ($("#mm-tira")) $("#mm-tira").onclick = function () { salvar({ logo: "" }).then(function () { verMarca(c); }).catch(function (e) { A.avisar(A.msgErro(e), "erro"); }); };
    $("#mm-logo").onchange = function () {
      var f = this.files && this.files[0]; if (!f) return;
      if (f.size > 8 * 1024 * 1024) { A.avisar("Imagem muito grande (máximo 8 MB).", "erro"); return; }
      var im = new Image();
      im.onload = function () {
        var k = Math.min(1, 600 / Math.max(im.width, im.height)), cv = document.createElement("canvas");
        cv.width = Math.round(im.width * k); cv.height = Math.round(im.height * k); cv.getContext("2d").drawImage(im, 0, 0, cv.width, cv.height);
        cv.toBlob(function (b) {
          var caminho = E.id + "/logo-" + Date.now() + ".png";
          q(sb.storage.from("logos").upload(caminho, b, { contentType: "image/png", upsert: true })).then(function () { return salvar({ logo: caminho }); })
            .then(function () { A.avisar("Logo salvo", "ok"); verMarca(c); }).catch(function (e) { A.avisar(A.msgErro(e), "erro"); });
        }, "image/png");
      };
      im.src = URL.createObjectURL(f);
    };
  }

  // ---------- assinatura ----------
  function verAssinatura(c) {
    var s = A.situacao(E), plano = PLANOS.filter(function (p) { return p.id === E.plano; })[0] || PLANOS[0];
    var est = s.bloqueada ? '<span class="selo critico">pausada</span>' : s.teste ? '<span class="selo atencao">teste grátis</span>' : '<span class="selo bom">ativa</span>';
    c.innerHTML = '<div class="cartao"><div class="linha"><h2>💳 Assinatura</h2>' + est + "</div>" +
      '<p style="margin:8px 0 0">' + (s.bloqueada ? "Acesso pausado desde " + A.data(E.valido_ate) + "." : (s.teste ? "Teste grátis até " : "Acesso liberado até ") + "<b>" + A.data(E.valido_ate) + "</b>.") + "</p>" +
      (s.cartao ? '<div class="aviso ok">✅ Renovação automática no cartão ativa. Para cancelar, use “Assinaturas” no app ou site do Mercado Pago.</div>' : "") +
      '<h3 style="margin-top:16px">Plano</h3><div class="planos" id="as-planos">' + PLANOS.map(function (p) {
        return '<div class="plano' + (plano && p.id === plano.id ? " escolhido" : "") + '" data-plano="' + esc(p.id) + '"><div class="forte">' + esc(p.nome) + '</div><div class="preco">' + A.dinheiro(p.preco) +
          '</div><div class="mudo peq">' + (p.meses === 1 ? "por mês" : "a cada " + p.meses + " meses (" + A.dinheiro(p.preco / p.meses) + "/mês)") + "</div></div>";
      }).join("") + "</div>" +
      '<div class="acoes"><button class="prim" id="as-cartao">💳 Cartão (renova sozinho)</button><button class="dest" id="as-pix">⚡ Pagar com Pix</button></div>' +
      '<div id="as-res"></div><p class="mudo peq">Pagamento seguro pelo Mercado Pago. Assim que o pagamento é aprovado, o acesso é liberado automaticamente.</p></div>' +
      '<div class="cartao"><h3>Pagamentos</h3><div id="as-hist" class="mudo peq">Carregando...</div></div>' +
      '<p class="mudo peq" style="text-align:center">Dúvidas? ' + (A.CFG.SUPORTE_WHATSAPP ? '<a target="_blank" rel="noopener" href="' + esc(A.linkZap(A.CFG.SUPORTE_WHATSAPP, "Olá! Preciso de ajuda com o Anuncia Aí (" + E.nome + ").")) + '">WhatsApp ' + esc(A.CFG.SUPORTE_WHATSAPP) + "</a>" : "") + "</p>";
    var escolhido = plano ? plano.id : null;
    $$("[data-plano]", c).forEach(function (d) {
      d.onclick = function () { escolhido = d.dataset.plano; $$("[data-plano]", c).forEach(function (x) { x.classList.toggle("escolhido", x === d); }); };
    });
    $("#as-cartao").onclick = function () {
      var b = this; A.ocupado(b, true, "Abrindo o Mercado Pago...");
      A.funcao(sb, "assinar", { metodo: "cartao", plano: escolhido }).then(function (r) { location.href = r.link; })
        .catch(function (e) { A.ocupado(b, false); $("#as-res").innerHTML = '<div class="aviso erro">' + esc(A.msgErro(e)) + "</div>"; });
    };
    $("#as-pix").onclick = function () {
      var b = this; A.ocupado(b, true, "Gerando o Pix...");
      A.funcao(sb, "assinar", { metodo: "pix", plano: escolhido }).then(function (r) {
        A.ocupado(b, false);
        var p = r.pix || {};
        $("#as-res").innerHTML = '<div class="cartao" style="margin-top:14px;text-align:center"><h3>⚡ Pix de ' + A.dinheiro(p.valor) + "</h3>" +
          (p.qr ? '<img class="pix-qr" alt="QR Code do Pix" src="data:image/png;base64,' + esc(p.qr) + '">' : "") +
          '<p class="peq mudo">Abra o app do seu banco, escolha Pix e leia o QR, ou use o copia e cola:</p><div class="copia" id="as-copia">' + esc(p.copia || "") + "</div>" +
          '<div class="acoes"><button class="prim" id="as-copiar">📋 Copiar código Pix</button>' + (p.link ? '<a class="botao" target="_blank" rel="noopener" href="' + esc(p.link) + '">Abrir no Mercado Pago</a>' : "") + "</div>" +
          '<p class="peq" id="as-espera"><span class="carregando"></span> Aguardando o pagamento... (válido até ' + A.dataHora(p.vence_em) + ")</p></div>";
        $("#as-copiar").onclick = function () { A.copiar(p.copia || "", "Código Pix copiado. Cole no app do banco."); };
        esperarPagamento();
      }).catch(function (e) { A.ocupado(b, false); $("#as-res").innerHTML = '<div class="aviso erro">' + esc(A.msgErro(e)) + "</div>"; });
    };
    if (/#assinatura/.test(location.hash) && document.referrer.indexOf("mercadopago") >= 0) $("#as-res").innerHTML = '<div class="aviso ok">Recebemos a sua assinatura. Assim que o Mercado Pago aprovar a cobrança, o acesso é liberado.</div>';
    q(sb.from("pagamentos").select("*").order("criado_em", { ascending: false }).limit(20)).then(function (ps) {
      $("#as-hist").innerHTML = ps.length ? '<div class="tabela"><table><thead><tr><th>Data</th><th>Forma</th><th>Valor</th><th>Situação</th></tr></thead><tbody>' + ps.map(function (p) {
        var st = p.status === "approved" ? '<span class="selo bom">pago</span>' : p.status === "pending" ? '<span class="selo atencao">aguardando</span>' : '<span class="selo critico">' + esc(p.status) + "</span>";
        return "<tr><td>" + A.data(p.pago_em || p.criado_em) + "</td><td>" + (p.tipo === "pix" ? "Pix" : p.tipo === "cartao" ? "Cartão" : "Manual") + "</td><td>" + A.dinheiro(p.valor) + "</td><td>" + st + "</td></tr>";
      }).join("") + "</tbody></table></div>" : "Nenhum pagamento ainda.";
    }).catch(function () { $("#as-hist").textContent = ""; });
  }
  // confere a cada 5 s se o Mercado Pago já confirmou (o servidor libera sozinho)
  function esperarPagamento() {
    if (vigiaPix) clearInterval(vigiaPix);
    var antes = new Date(E.valido_ate).getTime(), voltas = 0;
    vigiaPix = setInterval(function () {
      if (++voltas > 240) { clearInterval(vigiaPix); vigiaPix = null; return; }
      q(sb.from("empresas").select("*").eq("id", E.id).single()).then(function (n) {
        if (new Date(n.valido_ate).getTime() > antes && n.status === "ativa") {
          clearInterval(vigiaPix); vigiaPix = null; E = n;
          A.avisar("✅ Pagamento confirmado! Acesso liberado até " + A.data(n.valido_ate), "ok");
          location.hash = "#criar"; rota();
        }
      }).catch(function () {});
    }, 5000);
  }

  iniciar();
})();
