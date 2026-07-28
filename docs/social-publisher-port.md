# SocialPublisherPort

`SocialPublisherPort` é a porta de aplicação responsável por representar publicação social orgânica em um único canal por chamada. Ela fica em `src/application/ports/social-publisher.port.ts` para que Skills como Ana dependam de uma abstração estável, enquanto adapters reais de Instagram, Facebook, LinkedIn, TikTok, YouTube ou qualquer outra rede vivem apenas em infraestrutura.

O contrato continua deliberadamente pequeno: quem chama a porta monta um `SocialPostDraft` para cada canal, e o adapter decide como traduzir aquele draft para a API concreta. Publicação simultânea em múltiplos canais não pertence à porta; pertence à Skill ou ao caso de uso que está orquestrando a operação. Isso evita que um adapter de Instagram precise saber qualquer coisa sobre Facebook, e evita que uma futura publicação em TikTok contamine o domínio de Ana.

## Tipos de mídia

`SocialPostDraft.mediaType` diferencia explicitamente três cenários:

- `image`: uma imagem única, usando `assetUris` com um item.
- `carousel`: múltiplas imagens, usando `assetUris` com vários itens.
- `video`: um vídeo final, usando `videoUri` e, quando existir, `thumbnailUri`, `duration`, `mimeType` e `videoMetadata`.

Para vídeo, `assetUris` continua existindo como lista genérica de mídia, mas `videoUri` é o campo principal. Isso deixa o payload claro para adapters que precisam separar `image_url` de `video_url`, sem remover a compatibilidade com fluxos que ainda esperam uma lista genérica.

Em publicação real, os valores enviados ao `SocialPublisherPort` devem ser URLs públicas. Caminhos locais são responsabilidade de `ArtifactHostingPort`, que deve ser acionada antes da porta social. Em `dry_run`, Ana pode devolver no payload simulado caminhos locais para inspeção, mas ela não chama `SocialPublisherPort` nesse modo.

## Capabilities do provider

`SocialPublisherCapabilities` possui:

- `supportsScheduling`: indica se o provider aceita agendamento diretamente.
- `supportedMediaTypes`: mapa opcional por canal com os tipos aceitos pelo adapter.

Se `supportedMediaTypes` não for informado, Ana assume compatibilidade ampla para preservar adapters antigos e fakes de teste. Quando informado, Ana valida antes de chamar `publish` ou `schedule`. Exemplo: um provider pode declarar que `instagram` aceita `image`, `carousel` e `video`, enquanto `facebook` aceita apenas `image` e `video`.

## Resultado

`SocialPublicationResult` continua unificado para publicação imediata e agendada. O adapter deve devolver `externalId` e `url` quando o provider real fornecer esses dados. Falhas devem retornar `status: "failed"` com `SocialPublicationError`, evitando exceções não estruturadas no domínio. Exceções ainda podem ocorrer, mas Ana captura e converte em erro por canal.

## Limites atuais

A porta não hospeda mídia, não assina URLs, não converte arquivos locais em URLs públicas e não agenda por conta própria. Se uma rede exigir mídia pública em HTTPS, `ArtifactHostingPort` precisa garantir isso antes da publicação real. A porta também não implementa retry, fila ou worker; esses pontos pertencem a uma camada futura de scheduler/infraestrutura.
