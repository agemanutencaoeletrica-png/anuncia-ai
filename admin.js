// Anuncia Aí — painel do dono: empresas clientes, cobrança, avisos e planos.
(function () {
  "use strict";
  var A = window.AN, esc = A.esc, $ = A.$, $$ = A.$$;
  var app = $("#app"), sb = null, S = { emp: [], pag: [], av: [], planos: [] }, filtro = "todas", busca = "";

  function q(p) { return p.then(function (r) { if (r.error) throw r.error; return r.data; }); }

  function iniciar() {
    if (!A.configurado()) { A.telaSemConfig(app); return; }
    try { sb = A.cliente(); } catch (e) { app.innerHTML = '<div class="entrada aviso erro">' + esc(A.msgErro(e)) + "</div>"; return; }
    sb.auth.onAuthStateChange(function (ev) { if (ev === "SIGNED_OUT") telaLogin(); });
    sb.auth.getSession().then(function (r) { if (r.data && r.data.session) entrar(); else telaLogin(); }).catch(function () { telaLogin(); });
  }
  function telaLogin(msg) {
    app.innerHTML = '<div class="entrada"><div class="logo-g">Anuncia <span>Aí</span></div><p class="mudo" style="text-align:center">Painel do dono</p>' +
      '<form class="cartao" id="f-login"><label for="l-email">E-mail</label><input id="l-email" type="email" autocapitalize="none" autocomplete="username" required>' +
      A.campoSenha("l-senha", "Senha", "current-password") + '<div id="l-msg">' + (msg ? '<div class="aviso erro">' + esc(msg) + "</div>" : "") +
      '</div><div class="acoes"><button class="prim" type="submit">Entrar</button></div></form></div>';
    A.ligarVerSenha(app);
    $("#f-login").onsubmit = function (ev) {
      ev.preventDefault(); var b = $("button[type=submit]", this); A.ocupado(b, true, "Entrando...");
      sb.auth.signInWithPassword({ email: $("#l-email").value.trim().toLowerCase(), password: $("#l-senha").value }).then(function (r) { if (r.error) throw r.error; return entrar(); })
        .catch(function (e) { A.ocupado(b, false); $("#l-msg").innerHTML = '<div class="aviso erro">' + esc(A.msgErro(e)) + "</div>"; });
    };
  }
  function entrar() {
    return q(sb.rpc("eh_admin")).then(function (ok) {
      if (!ok) return sb.auth.signOut().then(function () { telaLogin("Este e-mail não é do dono do Anuncia Aí (tabela admins)."); });
      return carregar().then(montar);
    }).catch(function (e) { telaLogin(A.msgErro(e)); });
  }
  function carregar() {
    return Promise.all([
      q(sb.from("empresas").select("*").order("valido_ate")),
      q(sb.from("pagamentos").select("*").order("criado_em", { ascending: false }).limit(1000)),
      q(sb.from("avisos").select("*").order("enviado_em", { ascending: false }).limit(500)),
      q(sb.from("planos").select("*").order("ordem"))
    ]).then(function (r) { S.emp = r[0]; S.pag = r[1]; S.av = r[2]; S.planos = r[3]; });
  }
  function montar() {
    app.innerHTML = '<div class="topo"><div class="marca">Anuncia <span>Aí</span></div><div class="peq">Painel do dono</div><div class="dir"><button class="peq" id="b-rec">↻</button><button class="peq" id="b-sair">Sair</button></div></div>' +
      '<nav class="abas" id="abas"></nav><main id="conteudo"></main>';
    $("#b-sair").onclick = function () { sb.auth.signOut(); };
    $("#b-rec").onclick = function () { carregar().then(function () { rota(); A.avisar("Atualizado"); }); };
    window.addEventListener("hashchange", rota); rota();
  }
  var ABAS = [["empresas", "Empresas"], ["pagamentos", "Pagamentos"], ["avisos", "Avisos enviados"], ["planos", "Planos"]];
  function rota() {
    var aba = location.hash.slice(1) || "empresas"; if (!ABAS.some(function (a) { return a[0] === aba; })) aba = "empresas";
    $("#abas").innerHTML = ABAS.map(function (a) { return '<a href="#' + a[0] + '" class="' + (a[0] === aba ? "ativa" : "") + '">' + a[1] + "</a>"; }).join("");
    ({ empresas: verEmpresas, pagamentos: verPagamentos, avisos: verAvisos, planos: verPlanos })[aba]($("#conteudo"));
  }
  function nomePlano(id) { var p = S.planos.filter(function (x) { return x.id === id; })[0]; return p ? p.nome : id || "—"; }
  function selo(e) {
    var s = A.situacao(e);
    if (e.status === "cancelada") return '<span class="selo">cancelada</span>';
    if (s.bloqueada) return '<span class="selo critico">bloqueada</span>';
    if (s.teste) return '<span class="selo atencao">teste · ' + s.dias + "d</span>";
    if (s.dias <= 5 && !s.cartao) return '<span class="selo atencao">vence em ' + s.dias + "d</span>";
    return '<span class="selo bom">ativa' + (s.cartao ? " · cartão" : "") + "</span>";
  }
  function msgCobranca(e) {
    var s = A.situacao(e), app = location.href.replace(/admin\.html.*$/, "app.html#assinatura");
    return "Olá, " + e.nome + "! Aqui é do Anuncia Aí. " + (s.bloqueada ? "Seu acesso está pausado por falta de pagamento." :
      (s.teste ? "Seu teste grátis termina em " : "Sua assinatura vence em ") + A.data(e.valido_ate) + ".") + " Para pagar (Pix ou cartão): " + app;
  }

  function verEmpresas(c) {
    var agora = Date.now(), ativos = S.emp.filter(function (e) { return A.situacao(e).liberado && e.status === "ativa"; });
    var receita = ativos.reduce(function (t, e) { var p = S.planos.filter(function (x) { return x.id === e.plano; })[0]; return t + (p ? p.preco / p.meses : 0); }, 0);
    var mes = new Date(); mes.setDate(1); mes.setHours(0, 0, 0, 0);
    var recebido = S.pag.filter(function (p) { return p.status === "approved" && new Date(p.pago_em || p.criado_em) >= mes; }).reduce(function (t, p) { return t + Number(p.valor || 0); }, 0);
    var vencendo = S.emp.filter(function (e) { var s = A.situacao(e); return s.liberado && s.dias <= 5; });
    c.innerHTML = '<div class="grade">' +
      lad("Empresas", S.emp.length, "cadastradas") + lad("Pagantes", ativos.length, "ativas") + lad("Em teste", S.emp.filter(function (e) { return A.situacao(e).liberado && e.status === "teste"; }).length, "grátis") +
      lad("Bloqueadas", S.emp.filter(function (e) { return A.situacao(e).bloqueada; }).length, "sem pagar") + lad("Receita/mês", A.dinheiro(receita), "estimada") + lad("Recebido", A.dinheiro(recebido), "neste mês") + "</div>" +
      (vencendo.length ? '<div class="aviso">⏰ <b>' + vencendo.length + "</b> empresa(s) vencem nos próximos 5 dias. Os avisos automáticos saem por e-mail/WhatsApp; use 📲 para mandar um lembrete seu.</div>" : "") +
      '<div class="cartao"><div class="linha" style="margin-bottom:8px"><select id="fe-f" style="width:auto"><option value="todas">Todas</option><option value="vencendo">Vencem em até 5 dias</option>' +
      '<option value="teste">Em teste</option><option value="ativas">Ativas</option><option value="bloqueadas">Bloqueadas</option></select><input id="fe-b" type="search" placeholder="Buscar nome, e-mail, cidade" style="flex:1"></div>' +
      '<div class="tabela"><table><thead><tr><th>Empresa</th><th>Situação</th><th>Vence</th><th>Plano</th><th>Contato</th></tr></thead><tbody id="fe-l"></tbody></table></div></div>';
    $("#fe-f").value = filtro; $("#fe-b").value = busca;
    $("#fe-f").onchange = function () { filtro = this.value; listar(); };
    $("#fe-b").oninput = function () { busca = this.value.toLowerCase(); listar(); };
    function listar() {
      var l = S.emp.filter(function (e) {
        var s = A.situacao(e);
        if (filtro === "vencendo" && !(s.liberado && s.dias <= 5)) return false;
        if (filtro === "teste" && !(s.liberado && e.status === "teste")) return false;
        if (filtro === "ativas" && !(s.liberado && e.status === "ativa")) return false;
        if (filtro === "bloqueadas" && !s.bloqueada) return false;
        return !busca || [e.nome, e.email, e.cidade, e.ramo].join(" ").toLowerCase().indexOf(busca) >= 0;
      });
      $("#fe-l").innerHTML = l.length ? l.map(function (e) {
        return '<tr class="clic" data-emp="' + e.id + '"><td><b>' + esc(e.nome) + '</b><div class="mudo peq">' + esc(e.email) + (e.cidade ? " · " + esc(e.cidade) : "") + "</div></td><td>" + selo(e) +
          "</td><td>" + A.data(e.valido_ate) + "</td><td>" + esc(nomePlano(e.plano)) + "</td><td>" +
          (e.whatsapp ? '<a class="botao peq zap" target="_blank" rel="noopener" data-para="1" href="' + esc(A.linkZap(e.whatsapp, msgCobranca(e))) + '">📲</a> ' : "") +
          '<a class="botao peq" data-para="1" href="mailto:' + esc(e.email) + "?subject=" + encodeURIComponent("Anuncia Aí — sua assinatura") + "&body=" + encodeURIComponent(msgCobranca(e)) + '">✉</a></td></tr>';
      }).join("") : '<tr><td colspan="5" class="vazio">Nenhuma empresa.</td></tr>';
      $$("[data-para]").forEach(function (a) { a.onclick = function (ev) { ev.stopPropagation(); }; });
      $$("[data-emp]").forEach(function (t) { t.onclick = function () { abrirEmpresa(t.dataset.emp); }; });
    }
    listar();
  }
  function lad(r, v, d) { return '<div class="ladrilho"><div class="r">' + r + '</div><div class="v">' + v + '</div><div class="d">' + d + "</div></div>"; }

  function abrirEmpresa(id) {
    var e = S.emp.filter(function (x) { return x.id === id; })[0];
    var pags = S.pag.filter(function (p) { return p.empresa_id === id; }), avs = S.av.filter(function (a) { return a.empresa_id === id; });
    var j = A.janela('<div class="linha">' + selo(e) + '<span class="mudo peq">cliente desde ' + A.data(e.criado_em) + "</span></div>" +
      '<p><b>' + esc(e.email) + "</b>" + (e.whatsapp ? " · " + esc(e.whatsapp) : "") + (e.instagram ? " · " + esc(e.instagram) : "") + "<br>" + esc([e.ramo, e.cidade].filter(Boolean).join(" · ")) + "</p>" +
      '<p>Válido até <b>' + A.dataHora(e.valido_ate) + "</b> · plano " + esc(nomePlano(e.plano)) + " · " + (e.metodo === "cartao" ? "cartão (automático)" : e.metodo === "pix" ? "Pix" : "sem forma de pagamento") + "</p>" +
      '<div class="acoes"><button data-dias="7">+7 dias</button><button data-dias="30">+30 dias</button><button class="bom" id="em-lib">Liberar</button><button class="perigo" id="em-blq">Bloquear</button></div>' +
      '<label for="em-obs">Anotação (só você vê)</label><textarea id="em-obs" rows="2">' + esc(e.observacao || "") + '</textarea><button class="peq" id="em-sobs" style="margin-top:6px">Salvar anotação</button>' +
      "<h3 style='margin-top:16px'>Pagamentos</h3>" + (pags.length ? '<div class="tabela"><table><tbody>' + pags.map(function (p) {
        return "<tr><td>" + A.dataHora(p.pago_em || p.criado_em) + "</td><td>" + esc(p.tipo) + "</td><td>" + A.dinheiro(p.valor) + "</td><td>" + esc(p.status) + (p.aplicado ? " ✔" : "") + "</td></tr>";
      }).join("") + "</tbody></table></div>" : '<p class="mudo peq">Nenhum.</p>') +
      "<h3 style='margin-top:16px'>Avisos enviados</h3>" + (avs.length ? '<div class="tabela"><table><tbody>' + avs.map(function (a) {
        return "<tr><td>" + A.dataHora(a.enviado_em) + "</td><td>" + esc(a.tipo) + "</td><td>" + esc(a.canal) + "</td><td>" + (a.ok ? '<span class="selo bom">enviado</span>' : '<span class="selo critico">' + esc(a.erro || "falhou") + "</span>") + "</td></tr>";
      }).join("") + "</tbody></table></div>" : '<p class="mudo peq">Nenhum.</p>'), { titulo: e.nome, larga: true });
    var el = j.el;
    function salvar(dados, msg) {
      return q(sb.from("empresas").update(dados).eq("id", id).select().single()).then(function (n) {
        S.emp = S.emp.map(function (x) { return x.id === id ? n : x; }); j.fechar(); A.avisar(msg, "ok"); rota(); abrirEmpresa(id);
      }).catch(function (er) { A.avisar(A.msgErro(er), "erro"); });
    }
    $$("[data-dias]", el).forEach(function (b) {
      b.onclick = function () {
        var base = Math.max(Date.now(), new Date(e.valido_ate).getTime()), n = new Date(base + Number(b.dataset.dias) * A.DIA);
        if (!window.confirm("Dar +" + b.dataset.dias + " dias para " + e.nome + "?")) return;
        salvar({ valido_ate: n.toISOString(), status: e.status === "teste" ? "teste" : "ativa" }, "+" + b.dataset.dias + " dias");
      };
    });
    $("#em-lib", el).onclick = function () { salvar({ status: "ativa", valido_ate: new Date(Math.max(Date.now() + A.DIA, new Date(e.valido_ate).getTime())).toISOString() }, "Liberada"); };
    $("#em-blq", el).onclick = function () { if (window.confirm("Bloquear " + e.nome + " agora?")) salvar({ status: "bloqueada" }, "Bloqueada"); };
    $("#em-sobs", el).onclick = function () { salvar({ observacao: $("#em-obs", el).value.trim() || null }, "Anotação salva"); };
  }

  function verPagamentos(c) {
    var nome = function (id) { var e = S.emp.filter(function (x) { return x.id === id; })[0]; return e ? e.nome : "—"; };
    c.innerHTML = '<div class="cartao"><h2>Pagamentos</h2><div class="tabela" style="margin-top:10px"><table><thead><tr><th>Data</th><th>Empresa</th><th>Forma</th><th>Valor</th><th>Situação</th></tr></thead><tbody>' +
      (S.pag.length ? S.pag.map(function (p) {
        return "<tr><td>" + A.dataHora(p.pago_em || p.criado_em) + "</td><td>" + esc(nome(p.empresa_id)) + "</td><td>" + esc(p.tipo) + "</td><td>" + A.dinheiro(p.valor) + "</td><td>" +
          (p.status === "approved" ? '<span class="selo bom">pago</span>' : '<span class="selo">' + esc(p.status) + "</span>") + "</td></tr>";
      }).join("") : '<tr><td colspan="5" class="vazio">Nenhum pagamento ainda.</td></tr>') + "</tbody></table></div></div>";
  }
  function verAvisos(c) {
    var nome = function (id) { var e = S.emp.filter(function (x) { return x.id === id; })[0]; return e ? e.nome : "—"; };
    var rot = { d5: "5 dias antes", d3: "3 dias antes", d1: "véspera", bloqueio: "bloqueio", cartao_falhou: "cartão não passou" };
    c.innerHTML = '<div class="cartao"><h2>Avisos enviados</h2><p class="mudo peq">A cobrança diária avisa 5, 3 e 1 dia antes do vencimento e no bloqueio, por e-mail e WhatsApp (se configurado).</p>' +
      '<div class="tabela"><table><thead><tr><th>Quando</th><th>Empresa</th><th>Aviso</th><th>Canal</th><th>Resultado</th></tr></thead><tbody>' +
      (S.av.length ? S.av.map(function (a) {
        return "<tr><td>" + A.dataHora(a.enviado_em) + "</td><td>" + esc(nome(a.empresa_id)) + "</td><td>" + esc(rot[a.tipo] || a.tipo) + "</td><td>" + esc(a.canal) + "</td><td>" +
          (a.ok ? '<span class="selo bom">enviado</span>' : '<span class="selo critico">' + esc(a.erro || "falhou") + "</span>") + "</td></tr>";
      }).join("") : '<tr><td colspan="5" class="vazio">Nenhum aviso ainda.</td></tr>') + "</tbody></table></div></div>";
  }
  function verPlanos(c) {
    c.innerHTML = '<div class="cartao"><h2>Planos e preços</h2><p class="mudo peq">Novos pagamentos usam o preço daqui. Quem já assina no cartão continua no valor da assinatura dele.</p>' +
      S.planos.map(function (p) {
        return '<div class="linha" style="margin-top:10px"><b style="width:160px">' + esc(p.nome) + '</b><label style="margin:0">R$</label><input data-preco="' + esc(p.id) + '" value="' + String(p.preco).replace(".", ",") +
          '" inputmode="decimal" style="width:120px"><span class="mudo peq">' + (p.meses === 1 ? "por mês" : "a cada " + p.meses + " meses") + '</span><label class="marca-linha" style="margin:0"><input type="checkbox" data-ativo="' +
          esc(p.id) + '"' + (p.ativo ? " checked" : "") + "> ativo</label></div>";
      }).join("") + '<div class="acoes"><button class="prim" id="pl-salvar">Salvar preços</button></div></div>';
    $("#pl-salvar").onclick = function () {
      var b = this; A.ocupado(b, true, "Salvando...");
      Promise.all(S.planos.map(function (p) {
        var t = String($('[data-preco="' + p.id + '"]').value).trim(), v = Number(t.indexOf(",") >= 0 ? t.replace(/\./g, "").replace(",", ".") : t);
        if (!(v > 0)) throw new Error("Preço inválido em " + p.nome);
        return q(sb.from("planos").update({ preco: v, ativo: $('[data-ativo="' + p.id + '"]').checked }).eq("id", p.id).select().single());
      })).then(function (ns) { S.planos = ns; A.ocupado(b, false); A.avisar("Preços salvos", "ok"); }).catch(function (e) { A.ocupado(b, false); A.avisar(A.msgErro(e), "erro"); });
    };
  }

  iniciar();
})();
