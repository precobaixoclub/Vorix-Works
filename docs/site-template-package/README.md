# Pacote de Modelo Vorix

Formato para importar modelos de site criados fora do Vorix. Documentação pública:
`/modelos/importar` (`web/app/modelos/importar/page.tsx`, conteúdo em
`web/features/sites/template-package-docs.ts`).

- Contrato e códigos de validação: `src/domain/sites/site-template-package.ts`
- Validador/leitor do .zip: `src/infrastructure/sites/site-template-package-reader.ts`
- API: `POST /v1/sites/:id/template-packages/validate`, `POST|GET /v1/sites/:id/template-packages`,
  `GET|DELETE /v1/sites/:id/template-packages/:templateId`
- Vitrine: `web/components/sites/ImportedSection.tsx` (árvore segura → React, nunca HTML cru)
- Editor: `web/components/sites/TemplateImportPanel.tsx` (aba Modelos)

## Pacote de exemplo

`example/` é o modelo de referência. Depois de alterar algum arquivo, gere de novo o .zip
publicado em `web/public/site-assets/vorix-modelo-exemplo.zip`:

```
node scripts/build-site-template-example.mjs
```

`tests/site-template-package.test.mjs` exige que o exemplo passe sem erros nem avisos e que
todo código de validação esteja explicado na documentação pública.
