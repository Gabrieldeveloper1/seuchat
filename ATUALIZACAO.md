# Atualização do SeuChatSeguro

## O que mudou
- A imagem indicada para grupos sem logo foi incluída localmente em `public/default-group.jpg` (origem: https://static.vecteezy.com/ti/vetor-gratis/p1/26019617-grupo-perfil-avatar-icone-padrao-social-meios-de-comunicacao-forum-perfil-foto-vetor.jpg). Verifique os termos de licença da imagem antes da distribuição.
- Fotos de grupos agora são exibidas; há compressão compatível com os limites de envio e recebimento. Falhas de sincronização dos dados de grupo são informadas.
- A caixa de texto libera o envio seguinte sem esperar o servidor. O texto é recuperado quando o envio falha.
- Indicadores de digitação cifrados e status de presença para contatos aceitos, com horário aproximado de última atividade observada neste aparelho. A presença é consultada enquanto uma conversa individual está aberta. Sinais de digitação em grupos são enviados a membros que também são contatos aceitos. Versões antigas do aplicativo não exibem ou respondem a esses indicadores; ambos os participantes precisam atualizar. O status pode atrasar ou ficar indisponível, especialmente se o aplicativo estiver fechado ou em segundo plano. Após tentativas sem resposta, é necessário voltar à conversa ou à aba para consultar novamente.
- A interface, cores, animações e responsividade foram atualizadas; as animações respeitam a preferência de movimento reduzido.

## Importante antes de publicar
- O servidor TURN continua necessário para ocultar o IP em chamadas. Sem ele, o aplicativo não pode prometer proteção de IP. Configure e habilite o TURN conforme o README; o recurso relay-only não foi removido do código.
- O filtro de imagens não foi desativado: com a configuração segura padrão, é preciso configurar uma lista assinada válida para enviar e receber imagens, inclusive logos. Os textos de diagnóstico detalhados foram simplificados, mas a indisponibilidade continua sendo informada. Usar `VITE_REQUIRE_BLOCKLIST=false` desativa a exigência da lista e não equivale a um filtro operacional.
- A presença e a digitação usam o relay cifrado existente e geram tráfego adicional; sinais temporários podem ficar na fila enquanto o destinatário estiver desconectado. Avalie limites e custos antes de usar em escala. A última atividade é aproximada, não uma prova definitiva de conexão.
- Rode `npm ci`, `npm test` e `npm run build`; configure Supabase e as variáveis de ambiente conforme o README. Teste com duas contas e o servidor real, inclusive grupos, imagens, interrupção de rede e chamadas, antes de colocar em produção. Não foi possível validar esses fluxos ponta a ponta sem credenciais de um servidor.

## Atualização "Black Chique"

- **Nova identidade visual:** tema preto profundo com dourado champanhe (padrão) e tema claro "Marfim".
- **Nova marca:** logo (balão de conversa com fechadura), favicon, ícones do app (192, 512, maskable e Apple) e banner `public/brand-banner.jpg`, usado como capa padrão de perfis e grupos.
- **Tela de abertura animada:** aparece instantaneamente enquanto o app carrega (`index.html` + `src/components/Splash.tsx`).
- **Menu do computador:** barra lateral fixa com ícones, dicas ao passar o mouse e foto de perfil com status.
- **Menu do celular:** barra flutuante com efeito de vidro e indicador animado.
- **Nova área de Ajustes:** seções Perfil, Privacidade, Aparência e Conta, com cartão de perfil, interruptores e escolha visual de tema.
- **Emojis completos:** seletor com todo o catálogo Unicode (versão 18.0), busca, categorias, recentes e tom de pele. Emojis que o aparelho não consegue exibir são ocultados automaticamente. O seletor só é baixado quando aberto.
- **Mais ícones SVG:** categorias de emojis, ajustes, botões de carregamento (ícone girando) e estados vazios.
- **Botões novos:** dourado com brilho ao passar o mouse, variações compactas, de perigo e discretas.

Nada no banco de dados ou nas Edge Functions precisa ser alterado por esta atualização.


## Versão em andamento: mídias, Hoje e Música

- Menu sem nome repetido: logo no rail de desktop e no cabeçalho no celular.
- Interface de anexos e gravação, player de voz com velocidade, efeitos sonoros com opção de desligar, e sons e indicador de voz em chamadas.
- Páginas Hoje (Open-Meteo e notícias) e Música (Audius e prévias iTunes), mais miniplayer. Aviso de Caps Lock, dicas de senha e validação/colagem da frase de recuperação.
- Configuração necessária: executar `006_attachments.sql` e publicar `attachments` e `news`; ver README para restrições de segurança e privacidade.
- Compilação e 13 testes unitários passaram. A navegação das páginas foi conferida em prévia local no desktop e celular com conta fictícia; anexos, chamadas e notícias não foram testados ponta a ponta em servidor real.
- Pendente: vídeo de apresentação, cadastro em etapas, restauração pela tela bloqueada e revisão abrangente da segurança.
