# Alterações e publicação

## O que mudou

- O cadastro não pede telefone. O servidor gera um identificador único no formato `10259-5251`; contas existentes recebem um na próxima entrada.
- Busca de contatos pelo número interno, com limite de consultas por usuário.
- Chamadas de voz/vídeo em grupo por malha WebRTC (até 5 pessoas).
- Configuração de relay-only usando credenciais TURN temporárias, assinadas no servidor.
- Grupos com descrição, avatar/banner, cargos, permissões de mensagens/chamadas, cargo automático, auditoria com acesso por cargo e menções `@`.
- O cargo inicial `@Everyone` não recebe permissões. O dono deve criar/atribuir cargos para liberar envio ou chamadas.
- O filtro de imagens falha fechado quando não existe uma lista assinada válida.
- Ajustes visuais responsivos para perfis de grupo, cargos, auditoria, menções e mosaico de chamadas.

## Antes de publicar

1. Aplicar `supabase/migrations/005_app_number_directory.sql`.
2. Publicar `app-number`, `app-number-lookup` e `turn-credentials`, além das funções já usadas pelo app. No painel manual, há cópias em `supabase-painel/`.
3. Para ocultação de IP, configurar Coturn com credenciais REST, gravar `TURN_URL` e `TURN_SHARED_SECRET` como segredos de servidor no Supabase e definir `VITE_TURN_ENABLED=true` no build.
4. Obter uma lista de hashes de um provedor autorizado, assiná-la com a chave correspondente a `VITE_BLOCKLIST_PUBKEY` e publicar `public/blocklist.json`. Sem isso, envio e exibição de imagens ficam bloqueados por segurança.
5. Fazer redeploy do frontend após alterar as variáveis Vite.

Validação executada: `npm run typecheck`, `npm test` (10 testes) e `npm run build`.