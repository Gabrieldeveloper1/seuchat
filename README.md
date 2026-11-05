> **Atualização:** para o fluxo atual de denúncias e administrador, siga `LEIA-ANTES-DE-PUBLICAR.md`. As instruções antigas sobre links de decisão e revisão independente foram substituídas.

# SeuChatSeguro

> **Atualização:** leia [LEIA-ANTES-DE-PUBLICAR.md](LEIA-ANTES-DE-PUBLICAR.md) para as migrações 007 e 008, implantação, retenção e limitações de segurança. As notas antigas sobre anexos são substituídas por esse documento.

Mensageiro web privado (E2EE) com Supabase. React + TypeScript + Vite. Fonte **Inter** local e ícones **SVG** inline.

> **Status:** app web com identificadores próprios, grupos com cargos, menções e chamadas em malha. TURN e lista assinada de hashes precisam ser configurados antes de publicar recursos que dependem deles.

## 1. Configurar o Supabase
1. Crie um projeto em supabase.com.
2. Rode `supabase/migrations/001_schema.sql`, `002_identity_lookup_realtime.sql`, `005_app_number_directory.sql`, `006_attachments.sql`, `007_attachment_retention.sql` e `008_profile_and_attachment_access.sql` (SQL Editor ou `supabase db push`).
3. `npm install && npm run keys` e copie os valores gerados.
4. Defina os segredos das Edge Functions:
   ```
   supabase secrets set JWT_SECRET=<JWT Secret do projeto> FRANKING_SERVER_KEY=<...> MODERATION_PUBKEY=<...>
   ```
   `JWT_SECRET` precisa ser **o mesmo JWT Secret do projeto** (Project Settings → API), senão a RLS não aceita o token.
5. Para ocultar IP nas chamadas, configure um TURN compatível com credenciais REST (por exemplo, Coturn com `use-auth-secret`) e defina no Supabase `TURN_URL` e `TURN_SHARED_SECRET`. Gere um segredo forte (ex.: `openssl rand -hex 32`) e mantenha-o apenas no servidor.
6. Publique cada função separadamente: `for f in register login send-message report-verify delete-account app-number app-number-lookup turn-credentials attachments cleanup-attachments profile-sync news; do supabase functions deploy "$f"; done`. `phone-link` e `phone-lookup` são legadas e não são usadas pelo app.

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
3. Em *Settings → Environment Variables* cadastre (Production e Preview): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_BLOCKLIST_PUBKEY`, `VITE_REQUIRE_BLOCKLIST=true`, `VITE_CONTACT_EMAIL` e `VITE_TURN_ENABLED=true` após configurar TURN no servidor. Não coloque segredo TURN em variável `VITE_*`: ela fica pública no bundle. Depois de mudar variáveis, faça *Redeploy*.
4. No Supabase (Edge Functions → Secrets): `SITE_URL` = `https://seu-app.vercel.app` (sem barra final) e `ALLOWED_ORIGIN` = o mesmo endereço (hoje o padrão é `*`).
5. Se usar domínio próprio do Supabase, troque `*.supabase.co` na `Content-Security-Policy` do `vercel.json`.
6. HTTPS já vem ativo na Vercel, necessário para câmera, microfone e chamadas.

## 2.2 Mudar a cor do app
Tudo vem de variáveis no topo de `src/styles/global.css` (`--accent`, `--accent-2`, `--grad` e as versões do tema escuro). Troque lá e atualize `theme_color` em `public/manifest.webmanifest`.

