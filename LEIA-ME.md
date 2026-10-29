# Anuncia Aí

App para qualquer negócio criar **artes com a própria marca** (promoção, novidade, antes e depois, serviços,
aviso, frase do dia) e postar no Instagram, Facebook, WhatsApp, Telegram e TikTok — com **assinatura mensal
no cartão ou Pix pelo Mercado Pago**, **liberação e bloqueio automáticos** e **avisos de vencimento** 5, 3 e 1 dia
antes, por e-mail e WhatsApp.

| Página | Para quem | O que faz |
|---|---|---|
| `index.html` | Público | Site de apresentação com exemplos e preços |
| `app.html` | Empresas clientes | Criar conta (7 dias grátis), minha marca, criar artes, assinatura |
| `admin.html` | Você (dono) | Empresas, quem vence, pagamentos, avisos enviados, sugestões dos clientes, preços, +dias/bloquear |

Custo para começar: **R$ 0** (Supabase grátis, GitHub Pages grátis, Brevo grátis até 300 e-mails/dia).
O Mercado Pago cobra a taxa dele sobre cada pagamento recebido.

---

## Como funciona a cobrança

- **Teste grátis:** 7 dias a partir do cadastro.
- **Cartão:** assinatura do Mercado Pago que **cobra sozinha** todo mês (ou a cada 12 meses no plano anual).
  Se a cobrança falhar, o cliente tem **3 dias de tolerância** e recebe o aviso "não conseguimos cobrar no cartão".
- **Pix:** 5 dias antes do vencimento o sistema **gera o Pix sozinho** e manda o código no e-mail/WhatsApp.
- **Avisos automáticos:** 5, 3 e 1 dia antes do vencimento (cartão: só na véspera) e no bloqueio. Cada aviso sai uma vez só.
- **Pagou → libera na hora** (o Mercado Pago avisa o sistema). **Venceu sem pagar → bloqueia** no dia (cartão: depois dos 3 dias).
- Bloqueada, a empresa só vê a tela de pagamento.

**Sugestões dos clientes:** a aba “💡 Sugestões” do app grava a mensagem para você ler e responder no painel
(aba “Sugestões”). Em instalação que já existia, rode uma vez o `supabase/sugestoes.sql` no SQL Editor.

---

## Instalação (uma vez)

### 1. Projeto no Supabase (separado do da AGE)
1. <https://supabase.com> → **New project** → nome `anuncia-ai`, região **South America (São Paulo)**.
2. **SQL Editor** → **+** → cole todo o `supabase/schema.sql` → **Run** (se aparecer, **Run and enable RLS**).
3. **Authentication → Users → Add user**: o **seu** e-mail e senha (marque *Auto Confirm User*). No SQL Editor rode:
   `insert into public.admins (email) values ('seu-email@exemplo.com') on conflict do nothing;`
4. **Authentication → Sign In / Providers → Email**: para começar, **desligue "Confirm email"** (o e-mail padrão do
   Supabase só manda poucas mensagens por hora). Depois de configurar o Brevo (passo 4), pode ligar de novo usando
   **Authentication → SMTP Settings** com os dados SMTP do Brevo.
5. **Authentication → URL Configuration → Site URL**: `https://SEU-USUARIO.github.io/anuncia-ai/app.html`.
6. **Project Settings → API**: copie a **Project URL** e a chave **anon / publishable** para o `config.js`.
   **Nunca** coloque a chave `service_role` no `config.js`.

### 2. Mercado Pago
1. Crie/entre na conta em <https://www.mercadopago.com.br> (de preferência conta de empresa).
2. <https://www.mercadopago.com.br/developers/panel/app> → **Criar aplicação** → **Criar no painel de integração** →
   **Checkout Transparente** → Tipo de API **API de Orders** (o Pix é gerado por ela; a assinatura no cartão usa o mesmo token).
3. Em **Credenciais de produção**, copie o **Access Token** (começa com `APP_USR-`). Ele vai nos segredos do Supabase (passo 5), **nunca** no `config.js`.
4. Em **Webhooks → Configurar notificações**: URL `https://SEU-PROJETO.supabase.co/functions/v1/mp-webhook`, eventos
   **Order (Mercado Pago)** (Pix), **Pagamentos** e **Planos e assinaturas** (cartão). Copie a **assinatura secreta** (para o `MP_WEBHOOK_SECRET`).
5. Para testar sem dinheiro de verdade, use as **credenciais de teste** (o token de teste também começa com `APP_USR-`).

### 3. Funções do servidor (Supabase → Edge Functions)
Crie 4 funções (**Deploy a new function → Via Editor**), colando o arquivo `index.ts` de cada pasta:

| Nome da função | Arquivo | Verify JWT |
|---|---|---|
| `assinar` | `supabase/functions/assinar/index.ts` | **desligado** (a função confere o login) |
| `mp-webhook` | `supabase/functions/mp-webhook/index.ts` | **desligado** (quem chama é o Mercado Pago) |
| `cobranca-diaria` | `supabase/functions/cobranca-diaria/index.ts` | **desligado** (protegida pelo CRON_SECRET) |
| `telegram` | `supabase/functions/telegram/index.ts` | **desligado** (a função confere o login) |

**Publicar no Telegram:** em instalação que já existia, rode uma vez o `supabase/telegram.sql` e crie a função `telegram`.

