// =====================================================================
// CONFIGURAÇÃO DO ANUNCIA AÍ — preencha uma vez (veja o LEIA-ME.md).
// A chave "publishable/anon" do Supabase pode ficar aqui: ela é pública por
// natureza. Quem protege os dados são as regras do supabase/schema.sql.
// NUNCA coloque aqui a chave "service_role" nem o token do Mercado Pago.
// =====================================================================
window.ANUNCIA_CONFIG = {
  SUPABASE_URL: "https://ryxwocuhhrohikaqddvy.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_4Ds5DpzjBfyaAbT0Lwca4g_9gbx7bdD", // chave pública (publishable)

  // Seu contato de suporte (aparece no app e no site)
  SUPORTE_WHATSAPP: "(31) 98858-9772",
  SUPORTE_EMAIL: "",

  // 🤝 Nome da rede de empresas (vitrine, guia, convite). Para trocar, é só mudar aqui.
  NOME_REDE: "AGE Conecta",
  SLOGAN_REDE: "Empresas que se indicam e crescem juntas",

  // ✨ Outros projetos (aba "Mais apps" do app e o site). Para trocar o nome, o texto ou incluir outro app, edite aqui.
  // em_breve: true mostra "Quero ser avisado" (a lista de interessados aparece no painel do dono).
  OUTROS_PROJETOS: [
    { id: "gestao", ic: "🛠️", nome: "AGE Gestão de Serviços", em_breve: true,
      desc: "Sistema para empresas de elétrica, pintura e manutenção organizarem o dia a dia.",
      itens: ["Ordens de serviço e app do funcionário (ponto com GPS, fotos e relatório)", "Orçamento em PDF com laudo técnico e lista de materiais",
        "Leitura de nota fiscal e de comprovante Pix", "Pagamentos e fechamento de cada funcionário"] },
    { id: "age", ic: "⚡", nome: "AGE Elétrica e Pintura",
      desc: "Precisa de elétrica, pintura ou pintura industrial em BH e região? Orçamento sem compromisso.",
      link: "https://ageeletrica.com.br/", link_nome: "Conhecer", link2: "https://pintura.ageeletrica.com.br/", link2_nome: "Pintura industrial", whatsapp: "(31) 98858-9772" }
  ]
};
