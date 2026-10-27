// Anuncia Aí — modelos de arte desenhados no navegador (canvas), com a marca da empresa.
(function () {
  "use strict";
  var FORMATOS = { post: [1080, 1350, "Post (feed)"], story: [1080, 1920, "Story / Status"], quadrado: [1080, 1080, "Quadrado"] };
  // ramos com as hashtags da legenda; a empresa também pode digitar um ramo que não está aqui
  var RAMOS = {
    "Restaurante / Lanchonete": "#restaurante #comida #delivery #almoco #comidaboa",
    "Pizzaria": "#pizzaria #pizza #delivery #noitedepizza",
    "Hamburgueria": "#hamburgueria #hamburguer #burger #delivery",
    "Açaí / Sorveteria": "#acai #sorveteria #sorvete #sobremesa",
    "Marmitaria / Quentinhas": "#marmitaria #marmita #almoco #comidacaseira",
    "Padaria / Confeitaria": "#padaria #confeitaria #cafedamanha #doces #bolos",
    "Doces e bolos caseiros": "#bolocaseiro #doces #encomendas #festa",
    "Bar / Distribuidora de bebidas": "#bar #distribuidora #bebidas #happyhour",
    "Mercado / Mercearia": "#mercado #ofertas #promocao #economia",
    "Hortifrúti / Açougue": "#hortifruti #acougue #carnes #frutas #verduras",
    "Salão de beleza / Barbearia": "#salaodebeleza #cabelo #barbearia #beleza #autoestima",
    "Manicure / Sobrancelhas / Cílios": "#manicure #unhas #sobrancelhas #cilios #beleza",
    "Saúde / Clínica / Estética": "#saude #estetica #bemestar #clinica",
    "Farmácia / Drogaria": "#farmacia #drogaria #saude #cuidado",
    "Ótica": "#otica #oculos #lentes #examedevista",
    "Loja de roupas / Moda": "#moda #lookdodia #roupas #estilo #novidades",
    "Calçados / Acessórios / Bolsas": "#calcados #acessorios #bolsas #moda",
    "Papelaria / Presentes": "#papelaria #presentes #volteasaulas #lembrancinhas",
    "Floricultura": "#floricultura #flores #presentes #buque",
    "Loja de celulares / Informática": "#celulares #informatica #acessorios #tecnologia",
    "Material de construção": "#materialdeconstrucao #obra #reforma #construcao",
    "Eletricista": "#eletricista #instalacaoeletrica #manutencaoeletrica #quadrodeenergia #nr10",
    "Pintura residencial e predial": "#pintura #pintor #pinturaresidencial #pinturapredial #reforma",
    "Pintura industrial": "#pinturaindustrial #demarcacaodepiso #pisoepoxi #galpao #pinturaanticorrosiva",
    "Fachadas e vidros (acesso por corda)": "#acessoporcorda #pinturadefachada #limpezadevidros #trabalhoemaltura #nr35",
    "Reformas / Construção / Pedreiro": "#reforma #construcao #pedreiro #obra #acabamento",
    "Gesso / Drywall": "#gesso #drywall #forrodegesso #sancas #reforma",
    "Encanador / Hidráulica": "#encanador #hidraulica #vazamento #manutencao",
    "Ar-condicionado / Refrigeração": "#arcondicionado #refrigeracao #instalacao #manutencaopreventiva",
    "Marcenaria / Móveis planejados": "#marcenaria #moveisplanejados #moveissobmedida #decoracao",
    "Serralheria / Vidraçaria": "#serralheria #vidracaria #portao #esquadrias #boxdebanheiro",
    "Limpeza / Diarista": "#limpeza #diarista #faxina #casalimpa",
    "Jardinagem / Paisagismo": "#jardinagem #paisagismo #jardim #plantas",
    "Dedetização / Controle de pragas": "#dedetizacao #controledepragas #descupinizacao #higienizacao",
    "Mudanças / Fretes": "#mudancas #fretes #carreto #transporte",
    "Chaveiro": "#chaveiro #chaves #fechaduras #24horas",
    "Assistência técnica (celular, eletrodomésticos)": "#assistenciatecnica #conserto #celular #eletrodomesticos",
    "Prestador de serviço (elétrica, pintura, reformas)": "#reforma #eletricista #pintura #manutencao #obra",
    "Oficina / Auto peças": "#oficina #mecanica #carros #autopecas",
    "Lava-jato / Estética automotiva": "#lavajato #esteticaautomotiva #carrolimpo #polimento",
    "Autoescola": "#autoescola #cnh #habilitacao #direcao",
    "Pet shop / Veterinário": "#petshop #pets #cachorro #gato #banhoetosa",
    "Academia / Esportes": "#academia #treino #saude #fitness",
    "Educação / Cursos": "#cursos #educacao #aprender #aulas",
    "Fotografia / Eventos / Festas": "#fotografia #eventos #festas #decoracaodefesta",
    "Costura / Ajustes": "#costura #ajustes #costureira #sobmedida",
    "Imobiliária / Corretor": "#imoveis #casapropria #aluguel #corretor",
    "Consórcio / Seguros / Crédito": "#consorcio #seguros #credito #casapropria #carronovo",
    "Contabilidade / Escritório": "#contabilidade #contador #mei #empresas",
    "Advocacia": "#advocacia #advogado #direito #consultajuridica",
    "Turismo / Viagens": "#turismo #viagens #passeios #ferias",
    "Outro": "#empreendedorismo #negociolocal #compredopequeno"
  };
  // ramo digitado pela empresa: vira hashtag junto com as de negócio local
  function tagsRamo(ramo) {
    if (RAMOS[ramo]) return RAMOS[ramo];
    var t = String(ramo || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().split(/[^a-z0-9]+/).filter(function (w) { return w.length > 2; }).slice(0, 4);
    var junto = t.length > 1 ? ["#" + t.join("")] : [];
    return junto.concat(t.map(function (w) { return "#" + w; })).concat([RAMOS.Outro]).join(" ");
  }
  // ---------- frases do dia: por tema e pelo ramo da empresa ----------
  var TEMAS_FRASE = {
    ramo: "🏷️ Do meu ramo", motivacional: "💪 Motivacional", prosperidade: "💰 Prosperidade", fe: "🙏 Fé e esperança",
    gratidao: "💛 Gratidão", trabalho: "🛠️ Trabalho e capricho", clientes: "🤝 Para os clientes", segunda: "☀️ Bom dia / semana", familia: "🏠 Família"
  };
  var FRASES = {
    motivacional: [
      "Grandes obras começam com um primeiro passo bem dado.", "Não espere a hora certa: comece e ajuste no caminho.",
      "Cada dia é uma chance nova de fazer melhor que ontem.", "Disciplina leva aonde a motivação sozinha não chega.",
      "Quem não desiste já está na frente.", "Pequenos avanços todo dia viram grandes resultados.",
      "O cansaço passa, o orgulho do trabalho feito fica.", "Sonho grande se constrói com tarefa pequena bem feita.",
      "Você não precisa ser perfeito, precisa ser constante.", "Hoje é um ótimo dia para começar."
    ],
    prosperidade: [
      "Prosperidade é plantar com trabalho e colher com gratidão.", "Quem trabalha com honestidade nunca fica sem caminho.",
      "Que a sua semana seja de portas abertas e boas oportunidades.", "Cuide do pouco e o muito virá.",
      "Riqueza de verdade é ter saúde, trabalho e gente boa por perto.", "Bons negócios nascem de boas relações.",
      "Economia de hoje é tranquilidade de amanhã.", "Onde há esforço, há colheita.",
      "Abundância começa quando a gente valoriza o que já tem.", "Prospere fazendo o bem: o resultado volta."
    ],
    fe: [
      "Entregue o seu caminho a Deus e siga com fé.", "Quando o dia pesar, lembre: Deus está no controle.",
      "A fé não tira as pedras do caminho, mas dá força para passar por elas.", "Gratidão a Deus por mais um dia de trabalho e saúde.",
      "Tudo tem o seu tempo. Confie e continue.", "Com fé, cada recomeço é uma bênção.",
      "Seja luz por onde passar.", "Deus abençoe o seu trabalho e a sua casa.",
      "Esperança é acordar acreditando que hoje pode ser melhor.", "O que é seu está guardado. Continue fazendo a sua parte."
    ],
    gratidao: [
      "Obrigado a cada cliente que confia no nosso trabalho.", "Gratidão por mais um dia de portas abertas.",
      "Agradecer abre caminho para coisas boas.", "Cada cliente satisfeito é a nossa maior conquista.",
      "Gratidão é a memória do coração.", "Hoje, agradeça por algo simples.",
      "Somos gratos por fazer parte da sua história.", "Obrigado pela preferência e pela indicação!"
    ],
    trabalho: [
      "Fazer bem feito é a melhor propaganda.", "Capricho não se vê só na entrega, se vê nos anos seguintes.",
      "Qualidade é fazer certo mesmo quando ninguém está olhando.", "Serviço bom é aquele que o cliente indica.",
      "O detalhe faz a diferença.", "Pressa passa, o acabamento fica.",
      "Trabalho honesto é a base de tudo.", "Prazo cumprido é respeito com o cliente.",
      "Segurança não é custo, é cuidado com quem volta para casa.", "Profissional bom aprende todo dia."
    ],
    clientes: [
      "Seu sorriso é o nosso melhor resultado.", "Aqui você é tratado como gostaríamos de ser tratados.",
      "Atender bem é o nosso jeito de agradecer.", "Você pede, a gente faz com carinho.",
      "Conte com a gente: estamos aqui para ajudar.", "Indicou, ganhou nossa gratidão!",
      "Seu bem-estar é a nossa prioridade.", "Volte sempre: a casa é sua."
    ],
    segunda: [
      "Bom dia! Que a semana seja leve e produtiva.", "Nova semana, novas oportunidades.",
      "Café, coragem e bora trabalhar!", "Comece o dia com gratidão e termine com orgulho.",
      "Sexta chegou! Obrigado pela semana, até segunda.", "Bom dia! Hoje é dia de fazer acontecer.",
      "Que o seu dia seja tão bom quanto o seu esforço.", "Segunda-feira é recomeço: vamos com tudo!"
    ],
    familia: [
      "Tudo o que fazemos é pela nossa família.", "Casa cheia é coração feliz.",
      "Família é onde a vida começa e o amor nunca acaba.", "Trabalhamos todo dia para levar o melhor para casa.",
      "Empresa familiar: feito com o cuidado de quem é da casa.", "Tempo com a família é o melhor investimento."
    ]
  };
  // frases do ramo: o grupo sai das palavras do ramo da empresa
  var FRASES_RAMO = {
    obra: ["Grandes obras começam com um bom planejamento.", "Bem feito uma vez, tranquilo por muitos anos.", "Seu espaço merece mão de obra de confiança.",
      "Segurança e capricho em cada etapa da obra.", "Reforma boa é aquela que termina no prazo.", "Cor nova, ambiente novo, vida nova."],
    comida: ["Comida boa é aquela que abraça.", "Feito com carinho, servido com alegria.", "Fome boa se resolve aqui.",
      "O segredo é o tempero e o amor.", "Mesa cheia, coração feliz.", "Sabor de casa, feito para você."],
    beleza: ["Cuidar de si é um ato de amor.", "Autoestima também é saúde.", "Você merece se sentir bem todos os dias.",
      "Beleza é se sentir bem com quem você é.", "Um novo visual muda o dia.", "Tire um tempo para você."],
    comercio: ["Aqui você encontra o que precisa com preço justo.", "Compre do pequeno: você ajuda um sonho a crescer.", "Atendimento de perto faz toda a diferença.",
      "Novidades chegando toda semana!", "Qualidade que cabe no seu bolso.", "Obrigado por comprar no comércio do bairro."],
    saude: ["Saúde é o nosso bem mais precioso.", "Prevenir é sempre o melhor cuidado.", "Cuide do corpo e da mente.",
      "Pequenos hábitos, grande saúde.", "Seu bem-estar em primeiro lugar."],
    pets: ["Quem tem pet tem amor em dobro.", "Pet feliz, casa feliz.", "Cuidamos do seu amigo como se fosse nosso."],
    carro: ["Carro bem cuidado dura muito mais.", "Revisão em dia é segurança na estrada.", "Seu carro em boas mãos."],
    negocio: ["Seu sonho merece um bom planejamento.", "Organização hoje, tranquilidade amanhã.", "Conquiste o que é seu com segurança.",
      "Planejar é o primeiro passo para conquistar."]
  };
  function grupoRamo(ramo) {
    var r = String(ramo || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    if (/pint|eletric|reform|constru|obra|gesso|drywall|encan|hidraul|ar-cond|refriger|marcen|serralh|vidrac|fachad|corda|pedreir|jardin|dedetiz|limpeza|chaveir|mudan|assistencia|prestador/.test(r)) return "obra";
    if (/restaur|lanch|pizz|hamburg|acai|sorvet|marmit|padar|confeit|doce|bolo|bar|bebida|hortifr|acougue/.test(r)) return "comida";
    if (/salao|beleza|barbear|manicur|sobrancel|cilio|estetic/.test(r)) return "beleza";
    if (/saude|clinic|farmac|drogar|otica|academ|esport/.test(r)) return "saude";
    if (/pet|veterin/.test(r)) return "pets";
    if (/oficin|auto|lava|carro/.test(r)) return "carro";
    if (/consorc|seguro|credit|contab|advoc|imobil|corretor/.test(r)) return "negocio";
    return "comercio";
  }
  function frasesDoTema(tema, ramo) { return tema === "ramo" || !FRASES[tema] ? FRASES_RAMO[grupoRamo(ramo)] : FRASES[tema]; }
  // a do dia muda sozinha a cada dia; "salto" pula para a próxima (botão Outra frase)
  function fraseDoDia(tema, ramo, salto, data) {
    var ls = frasesDoTema(tema, ramo), d = data || new Date();
    var dia = Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5);
    return ls[(((dia + (salto || 0)) % ls.length) + ls.length) % ls.length];
  }
  var MODELOS = {
    promocao: { nome: "Promoção", ic: "🔥", fotos: 1, campos: [["selo", "Selo", "PROMOÇÃO"], ["titulo", "Produto ou serviço", "Pizza grande"], ["de", "Preço antes (opcional)", "59,90"], ["por", "Preço agora (número ou texto, ex.: Sob orçamento)", "39,90"], ["detalhe", "Detalhe", "Só até domingo!"]] },
    divulgar: { nome: "Divulgar serviço", ic: "📣", fotos: 1, campos: [["selo", "Selo (opcional)", "ORÇAMENTO GRÁTIS"], ["titulo", "Serviço", "Pintura de fachada"],
      ["texto", "Descrição", "Equipe treinada, material de qualidade e garantia"], ["detalhe", "Chamada", "Peça seu orçamento!"]] },
    novidade: { nome: "Novidade", ic: "✨", fotos: 1, campos: [["titulo", "Título", "Chegou novidade!"], ["texto", "Texto", "Venha conhecer a nova coleção"]] },
    antes_depois: { nome: "Antes e depois", ic: "🔁", fotos: 2, campos: [["titulo", "Título", "Transformação completa"]] },
    servico: { nome: "Serviços", ic: "🛠️", fotos: 0, campos: [["titulo", "Título", "Nossos serviços"], ["itens", "Itens (um por linha, até 5)", "Instalação\nManutenção\nReforma"], ["detalhe", "Chamada", "Orçamento sem compromisso!"]] },
    aviso: { nome: "Aviso / horário", ic: "📢", fotos: 0, campos: [["titulo", "Título", "Horário de funcionamento"], ["texto", "Texto", "Seg a sex: 8h às 18h\nSábado: 8h às 12h"]] },
    frase: { nome: "Frase do dia", ic: "💬", fotos: 0, campos: [["texto", "Frase", "Quem faz com amor faz melhor."], ["autor", "Autor (opcional)", ""]] }
  };

  // preço: número ganha "R$"; texto (ex.: "Sob orçamento") aparece como foi escrito
  function ehValor(v) { return /^\s*(R\$\s*)?\d[\d.,]*\s*$/i.test(String(v || "")); }
  function preco(v) { v = String(v || "").trim(); return ehValor(v) ? "R$ " + v.replace(/^R\$\s*/i, "") : v; }
  function luz(hex) { var n = parseInt(String(hex || "#000000").slice(1), 16); var r = n >> 16 & 255, g = n >> 8 & 255, b = n & 255; return (0.299 * r + 0.587 * g + 0.114 * b) / 255; }
  function escurecer(hex, f) {
    var n = parseInt(String(hex || "#7c3aed").slice(1), 16);
    var c = [n >> 16 & 255, n >> 8 & 255, n & 255].map(function (x) { return Math.max(0, Math.min(255, Math.round(x * f))); });
    return "#" + c.map(function (x) { return (x + 256).toString(16).slice(1); }).join("");
  }
  function arred(cx, x, y, w, h, r) { cx.beginPath(); cx.moveTo(x + r, y); cx.arcTo(x + w, y, x + w, y + h, r); cx.arcTo(x + w, y + h, x, y + h, r); cx.arcTo(x, y + h, x, y, r); cx.arcTo(x, y, x + w, y, r); cx.closePath(); }
  function quebrar(cx, texto, larg) {
    var linhas = [];
    String(texto || "").split("\n").forEach(function (par) {
      var pal = par.split(/\s+/).filter(Boolean), l = "";
      if (!pal.length) { linhas.push(""); return; }
      pal.forEach(function (p) { var t = l ? l + " " + p : p; if (cx.measureText(t).width > larg && l) { linhas.push(l); l = p; } else l = t; });
      linhas.push(l);
    });
    return linhas;
  }
  // escreve o texto no maior tamanho que couber (até maxLinhas); devolve a altura usada
  function texto(cx, t, x, y, larg, op) {
    op = op || {};
    var tam = op.tam || 80, min = op.min || 30, max = op.linhas || 3, peso = op.peso || "800", alt = op.alt || 1.15, ls;
    for (; tam >= min; tam -= 2) { cx.font = peso + " " + tam + "px system-ui, Arial, sans-serif"; ls = quebrar(cx, t, larg); if (ls.length <= max) break; }
    ls = ls.slice(0, max);
    cx.textBaseline = "top"; cx.textAlign = op.centro ? "center" : "left"; cx.fillStyle = op.cor || "#fff";
    ls.forEach(function (l, i) { cx.fillText(l, op.centro ? x + larg / 2 : x, y + i * tam * alt); });
    cx.textAlign = "left";
    return ls.length * tam * alt;
  }
  function cobrir(cx, img, x, y, w, h, raio) {
    cx.save(); arred(cx, x, y, w, h, raio || 28); cx.clip();
    if (img) {
      var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height, k = Math.max(w / iw, h / ih), sw = w / k, sh = h / k;
      cx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, x, y, w, h);
    } else {
      cx.fillStyle = "rgba(255,255,255,.14)"; cx.fillRect(x, y, w, h);
      cx.fillStyle = "rgba(255,255,255,.55)"; cx.font = "700 40px system-ui, Arial"; cx.textAlign = "center"; cx.textBaseline = "middle";
      cx.fillText("📷 sua foto aqui", x + w / 2, y + h / 2); cx.textAlign = "left";
    }
    cx.restore();
  }
  function pilula(cx, t, x, y, fundo, cor, tam) {
    tam = tam || 40; cx.font = "900 " + tam + "px system-ui, Arial"; var w = cx.measureText(t).width + tam * 1.2, h = tam * 1.6;
    cx.fillStyle = fundo; arred(cx, x, y, w, h, h / 2); cx.fill();
    cx.fillStyle = cor; cx.textBaseline = "middle"; cx.fillText(t, x + tam * 0.6, y + h / 2 + 2);
    return w;
  }

  // dados: { modelo, formato, campos, fotos: [img], empresa, logo: img }
  function desenhar(cv, d) {
    var f = FORMATOS[d.formato] || FORMATOS.post, W = f[0], H = f[1], e = d.empresa || {}, c = d.campos || {}, M = MODELOS[d.modelo] || MODELOS.promocao;
    cv.width = W; cv.height = H;
    var cx = cv.getContext("2d"), cor1 = e.cor1 || "#7c3aed", cor2 = e.cor2 || "#f59e0b";
    var claro = luz(cor1) > 0.62, txt = claro ? "#1d1830" : "#ffffff", txt2 = claro ? "rgba(29,24,48,.75)" : "rgba(255,255,255,.85)";
    var g = cx.createLinearGradient(0, 0, W, H); g.addColorStop(0, cor1); g.addColorStop(1, escurecer(cor1, claro ? 0.86 : 0.62));
    cx.fillStyle = g; cx.fillRect(0, 0, W, H);
    // detalhe decorativo
    cx.fillStyle = cor2; cx.globalAlpha = 0.18; cx.beginPath(); cx.arc(W - 60, 120, 260, 0, 7); cx.fill(); cx.beginPath(); cx.arc(40, H - 160, 200, 0, 7); cx.fill(); cx.globalAlpha = 1;
    var P = 64, y = P, story = d.formato === "story";
    if (story) y += 60;
    // cabeçalho: logo + nome
    var tl = 112;
    if (d.logo) {
      cx.save(); cx.beginPath(); cx.arc(P + tl / 2, y + tl / 2, tl / 2, 0, 7); cx.fillStyle = "#fff"; cx.fill(); cx.clip();
      var lw = d.logo.naturalWidth || d.logo.width, lh = d.logo.naturalHeight || d.logo.height, k = Math.min((tl - 14) / lw, (tl - 14) / lh);
      cx.drawImage(d.logo, P + (tl - lw * k) / 2, y + (tl - lh * k) / 2, lw * k, lh * k); cx.restore();
      texto(cx, e.nome || "", P + tl + 24, y + 20, W - 2 * P - tl - 24, { tam: 48, min: 30, linhas: 2, cor: txt });
    } else texto(cx, e.nome || "", P, y + 20, W - 2 * P, { tam: 56, min: 34, linhas: 2, cor: txt });
    y += tl + 40;
    var rod = 150 + (story ? 80 : 0), fimArea = H - rod, larg = W - 2 * P;

    if (d.modelo === "promocao") {
      if (c.selo !== "") { pilula(cx, c.selo || "PROMOÇÃO", P, y, cor2, luz(cor2) > 0.6 ? "#1d1830" : "#fff", 42); y += 100; }
      // sem preço, a foto ganha o espaço que ele ocuparia
      var altFoto = Math.round((fimArea - y) * (c.por ? 0.52 : 0.64));
      cobrir(cx, d.fotos && d.fotos[0], P, y, larg, altFoto); y += altFoto + 30;
      y += texto(cx, c.titulo, P, y, larg, { tam: 70, min: 40, linhas: 2, cor: txt }) + 10;
      if (c.de) { cx.font = "700 46px system-ui, Arial"; cx.fillStyle = txt2; var t1 = "De " + preco(c.de); cx.fillText(t1, P, y); var w1 = cx.measureText(t1).width;
        cx.fillRect(P, y + 26, w1, 5); y += 62; }
      if (ehValor(c.por)) { cx.font = "900 110px system-ui, Arial"; cx.fillStyle = cor2; cx.textBaseline = "top"; cx.fillText((c.de ? "Por " : "") + preco(c.por), P, y, larg); y += 130; }
      else if (c.por) y += texto(cx, c.por, P, y, larg, { tam: 80, min: 40, linhas: 2, peso: "900", cor: cor2 }) + 20;
      if (c.detalhe) texto(cx, c.detalhe, P, y, larg, { tam: 44, min: 28, linhas: 2, peso: "700", cor: txt });
    } else if (d.modelo === "divulgar") {
      if (c.selo) { pilula(cx, c.selo, P, y, cor2, luz(cor2) > 0.6 ? "#1d1830" : "#fff", 42); y += 100; }
      // a foto ocupa o que sobra depois de reservar espaço para os textos (no story sobra mais)
      var adv = Math.round(Math.max((fimArea - y) * 0.5, fimArea - y - 520));
      cobrir(cx, d.fotos && d.fotos[0], P, y, larg, adv); y += adv + 30;
      y += texto(cx, c.titulo, P, y, larg, { tam: 76, min: 40, linhas: 2, cor: txt }) + 10;
      if (c.texto) y += texto(cx, c.texto, P, y, larg, { tam: 44, min: 28, linhas: 2, peso: "600", cor: txt2 }) + 20;
      if (c.detalhe) { var hd = 110; cx.fillStyle = cor2; arred(cx, P, y, larg, hd, 30); cx.fill();
        texto(cx, c.detalhe, P + 30, y + 24, larg - 60, { tam: 50, min: 30, linhas: 1, centro: true, cor: luz(cor2) > 0.6 ? "#1d1830" : "#fff" }); }
    } else if (d.modelo === "novidade") {
      pilula(cx, "NOVIDADE", P, y, cor2, luz(cor2) > 0.6 ? "#1d1830" : "#fff", 42); y += 100;
      var af = Math.round((fimArea - y) * 0.6);
      cobrir(cx, d.fotos && d.fotos[0], P, y, larg, af); y += af + 34;
      y += texto(cx, c.titulo, P, y, larg, { tam: 76, min: 40, linhas: 2, cor: txt }) + 12;
      texto(cx, c.texto, P, y, larg, { tam: 46, min: 28, linhas: 3, peso: "600", cor: txt2 });
    } else if (d.modelo === "antes_depois") {
      y += texto(cx, c.titulo, P, y, larg, { tam: 70, min: 40, linhas: 2, cor: txt }) + 26;
      var gap = 18, area = fimArea - y - 10;
      if (story) {
        var ah = (area - gap) / 2;
        [0, 1].forEach(function (i) { cobrir(cx, d.fotos && d.fotos[i], P, y + i * (ah + gap), larg, ah); pilula(cx, i ? "DEPOIS" : "ANTES", P + 20, y + i * (ah + gap) + 20, i ? "#16a34a" : "rgba(0,0,0,.7)", "#fff", 34); });
      } else {
        var aw = (larg - gap) / 2;
        [0, 1].forEach(function (i) { cobrir(cx, d.fotos && d.fotos[i], P + i * (aw + gap), y, aw, area); pilula(cx, i ? "DEPOIS" : "ANTES", P + i * (aw + gap) + 18, y + 18, i ? "#16a34a" : "rgba(0,0,0,.7)", "#fff", 34); });
      }
    } else if (d.modelo === "servico") {
      y += texto(cx, c.titulo, P, y, larg, { tam: 84, min: 44, linhas: 2, cor: txt }) + 40;
      String(c.itens || "").split("\n").map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 5).forEach(function (it) {
        cx.fillStyle = cor2; cx.beginPath(); cx.arc(P + 30, y + 34, 30, 0, 7); cx.fill();
        cx.fillStyle = luz(cor2) > 0.6 ? "#1d1830" : "#fff"; cx.font = "900 36px system-ui, Arial"; cx.textBaseline = "middle"; cx.textAlign = "center"; cx.fillText("✓", P + 30, y + 36); cx.textAlign = "left";
        texto(cx, it, P + 84, y + 6, larg - 84, { tam: 50, min: 30, linhas: 1, peso: "700", cor: txt }); y += 96;
      });
      if (c.detalhe) { y += 20; var hb = 120; cx.fillStyle = cor2; arred(cx, P, y, larg, hb, 30); cx.fill();
        texto(cx, c.detalhe, P + 30, y + 26, larg - 60, { tam: 52, min: 30, linhas: 1, centro: true, cor: luz(cor2) > 0.6 ? "#1d1830" : "#fff" }); }
    } else if (d.modelo === "aviso") {
      cx.font = "160px system-ui, Arial"; cx.textBaseline = "top"; cx.fillText("📢", P, y); y += 210;
      y += texto(cx, c.titulo, P, y, larg, { tam: 92, min: 48, linhas: 3, cor: txt }) + 30;
      texto(cx, c.texto, P, y, larg, { tam: 56, min: 30, linhas: 6, peso: "600", cor: txt2, alt: 1.3 });
    } else if (d.modelo === "frase") {
      cx.font = "900 260px Georgia, serif"; cx.fillStyle = cor2; cx.textBaseline = "top"; cx.fillText("“", P - 10, y - 40);
      var meio = y + (fimArea - y) / 2 - 160;
      var h = texto(cx, c.texto, P, meio, larg, { tam: 86, min: 40, linhas: 6, peso: "800", cor: txt, centro: true, alt: 1.25 });
      if (c.autor) texto(cx, "— " + c.autor, P, meio + h + 30, larg, { tam: 42, min: 28, linhas: 1, peso: "600", cor: txt2, centro: true });
    }
    // rodapé com contatos
    var ry = H - rod + 20 - (story ? 40 : 0);
    cx.fillStyle = claro ? "rgba(255,255,255,.55)" : "rgba(0,0,0,.28)"; arred(cx, P - 16, ry, W - 2 * P + 32, 110, 30); cx.fill();
    var cont = [e.whatsapp ? "📲 " + e.whatsapp : "", e.instagram ? "📷 " + (e.instagram.charAt(0) === "@" ? e.instagram : "@" + e.instagram) : "", e.cidade ? "📍 " + e.cidade : ""].filter(Boolean).join("   ");
    texto(cx, cont || e.nome || "", P + 10, ry + 30, W - 2 * P - 20, { tam: 40, min: 24, linhas: 1, peso: "700", cor: txt, centro: true });
    return cv;
  }

  function legenda(modelo, c, e) {
    e = e || {}; c = c || {};
    var tags = tagsRamo(e.ramo) + (e.cidade ? " #" + String(e.cidade).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]/g, "").toLowerCase() : "");
    var contato = [e.whatsapp ? "📲 WhatsApp: " + e.whatsapp : "", e.cidade ? "📍 " + e.cidade : ""].filter(Boolean).join("\n");
    var t;
    if (modelo === "promocao") t = (c.selo === "" ? "" : "🔥 " + String(c.selo || "PROMOÇÃO").toUpperCase() + ": ") + (c.titulo || "") + (c.por ? "\n" + (ehValor(c.por) ? (c.de ? "De " + preco(c.de) + " por " : "Por ") + preco(c.por) + "!" : (c.de ? "De " + preco(c.de) + " · " : "") + c.por) : "") + (c.detalhe ? "\n" + c.detalhe : "");
    else if (modelo === "divulgar") t = "📣 " + (c.titulo || "") + (c.texto ? "\n" + c.texto : "") + (c.selo ? "\n✅ " + c.selo : "") + (c.detalhe ? "\n👉 " + c.detalhe : "");
    else if (modelo === "novidade") t = "✨ " + (c.titulo || "Novidade!") + "\n" + (c.texto || "");
    else if (modelo === "antes_depois") t = "🔁 Antes e depois: " + (c.titulo || "") + "\nArraste para o lado e veja a diferença! 😍";
    else if (modelo === "servico") t = "🛠️ " + (c.titulo || "") + "\n" + String(c.itens || "").split("\n").filter(Boolean).map(function (x) { return "✅ " + x.trim(); }).join("\n") + (c.detalhe ? "\n\n" + c.detalhe : "");
    else if (modelo === "aviso") t = "📢 " + (c.titulo || "") + "\n" + (c.texto || "");
    else t = "💬 “" + (c.texto || "") + "”" + (c.autor ? " — " + c.autor : "");
    return t + "\n\n" + (e.nome ? e.nome + "\n" : "") + (contato ? contato + "\n" : "") + "\n" + tags;
  }

  window.AN_ARTES = { FORMATOS: FORMATOS, RAMOS: RAMOS, MODELOS: MODELOS, TEMAS_FRASE: TEMAS_FRASE, fraseDoDia: fraseDoDia, frasesDoTema: frasesDoTema, desenhar: desenhar, legenda: legenda };
})();
