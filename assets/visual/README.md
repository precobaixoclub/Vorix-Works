# Assets visuais

Use esta pasta para imagens que o Zuno pode selecionar automaticamente em vídeos.

- `library/`: imagens próprias/locais do projeto.
- `library/manifest.json`: manifesto opcional com tags, origem e licença.
- `free/manifest.json`: manifesto opcional para imagens gratuitas externas já baixadas ou com `downloadUrl`.
- `.cache/`: cache local usado por providers por manifesto quando houver download permitido.

Veja `docs/visual-asset-resolver.md` para o formato completo do manifesto e os comandos:

```bash
npm run zuno -- --assets-scan
npm run zuno -- --assets-list
npm run zuno -- --assets-report
```
