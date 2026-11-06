# Vídeo de apresentação do SeuChatSeguro

O tour foi criado em React com Remotion. As composições desktop e mobile têm 1280 × 720 px, 30 fps e duração aproximada de 51 segundos; ambas são entregues sem faixa de áudio. O site escolhe a versão conforme a largura da tela.

- `npm run video:studio` abre o Remotion Studio para editar e pré-visualizar as composições.
- `npm run video:render` renderiza os dois MP4s silenciosos para a tela de acesso.
- `npm run video:render:mobile` atualiza apenas a versão mobile.
- `npm run video:poster` e `npm run video:poster:mobile` geram os pôsteres estáticos.

Os comandos de renderização requerem `ffmpeg` para remover a faixa vazia padrão do renderizador. As interfaces do tour são demonstrações visuais com dados fictícios; alguns recursos dependem de configuração, compatibilidade e serviços externos.
