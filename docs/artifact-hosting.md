# ArtifactHostingPort

`ArtifactHostingPort` é a porta de aplicação responsável por transformar um artefato local produzido pelo Zuno em uma URL pública segura para publicação real. Ela existe porque Pedro e Rafa podem gerar arquivos em `artifacts/`, mas providers como Meta não consomem caminhos locais, `file://` ou arquivos internos do projeto. Antes de Ana chamar `SocialPublisherPort` em `publish_now` ou `schedule`, qualquer mídia local precisa passar por essa porta.

## Responsabilidade

A porta recebe um `ArtifactHostingInput` com `sourceUri`, `executionId`, tipo de mídia, nome/extensão/tamanho/mimeType quando disponíveis e metadados livres. Uma implementação real deve validar existência do arquivo, extensão, tipo, tamanho, permissões e configuração do destino, fazer upload para o storage escolhido e devolver um `ArtifactHostingResult` com `publicUrl`, `provider`, metadados e erro estruturado quando falhar.

Essa porta não pertence ao Pedro, Rafa ou Ana. Pedro e Rafa continuam produzindo artefatos. Ana apenas solicita hospedagem quando precisa publicar de verdade. O provider concreto — Cloudflare R2, AWS S3, Google Cloud Storage, Supabase Storage, storage próprio ou servidor temporário em desenvolvimento — fica em infraestrutura.

## Comportamento na Ana

No modo oficial atual, `LOCAL_PRODUCTION`, Ana não chama `ArtifactHostingPort`. Mesmo quando o comando natural pede publicação, o workflow continua local: Ana valida o pacote, monta o payload, retorna `local_ready`/`dry_run` e deixa claro que nada foi publicado, nada foi hospedado e nenhuma URL pública foi criada. Esse modo evita a gambiarra de tratar caminho local ou `file://` como URL pública.

Em `dry_run`, Ana não exige URL pública e não chama `ArtifactHostingPort`. O payload simulado pode mostrar caminhos locais, pois nada é enviado ao provider real.

Em `publish_now` e `schedule`, Ana exige que todas as mídias estejam em `https://` ou `http://`. Se a mídia já estiver pública, Ana chama `SocialPublisherPort` diretamente. Se a mídia estiver local e `ArtifactHostingPort` estiver configurada, Ana hospeda cada item antes de montar o draft final. Se a mídia estiver local e não houver hosting configurado, Ana falha com erro `ARTIFACT_HOSTING_FAILED` antes de chamar o publisher.

Ana nunca envia `file://`, caminho local do Windows, caminho relativo de `artifacts/` ou qualquer URI local para provider real. Para carrossel, cada slide é hospedado separadamente. Para vídeo, o arquivo principal e a thumbnail, quando existir, são hospedados separadamente.

## Implementação inicial

`LocalFakeArtifactHosting` vive em `src/infrastructure/artifacts/local-fake-artifact-hosting.ts`. Ela é uma implementação segura para desenvolvimento e testes: valida arquivo local, extensão e tamanho, mas devolve uma URL determinística em domínio `.invalid`. Ela não é injetada automaticamente no runtime para evitar que uma publicação real use uma URL falsa sem perceber.

## Próximos providers

Cloudflare R2 ou AWS S3 devem implementar a mesma porta, mantendo a Ana intacta. O adapter real precisará resolver o arquivo local a partir de `sourceUri`/`executionId`, validar tipo e tamanho, enviar ao bucket, configurar ACL/presigned URL ou URL pública, devolver `publicUrl` HTTPS e metadados como bucket, key, eTag, region, contentType, expiresAt e provider.
