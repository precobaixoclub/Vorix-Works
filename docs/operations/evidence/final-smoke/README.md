# Smoke real final do release hardening — SERVICE_DIGITAL 4:5 + Brand Profile P2

Produção 8112d87 (código = 3603d4e). Execução `execution-mv3c0vtl-kpmwps` (`cer-runtime-mv3c0vqq-7exvls`)
— **PASS, publicável** (`waiting_for_approval`; não aprovada nem publicada). 1 geração, US$ 0,0748.

| Verificação | Resultado |
|---|---|
| Acesso a asset privado | logo da biblioteca (`assets/<tenant>/<ws>/…`, privada) e screenshot de QA lidos por chave; base/final gravados privados (as URLs canônicas dão 404 sem assinatura; estas imagens foram baixadas por `POST /v1/files/sign`) |
| Isolamento | listagem da biblioteca devolveu URL assinada (preview 200; a mesma URL sem assinatura: 404); a URL persistida é a canônica |
| Scan da base | AVAILABLE (visionTextBrain / gpt-4.1), sem recusa |
| Inventário do screenshot | cache HIT, decisão do gate USED (18 textos) |
| Brand Profile | BRAND_DENSITY, BRAND_SURFACES, BRAND_LOGO_VARIANT, BRAND_TYPOGRAPHY (caixa alta), BRAND_SHAPE, BRAND_ACCENT |
| Fidelidade | screenshot e logo visíveis, assetMatchRatio 1 |
| Quality gate | pass, zero issues; geometria final do renderer; variante UI_HERO |
