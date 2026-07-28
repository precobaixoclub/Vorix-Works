# Visual Asset Resolver

O Visual Asset Resolver é a infraestrutura local que permite a pipeline de vídeo escolher imagens reais por cena sem que o usuário selecione manualmente cada arquivo. Ele não é uma Skill, não altera Arthur, Caio ou Helena e não conversa diretamente com Vanessa, Diego ou Rafa por implementação concreta. A integração acontece por porta de aplicação (`VisualAssetResolverPort` / `VisualAssetProviderPort`), preservando Clean Architecture e mantendo provedores externos fora das Skills.

## Responsabilidade

O resolver recebe consultas visuais derivadas da direção de Vanessa e do plano técnico de Diego. Para cada cena, ele entende o que deve aparecer, a emoção, o tipo de imagem, enquadramento, movimento, iluminação, função narrativa, tags, resolução e proporção. Com isso, ele procura primeiro em uma biblioteca local, depois em provedores gratuitos configurados por manifesto, pontua os candidatos e escolhe automaticamente o melhor asset. Se não houver asset adequado, ele não usa placeholder e não inventa fundo silenciosamente: gera um pacote de criação para Developer Assisted Mode com prompt visual completo, resolução, proporção, tags, licença e caminho exato para salvar.

## Providers

A porta `VisualAssetProviderPort` permite adicionar provedores futuros como Pexels, Pixabay, Unsplash, Cloud storage próprio ou qualquer biblioteca interna sem mudar Vanessa, Diego ou Rafa. Nesta fase existem dois adapters locais:

- `LocalVisualAssetLibrary`: lê `assets/visual/library/manifest.json` quando existir; se não existir, escaneia imagens `.png`, `.jpg` e `.jpeg` em `assets/visual/library`.
- `ManifestFreeVisualAssetProvider`: lê `assets/visual/free/manifest.json`, preparado para entradas com arquivo local ou `downloadUrl`, sempre registrando autor, origem e licença.

## Manifesto local

O manifesto de assets é uma lista JSON. Exemplo:

```json
[
  {
    "id": "casal-usando-celular-site-casamento",
    "path": "casal-usando-celular-site-casamento.png",
    "provider": "local-visual-library",
    "origin": "local_library",
    "author": "Equipe Rumo ao Altar",
    "sourceUrl": "local://assets/visual/library",
    "license": {
      "name": "Arquivo próprio",
      "allowsCommercialUse": true,
      "requiresAttribution": false
    },
    "tags": ["casamento", "casal", "celular", "site", "rumo-ao-altar"],
    "theme": "Casal usando celular para acessar site de casamento",
    "emotion": "tranquilidade",
    "kind": "photo"
  }
]
```

Nenhuma imagem deve ser usada sem licença registrada quando vier de manifesto. Quando o adapter apenas escaneia arquivos locais sem manifesto, a licença assumida é “Arquivo local do usuário”, uso comercial permitido e sem atribuição obrigatória.

## Pontuação

Cada candidato recebe score por aderência ao tema, compatibilidade com a cena, emoção, proporção, qualidade, fit de marca, possibilidade de crop e consistência. A nota mínima padrão é 62. A imagem escolhida, seu score e o breakdown ficam registrados em `artifacts/<executionId>/visual-assets/asset-report.json`.

## Developer Assisted Mode

Quando não há asset adequado, o workflow pausa com `pendingVisualAssets`. A CLI imprime o caminho e o prompt completo para cada cena. O usuário/IA desenvolvedora salva os arquivos em:

```text
artifacts/<executionId>/visual-assets/scene-01.png
artifacts/<executionId>/visual-assets/scene-02.png
...
```

Ao rodar `npm run zuno -- --continue <executionId>`, o resolver valida os arquivos criados, verifica se são PNG/JPG reais, exige resolução mínima de 640px por lado e transforma cada arquivo em asset `developer_assisted`, com licença registrada para uso local do cliente. Só então Rafa renderiza o vídeo.

## CLI

Comandos disponíveis:

```bash
npm run zuno -- --assets-scan
npm run zuno -- --assets-list
npm run zuno -- --assets-report
```

`--assets-scan` escaneia biblioteca local e provedores por manifesto. `--assets-list` lista cada asset com origem, licença, tags e resolução. `--assets-report` mostra o resumo por provider, origem e licença.

## Garantias

- Rafa nunca passa caminho `file://` para rede social.
- Rafa nunca usa placeholder quando uma cena exige fotografia/imagem real e o resolver está configurado.
- Vanessa e Diego não conhecem APIs externas.
- O registro de origem/licença fica no relatório de assets.
- A pipeline de imagem do Pedro permanece isolada e não depende dessa infraestrutura.

## Limitações atuais

Ainda não há integração real com Pexels, Pixabay ou Unsplash. O provider gratuito por manifesto prepara o contrato, mas a curadoria de fontes externas ainda é manual. O score é determinístico e simples; uma fase futura pode usar embeddings locais ou análise visual real para melhorar relevância, consistência estética e deduplicação.
