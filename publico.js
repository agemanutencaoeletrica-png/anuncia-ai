// Páginas públicas da 🤝 Comunidade Anuncia Aí: vitrine de uma empresa (vitrine.html?e=endereco)
// e o guia por cidade e ramo (guia.html). Só leem pelas funções públicas do banco
// (vitrine_publica, guia, guia_filtros): nada de e-mail, pagamento ou situação da assinatura.
(function () {
  "use strict";
  var A = window.AN, esc = A.esc, $ = A.$, CFG = A.CFG;

  function rpc(nome, args) {
    return fetch(CFG.SUPABASE_URL + "/rest/v1/rpc/" + nome, {
      method: "POST", headers: { "Content-Type": "application/json", apikey: CFG.SUPABASE_ANON_KEY, Authorization: "Bearer " + CFG.SUPABASE_ANON_KEY },
      body: JSON.stringify(args || {})
    }).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error((j && j.message) || "Erro " + r.status); return j; }); });
  }
  function urlPub(bucket, caminho) {
    return caminho ? CFG.SUPABASE_URL + "/storage/v1/object/public/" + bucket + "/" + String(caminho).split("/").map(encodeURIComponent).join("/") : "";
  }
  function urlVitrine(slug) { return new URL("vitrine.html?e=" + encodeURIComponent(slug), location.href).href; }
  function urlInsta(i) { var u = String(i || "").trim().replace(/^@/, ""); return /^https?:/.test(u) ? u : "https://instagram.com/" + encodeURIComponent(u); }
  function urlSite(s) { s = String(s || "").trim(); return /^https?:\/\//i.test(s) ? s : "https://" + s; }
  function cor(c, padrao) { return /^#[0-9a-fA-F]{6}$/.test(c || "") ? c : padrao; }
  function local(c) { return [c.ramo, [c.bairro, c.cidade].filter(Boolean).join(" · ")].filter(Boolean).join(" — "); }
  // 🗺️ mapa grátis (OpenStreetMap + Leaflet, sem chave); "Como chegar" e "Ver no Google" abrem o Google Maps
  var leaflet = null;
  function carregarMapa() {
    if (window.L && window.L.map) return Promise.resolve(window.L);
    if (!leaflet) leaflet = new Promise(function (ok, falha) {
      var css = document.createElement("link"); css.rel = "stylesheet"; css.href = "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css"; document.head.appendChild(css);
      var sc = document.createElement("script"); sc.src = "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js";
      sc.onload = function () { window.L ? ok(window.L) : falha(new Error("Mapa indisponível.")); };
      sc.onerror = function () { leaflet = null; sc.remove(); falha(new Error("Mapa indisponível sem internet.")); };
      document.head.appendChild(sc);
    });
    return leaflet;
  }
  function novoMapa(el, lat, lng, zoom) {
    return carregarMapa().then(function (L) {
      var m = L.map(el, { scrollWheelZoom: false }).setView([lat, lng], zoom || 14);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(m);
      return { L: L, m: m };
    });
  }
  function temLocal(c) { return c && c.lat !== null && c.lat !== undefined && c.lng !== null && c.lng !== undefined; }
  function linkGoogle(c) {
    return temLocal(c) && c.exato ? "https://www.google.com/maps/search/?api=1&query=" + c.lat + "," + c.lng
      : "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent([c.nome, c.endereco, c.bairro, c.cidade].filter(Boolean).join(", "));
  }
  // rota no Google Maps: até o ponto exato; quem mostra só a região leva ao bairro/cidade (ou ao ponto aproximado)
  function linkRota(c) {
    var reg = [c.bairro, c.cidade].filter(Boolean).join(", ");
    return "https://www.google.com/maps/dir/?api=1&destination=" + (c.exato && temLocal(c) ? c.lat + "," + c.lng : reg ? encodeURIComponent(reg) : temLocal(c) ? c.lat + "," + c.lng : encodeURIComponent(c.nome));
  }
  function km(v) { return Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " km"; }
  // 🔗 redes sociais: aceita o link completo ou só o @usuário
  var REDES = [["facebook", "Facebook", "📘"], ["tiktok", "TikTok", "🎵"], ["youtube", "YouTube", "▶️"], ["telegram", "Telegram", "✈️"], ["kwai", "Kwai", "🎬"],
    ["threads", "Threads", "🧵"], ["linkedin", "LinkedIn", "💼"], ["x", "X (Twitter)", "✖️"], ["pinterest", "Pinterest", "📌"]];
  var BASE_REDE = { facebook: "https://www.facebook.com/", tiktok: "https://www.tiktok.com/@", youtube: "https://www.youtube.com/@", telegram: "https://t.me/",
    kwai: "https://www.kwai.com/@", threads: "https://www.threads.net/@", linkedin: "https://www.linkedin.com/company/", x: "https://x.com/", pinterest: "https://www.pinterest.com/" };
  function urlRede(k, v) { v = String(v || "").trim(); if (!v) return ""; return /^https?:\/\//i.test(v) ? v : (BASE_REDE[k] || "https://") + encodeURIComponent(v.replace(/^@/, "")); }
  function curto(u) { return String(u || "").replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, ""); }
  // todos os links da empresa, na ordem em que aparecem (WhatsApp primeiro)
  function linksDe(c) {
    var ls = [], r = c.redes || {};
    if (c.whatsapp) ls.push({ ic: "💬", nome: "WhatsApp", url: A.linkZap(c.whatsapp, msgZap(c)), mostra: c.whatsapp, zap: true });
    if (c.instagram) ls.push({ ic: "📷", nome: "Instagram", url: urlInsta(c.instagram), mostra: "@" + String(c.instagram).replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/\/$/, "") });
    REDES.forEach(function (x) { if (r[x[0]]) ls.push({ ic: x[2], nome: x[1], url: urlRede(x[0], r[x[0]]), mostra: /^https?:/i.test(r[x[0]]) ? curto(r[x[0]]) : "@" + String(r[x[0]]).replace(/^@/, "") }); });
    if (c.site) ls.push({ ic: "🌐", nome: "Site", url: urlSite(c.site), mostra: curto(urlSite(c.site)) });
    if (c.maps_url) ls.push({ ic: "⭐", nome: "Google Maps (avaliações)", url: c.maps_url, mostra: "Ver no Google" });
    return ls;
  }
  // mensagem pronta para grupos de WhatsApp, Facebook e Telegram
  function textoDivulgar(c) {
    var t = "⭐ *" + c.nome + "*" + (local(c) ? "\n" + local(c) : "") + (c.descricao ? "\n\n" + String(c.descricao).slice(0, 220) : "") + "\n";
    linksDe(c).forEach(function (l) { t += "\n" + l.ic + " " + l.nome + ": " + (l.zap ? "wa.me/" + (function (n) { return n.length <= 11 ? "55" + n : n; })(A.soDigitos(c.whatsapp)) : l.nome === "Google Maps (avaliações)" ? l.url : curto(l.url)); });
    return t + "\n\n👉 Todos os links e novidades: " + urlVitrine(c.slug);
  }
  // botões de divulgar: WhatsApp (grupos e contatos), Facebook, Telegram, copiar e QR Code
  function htmlDivulgar(pref) {
    return '<div class="acoes" style="margin-top:8px"><a class="botao zap" id="' + pref + '-zap" target="_blank" rel="noopener">💬 Enviar no WhatsApp</a><a class="botao" id="' + pref + '-fb" target="_blank" rel="noopener">📘 Facebook</a>' +
      '<a class="botao" id="' + pref + '-tg" target="_blank" rel="noopener">✈️ Telegram</a><button id="' + pref + '-copiar">📋 Copiar mensagem</button><button id="' + pref + '-link">🔗 Copiar link</button><button id="' + pref + '-qr">🔳 QR Code</button>' +
      (navigator.share ? '<button id="' + pref + '-mais" title="Instagram, Status, e-mail, SMS e outros apps do aparelho">📲 Outros apps</button>' : "") + "</div>";
  }
  var qrPronto = null;
  function carregarQr() {
    if (window.qrcode) return Promise.resolve(window.qrcode);
    if (!qrPronto) qrPronto = new Promise(function (ok, falha) {
      var sc = document.createElement("script"); sc.src = "https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js";
      sc.onload = function () { window.qrcode ? ok(window.qrcode) : falha(new Error("QR indisponível.")); };
      sc.onerror = function () { qrPronto = null; sc.remove(); falha(new Error("Sem internet para gerar o QR Code.")); };
      document.head.appendChild(sc);
    });
    return qrPronto;
  }
  function ligarDivulgar(raiz, pref, c, texto) {
    var link = urlVitrine(c.slug), txt = function () { return typeof texto === "function" ? texto() : texto || textoDivulgar(c); };
    var zap = raiz.querySelector("#" + pref + "-zap"), fb = raiz.querySelector("#" + pref + "-fb"), tg = raiz.querySelector("#" + pref + "-tg");
    function atualizar() {
      zap.href = "https://wa.me/?text=" + encodeURIComponent(txt());
      fb.href = "https://www.facebook.com/sharer/sharer.php?u=" + encodeURIComponent(link);
      tg.href = "https://t.me/share/url?url=" + encodeURIComponent(link) + "&text=" + encodeURIComponent(txt().replace(/\n*👉[^\n]*$/, ""));
    }
    atualizar(); [zap, fb, tg].forEach(function (a) { a.addEventListener("click", atualizar); });
    raiz.querySelector("#" + pref + "-copiar").onclick = function () { A.copiar(txt(), "Mensagem copiada: cole no grupo"); };
    raiz.querySelector("#" + pref + "-link").onclick = function () { A.copiar(link, "Link copiado"); };
    // 📲 a janela de compartilhar do aparelho: Instagram (Direct), Status, e-mail, SMS, Messenger...
    var mais = raiz.querySelector("#" + pref + "-mais");
    if (mais) mais.onclick = function () { A.copiar(txt(), "Mensagem copiada"); navigator.share({ title: c.nome, text: txt() }).catch(function () { /* fechou: a mensagem já está copiada */ }); };
    raiz.querySelector("#" + pref + "-qr").onclick = function () {
      var b = this; A.ocupado(b, true, "Gerando...");
      carregarQr().then(function (Q) {
        A.ocupado(b, false);
        var qr = Q(0, "M"); qr.addData(link); qr.make();
        var img = qr.createDataURL(8, 4);
        var j = A.janela('<p class="peq mudo" style="margin-top:0">Imprima no cartão de visita, na placa da obra, no adesivo do carro ou no orçamento: quem aponta a câmera do celular abre a sua vitrine.</p>' +
          '<div style="text-align:center"><img id="qr-img" alt="QR Code da vitrine" src="' + img + '" style="width:260px;max-width:80vw;image-rendering:pixelated;background:#fff;padding:8px;border-radius:12px"></div>' +
          '<p class="peq" style="text-align:center;word-break:break-all">' + esc(link) + '</p><div class="acoes" style="justify-content:center"><a class="botao prim" download="qrcode-' + esc(c.slug) + '.gif" href="' + img + '">⬇ Baixar QR Code</a></div>', { titulo: "🔳 QR Code de " + c.nome });
        void j;
      }).catch(function (e) { A.ocupado(b, false); A.avisar(A.msgErro(e), "erro"); });
    };
  }
  // 🏛️ convite para a comunidade (vitrine, guia e site)
  function htmlConvite() {
    return '<section class="convite"><div class="convite-sel">Comunidade Anuncia Aí</div><h2>Venha fazer parte da nossa rede</h2>' +
      "<p>Reunimos empresas que acreditam no trabalho bem feito e na força da boa indicação. Aqui, cada negócio tem a sua vitrine, é encontrado por quem está perto " +
      "e caminha ao lado de parceiros que se recomendam.</p><ul>" +
      "<li><b>Uma vitrine elegante</b>, com seus links, mapa, avaliações e novidades</li>" +
      "<li><b>Parceiros que indicam você</b>, e você a eles, entre quem se completa</li>" +
      "<li><b>Presença no Guia da sua cidade</b> e no “Perto de mim” de quem procura</li>" +
      "<li><b>Artes profissionais</b> para divulgar nas redes em um minuto</li></ul>" +
      '<div class="acoes"><a class="botao dest" href="' + esc(new URL("app.html", location.href).href) + '">Quero fazer parte · 7 dias grátis</a>' +
      '<a class="botao" href="' + esc(new URL("index.html", location.href).href) + '">Conhecer o Anuncia Aí</a></div></section>';
  }
  // convite que uma empresa manda para um parceiro (WhatsApp)
  function textoConvite(c) {
    return "Olá! Tudo bem?\n\nAqui é da *" + c.nome + "*. Fazemos parte da *Comunidade Anuncia Aí*, uma rede de empresas da região que se apoiam e se recomendam, e lembramos de você pelo trabalho sério que faz.\n\n" +
      "Lá cada empresa tem uma vitrine profissional, aparece no Guia da cidade e no “Perto de mim” de quem procura, e cria artes para as redes em um minuto.\n\n" +
      "Seria uma alegria ter a sua empresa como parceira e recomendar o seu trabalho na nossa página.\n\n" +
      "✨ Conheça e teste 7 dias grátis: " + new URL("index.html", location.href).href + (c.slug ? "\n🔗 Nossa vitrine: " + urlVitrine(c.slug) : "");
  }
  function msgZap(c) { return "Olá, " + c.nome + "! Vi vocês no Guia Anuncia Aí e gostaria de um orçamento."; }

  // cartão de empresa (guia e "Recomendamos")
  function cartaoEmpresa(c) {
    var img = c.arte ? urlPub("vitrine", c.arte) : c.logo ? urlPub("logos", c.logo) : "";
    return '<div class="emp-cartao"><a class="emp-img" href="' + esc(urlVitrine(c.slug)) + '" style="background:' + esc(cor(c.cor1, "#7c3aed")) + '">' +
      (img ? '<img loading="lazy" alt="" src="' + esc(img) + '"' + (c.arte ? "" : ' class="so-logo"') + ">" : '<span class="emp-ini">' + esc(String(c.nome || "?").charAt(0)) + "</span>") + "</a>" +
      '<div class="emp-txt"><a class="forte" href="' + esc(urlVitrine(c.slug)) + '">' + esc(c.nome) + '</a><div class="peq mudo">' + esc(local(c)) + "</div>" +
      (c.distancia_km !== undefined ? '<div class="peq forte">📍 a ' + esc(km(c.distancia_km)) + (c.exato ? "" : " (região)") + "</div>" : "") +
      (c.descricao ? '<div class="peq">' + esc(String(c.descricao).slice(0, 140)) + (String(c.descricao).length > 140 ? "…" : "") + "</div>" : "") +
      '<div class="acoes" style="margin-top:8px">' + (c.whatsapp ? '<a class="botao peq zap" target="_blank" rel="noopener" href="' + esc(A.linkZap(c.whatsapp, msgZap(c))) + '">💬 WhatsApp</a>' : "") +
      '<a class="botao peq" href="' + esc(urlVitrine(c.slug)) + '">Ver vitrine</a></div></div></div>';
  }

  // ---------- vitrine de uma empresa ----------
  function verVitrine(alvo) {
    var slug = new URLSearchParams(location.search).get("e") || "";
    if (!slug) { location.replace("guia.html"); return; }
    rpc("vitrine_publica", { p_slug: slug }).then(function (v) {
      if (!v) { alvo.innerHTML = '<main><div class="cartao vazio">Esta vitrine não está disponível. <a href="guia.html">Ver o Guia Anuncia Aí</a></div></main>'; return; }
      var c1 = cor(v.cor1, "#7c3aed"), c2 = cor(v.cor2, "#f59e0b");
      document.title = v.nome + " — " + (v.ramo || "Vitrine") + (v.cidade ? " em " + v.cidade : "") + " | Anuncia Aí";
      var md = document.querySelector('meta[name="description"]'); if (md) md.setAttribute("content", (v.descricao || local(v) || v.nome).slice(0, 160));
      alvo.innerHTML = '<header class="vit-topo" style="background:linear-gradient(130deg,' + esc(c1) + "," + esc(c1) + " 55%," + esc(c2) + ')">' +
        (v.logo ? '<img class="vit-logo" alt="Logo de ' + esc(v.nome) + '" src="' + esc(urlPub("logos", v.logo)) + '">' : "") +
        "<h1>" + esc(v.nome) + "</h1>" + (local(v) ? "<p>" + esc(local(v)) + "</p>" : "") +
        (Number(v.recomendada_por) ? '<p class="vit-rec">🤝 Recomendada por ' + Number(v.recomendada_por) + " empresa" + (Number(v.recomendada_por) > 1 ? "s" : "") + " da comunidade</p>" : "") +
        '<div class="acoes" style="justify-content:center">' + (v.whatsapp ? '<a class="botao zap" target="_blank" rel="noopener" href="' + esc(A.linkZap(v.whatsapp, msgZap(v))) + '">💬 Chamar no WhatsApp</a>' : "") +
        (v.instagram ? '<a class="botao" target="_blank" rel="noopener" href="' + esc(urlInsta(v.instagram)) + '">📷 Instagram</a>' : "") +
        (v.maps_url ? '<a class="botao" target="_blank" rel="noopener" href="' + esc(v.maps_url) + '">⭐ Avaliações no Google</a>' : "") +
        '<button class="botao" id="vt-comp">📤 Compartilhar</button></div></header><main>' +
        (v.descricao ? '<div class="cartao" style="white-space:pre-wrap">' + esc(v.descricao) + "</div>" : "") +
        (linksDe(v).length ? '<div class="cartao"><h2 style="margin-bottom:8px">🔗 Nossos links</h2><div class="links-lista">' + linksDe(v).map(function (l) {
          return '<a class="link-linha' + (l.zap ? " zap" : "") + '" target="_blank" rel="noopener" href="' + esc(l.url) + '"><span class="ic">' + l.ic + '</span><span><b>' + esc(l.nome) + '</b><small>' + esc(l.mostra) + "</small></span><span class=\"seta\">›</span></a>";
        }).join("") + "</div></div>" : "") +
        (temLocal(v) || v.endereco ? '<div class="cartao"><h2 style="margin-bottom:6px">📍 ' + (v.exato ? "Onde estamos" : "Região de atendimento") + "</h2>" +
          '<p class="peq mudo" style="margin:0 0 8px">' + esc(v.exato ? [v.endereco, v.bairro, v.cidade].filter(Boolean).join(" · ") : "Atende " + [v.bairro, v.cidade].filter(Boolean).join(" · ") + (v.raio_km ? " e até " + v.raio_km + " km" : "")) + "</p>" +
          (temLocal(v) ? '<div id="vt-mapa" class="mapa clicavel" title="Toque para abrir a rota no Google Maps"></div><p class="peq mudo" style="margin:4px 0 0">👆 Toque no mapa para abrir a rota até ' + (v.exato ? "o endereço" : "a região") + " no Google Maps.</p>" : "") +
          '<div class="acoes"><a class="botao" target="_blank" rel="noopener" href="' + esc(linkGoogle(v)) + '">🗺️ Ver no Google Maps</a>' +
          '<a class="botao" target="_blank" rel="noopener" href="' + esc(linkRota(v)) + '">🧭 Como chegar' + (v.exato ? "" : " (região)") + "</a></div></div>" : "") +
        ((v.artes || []).length ? '<h2 style="margin:6px 0 10px">Novidades e promoções</h2><div class="artes-grade">' + v.artes.map(function (a, n) {
          return '<button class="arte-mini" data-arte="' + n + '"><img loading="lazy" alt="' + esc(String(a.legenda || "Arte de " + v.nome).slice(0, 120)) + '" src="' + esc(urlPub("vitrine", a.caminho)) + '"></button>';
        }).join("") + "</div>" : "") +
        ((v.parceiros || []).length ? '<h2 style="margin:18px 0 10px">🤝 Recomendamos</h2><div class="emp-grade">' + v.parceiros.map(cartaoEmpresa).join("") + "</div>" : "") +
        '<div class="cartao" style="margin-top:14px"><h2>📤 Divulgue ' + esc(v.nome) + '</h2><p class="peq mudo" style="margin:4px 0 0">Mande no WhatsApp (contatos, grupos e status), Facebook, Telegram, Instagram ou onde preferir: vai a mensagem com todos os links.</p>' + htmlDivulgar("vd") + "</div>" +
        htmlConvite() +
        '<p class="mudo peq" style="text-align:center;margin-top:22px"><a href="guia.html' + (v.cidade ? "?cidade=" + encodeURIComponent(v.cidade) : "") + '">🗺️ Mais empresas' + (v.cidade ? " em " + esc(v.cidade) : "") + "</a> · " +
        '<a href="index.html">Crie a vitrine da sua empresa no Anuncia Aí</a></p></main>';
      if ($("#vt-mapa")) novoMapa($("#vt-mapa"), v.lat, v.lng, v.exato ? 16 : 13).then(function (x) {
        // tocar no mapa (ou no marcador) abre a rota no Google Maps
        var rota = function () { window.open(linkRota(v), "_blank", "noopener"); };
        if (v.exato) x.L.marker([v.lat, v.lng]).addTo(x.m).on("click", rota);
        else x.L.circle([v.lat, v.lng], { radius: 1200, color: c1, fillOpacity: .15 }).addTo(x.m).on("click", rota);
        x.m.on("click", rota);
      }).catch(function () { $("#vt-mapa").remove(); });
      // dados para o Google entender a empresa (negócio local)
      var ld = { "@context": "https://schema.org", "@type": "LocalBusiness", name: v.nome, description: v.descricao || undefined, url: location.href,
        telephone: v.whatsapp || undefined, image: v.logo ? urlPub("logos", v.logo) : undefined,
        address: { "@type": "PostalAddress", streetAddress: v.exato ? v.endereco || undefined : undefined, addressLocality: v.cidade || undefined, addressRegion: undefined, addressCountry: "BR" },
        geo: v.exato && temLocal(v) ? { "@type": "GeoCoordinates", latitude: v.lat, longitude: v.lng } : undefined,
        sameAs: linksDe(v).filter(function (l) { return !l.zap; }).map(function (l) { return l.url; }) };
      var sc = document.createElement("script"); sc.type = "application/ld+json"; sc.textContent = JSON.stringify(ld); document.head.appendChild(sc);
      ligarDivulgar(alvo, "vd", v);
      $("#vt-comp").onclick = function () {
        var d = { title: v.nome, text: v.nome + (local(v) ? " — " + local(v) : ""), url: location.href };
        if (navigator.share) navigator.share(d).catch(function () {}); else A.copiar(location.href, "Link copiado");
      };
      Array.prototype.forEach.call(document.querySelectorAll("[data-arte]"), function (b) {
        b.onclick = function () {
          var a = v.artes[Number(b.dataset.arte)];
          A.janela('<img alt="" src="' + esc(urlPub("vitrine", a.caminho)) + '" style="width:100%;border-radius:12px">' + (a.legenda ? '<p style="white-space:pre-wrap">' + esc(a.legenda) + "</p>" : "") +
            (v.whatsapp ? '<div class="acoes"><a class="botao zap" target="_blank" rel="noopener" href="' + esc(A.linkZap(v.whatsapp, msgZap(v))) + '">💬 Quero saber mais</a></div>' : ""), { titulo: v.nome, larga: true });
        };
      });
    }).catch(function (e) { alvo.innerHTML = '<main><div class="aviso erro">' + esc(A.msgErro(e)) + "</div></main>"; });
  }

  // ---------- guia por cidade e ramo ----------
  function verGuia(alvo) {
    var qs = new URLSearchParams(location.search), F = { cidade: qs.get("cidade") || "", ramo: qs.get("ramo") || "", busca: qs.get("q") || "" };
    alvo.innerHTML = '<header class="vit-topo"><h1>🗺️ Guia Anuncia Aí</h1><p>Empresas e profissionais da sua região. Chame direto no WhatsApp.</p></header><main>' +
      '<div class="cartao"><div class="filtros-guia"><select id="gu-cid" aria-label="Cidade"><option value="">Todas as cidades</option></select>' +
      '<select id="gu-ramo" aria-label="Ramo"><option value="">Todos os ramos</option></select>' +
      '<input id="gu-busca" type="search" placeholder="🔎 O que você procura? (ex.: eletricista, bolo, pintura)"></div>' +
      '<div class="linha" style="margin-top:8px"><button class="peq" id="gu-perto">📍 Perto de mim</button><select id="gu-km" class="peq oculto" aria-label="Distância" style="width:auto">' +
      [5, 10, 20, 50].map(function (k) { return '<option value="' + k + '"' + (k === 20 ? " selected" : "") + ">até " + k + " km</option>"; }).join("") + "</select>" +
      '<span style="flex:1"></span><button class="peq prim" id="gu-ver-lista">📋 Lista</button><button class="peq" id="gu-ver-mapa">🗺️ Mapa</button></div></div>' +
      '<div id="gu-mapa" class="mapa grande oculto"></div>' +
      '<div id="gu-res"><div class="vazio"><span class="carregando"></span> Carregando...</div></div>' +
      htmlConvite() + "</main>";
    $("#gu-busca").value = F.busca;
    rpc("guia_filtros").then(function (f) {
      $("#gu-cid").innerHTML += (f.cidades || []).map(function (c) { return '<option' + (c.toLowerCase() === F.cidade.toLowerCase() ? " selected" : "") + ">" + esc(c) + "</option>"; }).join("");
      $("#gu-ramo").innerHTML += (f.ramos || []).map(function (c) { return '<option' + (c.toLowerCase() === F.ramo.toLowerCase() ? " selected" : "") + ">" + esc(c) + "</option>"; }).join("");
    }).catch(function () {});
    var t = null, perto = null, ultimos = [], mapa = null, camada = null, modoMapa = false;
    function desenharMapa() {
      if (!modoMapa) return;
      var com = ultimos.filter(temLocal);
      (mapa ? Promise.resolve(mapa) : novoMapa($("#gu-mapa"), perto ? perto.lat : com.length ? com[0].lat : -19.92, perto ? perto.lng : com.length ? com[0].lng : -43.94, 12).then(function (x) { mapa = x; return x; }))
        .then(function (x) {
          if (camada) camada.remove();
          camada = x.L.layerGroup().addTo(x.m);
          var pts = [];
          com.forEach(function (c) {
            var pop = "<b>" + esc(c.nome) + "</b><br>" + esc(local(c)) + (c.distancia_km !== undefined ? "<br>📍 a " + esc(km(c.distancia_km)) : "") +
              '<br><a target="_blank" rel="noopener" href="' + esc(linkRota(c)) + '">🧭 Como chegar</a> · <a href="' + esc(urlVitrine(c.slug)) + '">Ver vitrine</a>' +
              (c.whatsapp ? ' · <a target="_blank" rel="noopener" href="' + esc(A.linkZap(c.whatsapp, msgZap(c))) + '">WhatsApp</a>' : "");
            (c.exato ? x.L.marker([c.lat, c.lng]) : x.L.circleMarker([c.lat, c.lng], { radius: 10, color: cor(c.cor1, "#7c3aed"), fillOpacity: .5 })).bindPopup(pop).addTo(camada);
            pts.push([c.lat, c.lng]);
          });
          if (perto) { x.L.circleMarker([perto.lat, perto.lng], { radius: 7, color: "#2563eb", fillColor: "#2563eb", fillOpacity: 1 }).bindPopup("Você está aqui").addTo(camada); pts.push([perto.lat, perto.lng]); }
          if (pts.length > 1) x.m.fitBounds(pts, { padding: [30, 30], maxZoom: 15 }); else if (pts.length) x.m.setView(pts[0], 14);
          setTimeout(function () { x.m.invalidateSize(); }, 50);
        }).catch(function (e) { $("#gu-mapa").innerHTML = '<div class="aviso">' + esc(A.msgErro(e)) + "</div>"; });
    }
    function modo(m) {
      modoMapa = m; $("#gu-mapa").classList.toggle("oculto", !m); $("#gu-res").classList.toggle("oculto", m);
      $("#gu-ver-mapa").classList.toggle("prim", m); $("#gu-ver-lista").classList.toggle("prim", !m); desenharMapa();
    }
    $("#gu-ver-lista").onclick = function () { modo(false); };
    $("#gu-ver-mapa").onclick = function () { modo(true); };
    $("#gu-perto").onclick = function () {
      var b = this;
      if (perto) { perto = null; b.classList.remove("prim"); b.textContent = "📍 Perto de mim"; $("#gu-km").classList.add("oculto"); buscar(); return; }
      if (!navigator.geolocation) { A.avisar("Este aparelho não informa a localização.", "erro"); return; }
      A.ocupado(b, true, "Localizando...");
      navigator.geolocation.getCurrentPosition(function (pos) {
        A.ocupado(b, false); perto = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        b.classList.add("prim"); b.textContent = "📍 Perto de mim ✓"; $("#gu-km").classList.remove("oculto"); buscar();
      }, function () { A.ocupado(b, false); A.avisar("Não consegui a sua localização. Libere a localização para este site e tente de novo.", "erro"); }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 });
    };
    $("#gu-km").onchange = function () { buscar(); };
    function buscar() {
      F.cidade = $("#gu-cid").value || F.cidade; F.ramo = $("#gu-ramo").value; F.busca = $("#gu-busca").value.trim();
      var u = new URLSearchParams(); if (F.cidade) u.set("cidade", F.cidade); if (F.ramo) u.set("ramo", F.ramo); if (F.busca) u.set("q", F.busca);
      history.replaceState(null, "", location.pathname + (u.toString() ? "?" + u : ""));
      var pr = perto ? rpc("guia_perto", { p_lat: perto.lat, p_lng: perto.lng, p_km: Number($("#gu-km").value) || 20, p_ramo: F.ramo || null, p_busca: F.busca || null })
        : rpc("guia", { p_cidade: F.cidade || null, p_ramo: F.ramo || null, p_busca: F.busca || null });
      pr.then(function (ls) {
        ultimos = ls;
        $("#gu-res").innerHTML = ls.length ? '<p class="mudo peq">' + ls.length + " empresa" + (ls.length > 1 ? "s" : "") + (perto ? " até " + $("#gu-km").value + " km de você" : "") + '</p><div class="emp-grade">' + ls.map(cartaoEmpresa).join("") + "</div>"
          : '<div class="cartao vazio">' + (perto ? "Nenhuma empresa com localização até " + $("#gu-km").value + " km. Aumente a distância." : "Nenhuma empresa com esse filtro ainda.") + "</div>";
        desenharMapa();
      }).catch(function (e) { $("#gu-res").innerHTML = '<div class="aviso erro">' + esc(A.msgErro(e)) + "</div>"; });
    }
    $("#gu-cid").onchange = function () { F.cidade = this.value; buscar(); };
    $("#gu-ramo").onchange = buscar;
    $("#gu-busca").oninput = function () { clearTimeout(t); t = setTimeout(buscar, 350); };
    buscar();
  }

  window.AN_PUB = { rpc: rpc, urlPub: urlPub, urlVitrine: urlVitrine, cartaoEmpresa: cartaoEmpresa, novoMapa: novoMapa,
    REDES: REDES, linksDe: linksDe, htmlConvite: htmlConvite, textoConvite: textoConvite, textoDivulgar: textoDivulgar, htmlDivulgar: htmlDivulgar, ligarDivulgar: ligarDivulgar };
  var alvo = document.getElementById("pub");
  if (!alvo) return;
  if (!A.configurado()) { A.telaSemConfig(alvo); return; }
  if (alvo.dataset.pagina === "vitrine") verVitrine(alvo); else verGuia(alvo);
})();
