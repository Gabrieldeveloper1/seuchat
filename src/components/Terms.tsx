import Dialog from "./Dialog";

const contact = import.meta.env.VITE_CONTACT_EMAIL || "suporte@seudominio.com";

// ATENÇÃO: modelo de texto. Revise com um advogado antes de publicar (LGPD, Marco Civil, ECA Digital).
export default function Terms({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Termos e Privacidade" onClose={onClose}>
      <div className="small" style={{ display: "grid", gap: 12 }}>
        <h3>Uso permitido</h3>
        <p>O SeuChatSeguro é um mensageiro privado para pessoas com 18 anos ou mais. Você é responsável pelo que envia.</p>
        <h3>Tolerância zero</h3>
        <p>
          É proibido enviar, solicitar ou compartilhar qualquer conteúdo de abuso ou exploração sexual de crianças e
          adolescentes (CSAM), além de ameaças, perseguição, golpes e conteúdo ilegal. Imagens são verificadas no seu
          aparelho antes do envio. Violações verificadas resultam em banimento permanente e podem ser comunicadas às
          autoridades competentes.
        </p>
        <h3>Denúncia e bloqueio</h3>
        <p>
          Toda mensagem recebida pode ser denunciada pelo ícone de bandeira. Ao denunciar, você compartilha com a moderação
          apenas aquela mensagem e as provas criptográficas de que ela veio do remetente. Você também pode bloquear qualquer
          contato.
        </p>
        <h3>Seus dados</h3>
        <p>
          Não pedimos e-mail. O telefone é opcional: se você informar, guardamos apenas um código irreversível (HMAC) dele para outras pessoas te acharem pelo número. Suas mensagens são cifradas de ponta a ponta: o servidor guarda apenas texto
          cifrado até a entrega e o apaga em seguida (no máximo 30 dias se você ficar offline). O histórico fica somente neste
          aparelho, cifrado com sua senha. Se você perder a senha e a frase de recuperação, não é possível recuperar a conta.
          Para excluir tudo, use Configurações → Excluir conta.
        </p>
        <h3>Limites desta versão web</h3>
        <p>
          Navegadores não conseguem impedir capturas de tela nem garantir a destruição de mensagens em aparelhos de terceiros.
          Não envie nada que você não aceite que o outro lado possa registrar.
        </p>
        <h3>Contato</h3>
        <p>
          Dúvidas, denúncias e pedidos sobre dados (LGPD): <a href={`mailto:${contact}`}>{contact}</a>. No Brasil, você também
          pode denunciar abuso sexual infantil à SaferNet (safernet.org.br) ou pelo Disque 100.
        </p>
      </div>
    </Dialog>
  );
}
