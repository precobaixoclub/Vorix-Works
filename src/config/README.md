# Configuração

Contém exemplos de configuração local. Credenciais reais não devem ser versionadas. Como a fase atual não possui integrações, este diretório apenas prepara o formato futuro de configuração.

O campo `skills.directory` deve apontar para o diretório de Skills **compiladas**, `dist/skills`, e não para `src/skills`. `FileSystemSkillModuleLoader` importa o entrypoint (`./index.js`) como módulo JavaScript real, então a descoberta precisa acontecer no mesmo diretório onde `npm run build` gera o código compilado e copia os `skill.manifest.json`. Veja `docs/skills-build-and-discovery.md` para o detalhamento completo do processo.