## 3. Como funciona
- **Conta:** frase de 12 palavras → chaves Ed25519 (identidade) e X25519. O ID técnico deriva da chave pública. O servidor gera um número interno exclusivo no formato `10259-5251`; não é telefone, não usa WhatsApp ou SMS. Requer a migration 005 e as funções `app-number` e `app-number-lookup`.
- **Mensagens:** caixa selada (X25519) por mensagem, relay em `relay_messages`, **apagada do servidor assim que o destinatário confirma**; expira em 30 dias se não entregue.
- **Histórico:** só no aparelho, IndexedDB cifrado (Argon2id + XChaCha20-Poly1305).
- **Efêmeras:** o tempo conta a partir da leitura, nos dois lados.
- **Denúncia:** message franking. O servidor verifica que a mensagem veio mesmo do remetente sem nunca ter lido o conteúdo; a evidência é guardada cifrada para a moderação (`npm run decrypt-evidence`). A prova verifica autoria e integridade, não o conteúdo. Um moderador humano revisa a denúncia e decide; existe uma apelação revisada por outra pessoa.
- **Filtro de imagens:** hash perceptual (núcleo do PDQ) antes de enviar e ao receber, contra `public/blocklist.json` assinado (`scripts/sign-blocklist.mjs`). Fail-closed por padrão: imagem enviada ou recebida é bloqueada sem lista assinada válida. Obtenha autorização e dados de uma organização provedora; não use listas inventadas.

## 3.1 Recursos novos
- **Áudio:** gravação de voz (até 45 s, Opus 16 kbps) enviada como mensagem selada; entra na denúncia como qualquer mensagem.
- **Chamadas de voz/vídeo e tela:** WebRTC; sinalização dentro das mensagens seladas. Chamadas de grupo em malha suportam até 5 participantes; cada par cria uma conexão direta/relay, consumindo mais banda e CPU que um SFU. Para esconder seu IP, configure `TURN_URL` + `TURN_SHARED_SECRET`, publique `turn-credentials` e ative `VITE_TURN_ENABLED=true`; o modo relay-only falha fechado se o TURN não puder ser alcançado. Todos os participantes devem habilitar relay-only para ocultar os próprios endereços. Compartilhar tela só funciona em navegadores compatíveis.
- **Grupos:** até 20 membros; cada mensagem é cifrada individualmente. Há descrição, imagem/banner, menções, cargos, cargo automático e auditoria. `@Everyone` inicia sem permissões especiais; o dono pode criar cargos e atribuir permissão de envio, chamadas e visualização da auditoria. O dono é o único que altera a configuração.
- **QR code / link de convite:** Novo contato → QR code (gerar e escanear) ou link `#/add?id=...`.
- **Foto de perfil e banner:** recortados no aparelho, passam pelo filtro de hashes e vão só para contatos aceitos.

## 4. Limites conhecidos (leia antes de publicar)
- **Grupos:** a lista e a configuração são sincronizadas por convites assinados do dono, mas não há autoridade central para impedir um cliente malicioso de falsificar estado local. A auditoria é uma trilha de eventos de aplicativo, não prova forense. Sem confirmação de leitura em grupos.
- **Áudio** não passa por filtro automático (só as imagens passam).
- **Número interno:** a busca é limitada a 30 tentativas por hora por usuário; o identificador não é um telefone pessoal.
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


## Novidades e limites desta versão

- **Arquivos e vídeos:** novos vídeos expiram em 10 dias; documentos não expiram automaticamente. Consulte `LEIA-ANTES-DE-PUBLICAR.md` para ativar o agendador, conhecer limitações e riscos.
- **Vídeos:** a checagem usa amostras de quadros e a lista de imagens configurada; não examina todo o conteúdo e não garante detecção. Arquivos arbitrários e áudios não passam por análise de conteúdo. Não trate o filtro como solução completa de moderação.
- **Hoje:** a função `news` busca notícias; o Open-Meteo fornece clima e busca de cidade. A localização atual depende de permissão. Abrir uma notícia acessa o site de origem.
- **Música:** Audius oferece faixas públicas; a busca iTunes oferece prévias. Disponibilidade e compatibilidade variam e os serviços externos recebem o IP. A CSP restringe mídia e imagens aos domínios configurados; faixas ou capas hospedadas em outros domínios podem não funcionar. Analise cada domínio adicional antes de autorizá-lo.
- **Teste antes de produção:** os testes locais não substituem validação com duas contas e uma instância Supabase real, incluindo upload/download de anexos, expiração, chamadas e permissões. A segurança da implementação não foi auditada.
- O vídeo de apresentação, o cadastro em etapas e o fluxo de restauração a partir da tela bloqueada ainda não foram implementados.
