# SeuChatSeguro

Mensageiro web privado (E2EE) com Supabase. React + TypeScript + Vite. Fonte **Inter** local e ícones **SVG** inline.

> **Status:** visual/navegação/chamadas atualizados (tema Violeta Real, navegação mobile, chamada estilo Instagram, erros de servidor tratados). O código foi validado só por checagem de sintaxe: rode `npm install && npm run build && npm test` e corrija o que aparecer antes de publicar.

## 1. Configurar o Supabase
1. Crie um projeto em supabase.com.
2. Rode `supabase/migrations/001_schema.sql` e depois `002_identity_lookup_realtime.sql` (SQL Editor ou `supabase db push`).
3. `npm install && npm run keys` e copie os valores gerados.
4. Defina os segredos das Edge Functions:
   ```
   supabase secrets set JWT_SECRET=<JWT Secret do projeto> FRANKING_SERVER_KEY=<...> MODERATION_PUBKEY=<...>
   ```
   `JWT_SECRET` precisa ser **o mesmo JWT Secret do projeto** (Project Settings → API), senão a RLS não aceita o token.
5. Rode também `003_phone_directory.sql` e defina `PHONE_PEPPER` (`openssl rand -base64 32`).
   Para verificar números por SMS configure `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` e `TWILIO_VERIFY_SID`.
   Só para testes, sem SMS: `ALLOW_UNVERIFIED_PHONES=true` (qualquer pessoa consegue reivindicar qualquer número; não use em produção).
6. Publique as funções: `supabase functions deploy register login send-message report-verify delete-account phone-link phone-lookup`.

## 2. Rodar o site
```
cp .env.example .env.local   # URL e anon key do projeto
npm install
npm test
npm run dev
npm run build                # gera dist/
```


## 2.1 Publicar na Vercel
1. Suba o projeto no GitHub (o `.env` **não** vai: já está no `.gitignore`).
2. Vercel → *Add New → Project* → importe o repositório. O `vercel.json` já define framework Vite, `dist/`, rotas e headers de segurança/cache (substitui o antigo `public/_headers`, que a Vercel não lê).
3. Em *Settings → Environment Variables* cadastre (Production e Preview): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_BLOCKLIST_PUBKEY`, `VITE_REQUIRE_BLOCKLIST`, `VITE_CONTACT_EMAIL` e, se usar, `VITE_TURN_URL/USER/PASS`. Depois de mudar variáveis, faça *Redeploy* (elas entram no build).
4. No Supabase (Edge Functions → Secrets): `SITE_URL` = `https://seu-app.vercel.app` (sem barra final) e `ALLOWED_ORIGIN` = o mesmo endereço (hoje o padrão é `*`).
5. Se usar domínio próprio do Supabase, troque `*.supabase.co` na `Content-Security-Policy` do `vercel.json`.
6. HTTPS já vem ativo na Vercel, necessário para câmera, microfone e chamadas.

## 2.2 Mudar a cor do app
Tudo vem de variáveis no topo de `src/styles/global.css` (`--accent`, `--accent-2`, `--grad` e as versões do tema escuro). Troque lá e atualize `theme_color` em `public/manifest.webmanifest`.

## 3. Como funciona
- **Conta:** frase de 12 palavras → chaves Ed25519 (identidade) e X25519. O ID é o hash da chave pública. Sem e-mail. Telefone é opcional (só para te acharem pelo número). Login por desafio-assinatura; a função `login` emite o JWT.
- **Mensagens:** caixa selada (X25519) por mensagem, relay em `relay_messages`, **apagada do servidor assim que o destinatário confirma**; expira em 30 dias se não entregue.
- **Histórico:** só no aparelho, IndexedDB cifrado (Argon2id + XChaCha20-Poly1305).
- **Efêmeras:** o tempo conta a partir da leitura, nos dois lados.
- **Denúncia:** message franking. O servidor verifica que a mensagem veio mesmo do remetente sem nunca ter lido o conteúdo; a evidência é guardada cifrada para a moderação (`npm run decrypt-evidence`). CSAM verificado bane o ID.
- **Filtro de imagens:** hash perceptual (núcleo do PDQ) antes de enviar e ao receber, contra `public/blocklist.json` assinado (`scripts/sign-blocklist.mjs`). Com `VITE_REQUIRE_BLOCKLIST=true`, o envio de imagens fica desligado sem lista válida.

