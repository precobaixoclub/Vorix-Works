# Brand Profile — homologação real P2 (tech/bold) — C service_digital 4:5 — execution-mv2rf3ac-br7a57

- Resultado: failed — COLOR_PALETTE_VIOLATED. Peça visualmente correta e na identidade P2: superfície
  azul/violeta da marca, CTA pílula violeta, headline em caixa alta, logo da biblioteca (variante).
- Causa: falso positivo da visão — julgou a "cor predominante" da imagem inteira, dominada pelo
  screenshot REAL (branco/rosa da UI), que nunca pode ser recolorido.
- Correção: quando o renderer comprova a paleta estruturada aplicada (BRAND_SURFACES + BRAND_ACCENT),
  o veredito de paleta da visão vira diagnóstico (VISION_PALETTE_OVERRIDDEN_BY_RENDERER), registrado na
  provenance da marca; o prompt manda ignorar cores de assets reais. Sem prova determinística (marca só
  com cores legadas), a regra antiga continua.
- Custo US$ 0,0744; 1 imagem.
