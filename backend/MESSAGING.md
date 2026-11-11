# Chat, mensagens privadas e notificações

## Chat global (💬 CHAT no menu)
- Uma sala para todos os jogadores conectados, em tempo real (Socket.IO), salva no PostgreSQL.
- Cada mensagem mostra nome, ID, cargo, ⭐ de influenciador e horário. No topo aparece quem está conectado.
- Limites: 300 caracteres; até 5 mensagens a cada 10 s; mensagem repetida é recusada por 30 s.
- `@nome` notifica o jogador mencionado.
- Botões em cada mensagem: ✉️ mensagem privada, 🚩 denunciar e 🗑️ apagar (autor, OWNER, ou MOD sobre PLAYER).
- Silenciados não conseguem enviar até o fim do prazo.
- Se a conexão cair, o jogo reconecta sozinho e recarrega o histórico.

## Mensagens privadas (✉️ MSGS no menu)
- Lista de conversas com mensagens não lidas; busca de jogador por nome ou ID.
- Histórico, horário, ✓✓ quando o outro leu, entrega em tempo real.
- Só os dois participantes acessam a conversa. Bloquear impede mensagens nos dois sentidos.
- Limites: 500 caracteres; 10 mensagens a cada 30 s. Cada envio tem um `nonce`: se a internet falhar e o jogo reenviar, a mensagem não duplica.
- 🚩 em uma mensagem anexa ela à denúncia.

## Notificações (🔔 no menu)
Aparecem como aviso dentro do jogo (até no meio da partida) e ficam salvas com ID, conteúdo, data, hora e estado de leitura:
mensagens privadas, menções no chat, silenciamento, compras, recompensas de código, mudança de cargo, influenciador concedido/removido, 999.000 moedas, KICK, BAN, UNBAN, denúncias e conquistas.
