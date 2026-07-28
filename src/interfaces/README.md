# Interfaces

Pontos de entrada da aplicação. A CLI (`src/interfaces/cli`) já está implementada — `npm run zuno -- "<comando>"` executa o fluxo completo Arthur → Caio → Helena → Skills (ver `src/interfaces/cli/README.md`). API e painel web ainda são pontos de entrada futuros. Em todos os casos, uma interface aciona apenas a camada de aplicação e nunca conversa diretamente com infraestrutura ou Skills específicas.
