# Riscos e decisões iniciais

O principal risco arquitetural é permitir que Arthur execute tarefas operacionais. Se isso acontecer, o orquestrador vira uma Skill disfarçada e o sistema perde separação de responsabilidades. Outro risco é permitir que Skills conversem diretamente entre si, criando dependências ocultas difíceis de testar e substituir.

Também existe risco de acoplamento com provedores externos. Se uma futura Skill importar SDK da OpenAI, Meta ou qualquer rede social diretamente, a Skill ficará difícil de reaproveitar e testar. O caminho correto é usar portas de aplicação e adaptadores de infraestrutura.

Outro risco é antecipar banco de dados, servidor ou painel antes da primeira Skill estar bem definida. Por isso, esta fundação permanece local-first e sem persistência real. A arquitetura está preparada para crescer, mas não força complexidade antes da hora.

A decisão por TypeScript foi tomada por permitir tipagem forte, execução local simples no VS Code, organização modular, facilidade futura para CLI, API, painel web e integração com SDKs modernos.
