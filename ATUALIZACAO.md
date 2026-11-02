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