## 3.1 Recursos novos
- **Áudio:** gravação de voz (até 45 s, Opus 16 kbps) enviada como mensagem selada; entra na denúncia como qualquer mensagem.
- **Chamadas de voz/vídeo e tela:** WebRTC; o SDP viaja dentro das mensagens seladas (fingerprint DTLS autenticado). Exige HTTPS. Configure TURN (`VITE_TURN_*` em `.env.example`) para funcionar em todas as redes; sem TURN, quem está na chamada vê o IP do outro. Compartilhar tela só funciona em navegador de computador (Chrome/Edge/Firefox): navegadores de celular não oferecem essa função. No celular, a chamada oferece câmera frontal/traseira; compartilhar tela no Android exige empacotar com Capacitor e um plugin de MediaProjection.
- **Grupos:** até 20 membros; cada mensagem é cifrada separadamente para cada membro (fan-out). Só o criador altera nome, membros e autodestruição.
- **QR code / link de convite:** Novo contato → QR code (gerar e escanear) ou link `#/add?id=...`.
- **Perfil:** nome, bio de até 280 caracteres, foto e banner; a bio e as imagens são compartilhadas apenas com contatos aceitos, e as imagens passam pelo filtro de hashes.
- **Foto de grupo:** o criador pode definir/remover a imagem do grupo; ela é enviada cifrada aos membros.
- **Emojis:** seletor com catálogo Unicode completo, pesquisa, categorias e variações de tom de pele.

## 4. Limites conhecidos (leia antes de publicar)
- **Grupos:** a lista de membros é mantida por cada aparelho; não há prova criptográfica de quem é o dono além do primeiro convite. Sem confirmação de leitura em grupos. Sem chamadas em grupo.
- **Áudio** não passa por filtro automático (só as imagens passam).
- **Telefone:** sem SMS configurado o número não é verificado. A busca por número permite descobrir quem usa o app (limitada a 30 buscas/hora por usuário); a LGPD passa a valer para o dado de telefone.
- **Sem Double Ratchet:** não há sigilo perfeito para frente (forward secrecy). Se a chave X25519 vazar, mensagens antigas ainda guardadas no servidor ficam expostas. Próximo passo: libsignal ou vodozemac.
- **Prints:** a web não bloqueia capturas. Só há uma "cortina" quando a aba perde o foco. Bloqueio real: Android `FLAG_SECURE` ao empacotar com Capacitor; no iOS só dá para detectar.
- **Lista de hashes:** `public/blocklist.json` vem vazio. Você precisa de acordo com NCMEC, IWF, Thorn ou similar. Use o algoritmo e o formato que o provedor exigir; esta implementação é compatível em conceito, não a de referência.
- **Banimento por aparelho:** só funciona no app nativo (App Attest / Play Integrity). Na web o ban é por ID.
- **Sem limite por IP** no cadastro além da prova de trabalho: ponha Cloudflare/Turnstile na frente.
- **Metadados** (quem fala com quem, quando) ficam visíveis para o servidor.
- **Jurídico:** revise com advogado os Termos (`src/components/Terms.tsx`), o fluxo de relato às autoridades (TODO em `report-verify`), a LGPD, o Marco Civil e a ECA Digital.

## 5. Virar app (Capacitor)
```
npm i @capacitor/core @capacitor/cli @capacitor/android @capacitor/ios
npx cap init SeuChatSeguro com.seudominio.seuchatseguro --web-dir=dist
npm run build && npx cap add android && npx cap sync
```
No Android, em `MainActivity.onCreate`: `getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);`

Lojas: denúncia no app (já existe), bloqueio de usuário (já existe), exclusão de conta no app (já existe), Termos com tolerância zero (já existe), contato de suporte (`VITE_CONTACT_EMAIL`), classificação 17+/18+, declaração de criptografia (Apple) e Data Safety (Google).