**🤝 Comunidade (vitrine, guia e rede):** em instalação que já existia, rode uma vez o `supabase/comunidade.sql`. Cada empresa escolhe em “🤝 Comunidade” se aparece no Guia (`guia.html`); a página pública dela é `vitrine.html?e=endereco`. O público só vê nome, ramo, cidade, bairro, descrição, contatos, logo, as artes que a empresa pôs na vitrine e o ponto no mapa (exato só se ela escolher; senão, arredondado a uns 1 km) — nunca e-mail ou dados da assinatura — e só enquanto a assinatura estiver em dia.

**✨ Mais apps (outros projetos):** a lista fica em `config.js` → `OUTROS_PROJETOS` (nome, texto, link, WhatsApp). Com `em_breve: true` aparece o botão “Quero ser avisado”; quem tocar aparece no painel do dono, aba “✨ Interessados” (precisa do `supabase/comunidade.sql`).
Cada empresa liga o próprio robô (do @BotFather) e o canal em **Minha marca**; o código do robô fica numa tabela que o app não lê.

### 4. E-mail dos avisos (Brevo, grátis)
1. <https://www.brevo.com> → crie a conta → **Senders** → adicione e confirme o e-mail remetente (ex.: o Gmail da empresa).
2. **SMTP & API → API Keys** → crie uma chave (para o `BREVO_API_KEY`).

### 5. Segredos (Supabase → Edge Functions → Secrets)
| Nome | Valor |
|---|---|
| `MP_ACCESS_TOKEN` | Access Token do Mercado Pago |
| `MP_WEBHOOK_SECRET` | assinatura secreta do webhook (opcional, recomendado) |
| `APP_URL` | `https://SEU-USUARIO.github.io/anuncia-ai` (sem barra no fim) |
| `CRON_SECRET` | uma senha longa inventada por você (ex.: 30 letras e números) |
| `BREVO_API_KEY` | chave da API do Brevo |
| `EMAIL_FROM` | o e-mail remetente confirmado no Brevo |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_TEMPLATE` | opcional — ver passo 7 |
| `MP_PIX_TESTE` | `1` **só durante o teste** com credenciais de teste: o Mercado Pago aprova o Pix sozinho. **Apague antes de usar o token de produção.** |

`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` o Supabase já coloca sozinho.

### 6. Agendar a cobrança diária
No **SQL Editor**, abra o `supabase/agendar.sql`, troque `SEU-PROJETO` e `SEU-SEGREDO` (o mesmo `CRON_SECRET`) e rode.
Roda todo dia às 9h de Brasília.

### 7. Aviso automático por WhatsApp (opcional, pago pela Meta)
O WhatsApp só permite mensagens automáticas pela **API oficial (WhatsApp Business Platform da Meta)**, que cobra alguns
centavos por mensagem e exige um **modelo de mensagem aprovado**:
1. <https://business.facebook.com> → **WhatsApp Manager** → cadastre o número da empresa.
2. Crie o modelo **`aviso_vencimento`** (categoria *Utilidade*, idioma *Português (BR)*) com o texto:
   `Olá, {{1}}! Aqui é do Anuncia Aí: {{2}}. Para pagar e continuar usando: {{3}}`
3. Coloque `WHATSAPP_TOKEN` (token permanente), `WHATSAPP_PHONE_ID` e `WHATSAPP_TEMPLATE=aviso_vencimento` nos segredos.

Sem isso, os avisos saem só por e-mail, e no **painel do dono** cada empresa tem o botão **📲** para mandar o lembrete
pelo seu WhatsApp com 1 toque.

### 8. Publicar (GitHub Pages)
Repositório → **Settings → Pages** → *Deploy from a branch* → **main** / **(root)** → Save.
Site: `https://SEU-USUARIO.github.io/anuncia-ai/` · App: `.../app.html` · Painel: `.../admin.html`.

---

## Uso no dia a dia
- **Painel do dono → Empresas:** situação (teste, ativa, vence em X dias, bloqueada), receita estimada, recebido no mês,
  filtro *Vencem em até 5 dias*, botões 📲 WhatsApp e ✉ e-mail com a mensagem de cobrança pronta.
- Abra uma empresa para **+7 / +30 dias**, **Liberar**, **Bloquear**, anotações, pagamentos e avisos enviados.
- **Planos:** mude os preços (vale para os próximos pagamentos; quem já assina no cartão continua no valor da assinatura).
- **Avisos enviados:** tudo o que a cobrança diária mandou, com o motivo de qualquer falha.

## Segurança
- Cada empresa só vê os próprios dados (regras RLS no banco).
- A empresa **não consegue se liberar**: validade, situação e pagamentos só mudam pelo servidor ou pelo dono.
- O webhook **não confia no aviso**: busca o pagamento direto no Mercado Pago com o seu token antes de liberar.
- O token do Mercado Pago, a chave do Brevo e a do WhatsApp ficam só nos segredos do Supabase.

## 🎁 Indique e ganhe
- Rode uma vez o `supabase/indicacoes.sql` no SQL Editor do Supabase (já está também no final do `schema.sql`).
- Cada empresa tem um **código** e um **link** (`index.html?ind=CÓDIGO`) na aba **🎁 Indique e ganhe**, com botão para enviar no WhatsApp e campo da **chave Pix** para receber.
- Quem entra pelo link (ou digita o código no cadastro, até 30 dias e antes do primeiro pagamento) fica ligado a quem indicou.
- Quando o indicado faz o **primeiro pagamento aprovado**, a indicação fica **a pagar** com o valor das regras (padrão R$ 10,00).
- No painel do dono, aba **🎁 Indicações**: quem indicou, chave Pix, indicado, situação e valor; **✅ Paguei** depois de pagar no Pix. Valor, ativo/pausado e texto das regras ficam na mesma aba.
