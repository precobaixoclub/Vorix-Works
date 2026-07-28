# assets/audio/music/

Pasta padrão para músicas locais fornecidas manualmente ao Zuno (ver `--music` na CLI).

Coloque aqui o arquivo de música que deseja usar em um vídeo e informe o caminho ao rodar a CLI:

```
npm run zuno -- --music "assets/audio/music/minha-musica.mp3" "Crie um Reels..."
```

Ou ao retomar uma execução já em andamento, antes da etapa de renderização de vídeo:

```
npm run zuno -- --continue <executionId> --music "assets/audio/music/minha-musica.mp3"
```

Formatos aceitos: `.mp3`, `.wav`, `.m4a`, `.aac`.

O Zuno nunca baixa música da internet e nunca cria uma trilha automaticamente — se nenhum arquivo
for informado, o vídeo é renderizado sem áudio e um aviso claro é registrado no relatório final.
