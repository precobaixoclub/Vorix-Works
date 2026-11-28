-- 0213 — Vídeos nos materiais da marca: tipos de material próprios para vídeo (o "Tipo do material"
-- só tinha tipos de imagem). Aditivo: amplia a lista do CHECK; nenhum material existente muda.
--   video_produto        produto em uso/detalhe (vira gravação no Criar vídeo)
--   video_institucional  bastidores, equipe, loja
--   gravacao_tela        demonstração de site/app (gravação de tela no editor)
--   video_referencia     exemplo de estilo/narração para a IA seguir

alter table assets drop constraint if exists assets_material_type_check;

alter table assets
  add constraint assets_material_type_check check (material_type is null or material_type in (
    'logo_principal', 'logo_secundaria', 'screenshot_site', 'screenshot_app', 'produto',
    'foto_institucional', 'referencia_visual', 'selo', 'icone', 'fundo', 'campanha', 'outro',
    'video_produto', 'video_institucional', 'gravacao_tela', 'video_referencia'
  ));
