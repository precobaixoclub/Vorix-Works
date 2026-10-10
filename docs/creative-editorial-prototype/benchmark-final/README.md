# Benchmark final — Vorix vs geração direta pelo modelo de imagem

Produção: 5abe0c5 → 8b68109 → 57ebce6 → **26795ca** (2026-10-10). Workspace de QA (Rumo ao Altar).

## Condições

- Mesmos briefings, textos exatos, assets (produto, logo, screenshot), Brand Profiles e formatos
  (`bench/make-bench` gera corpo Vorix e prompt Direct da mesma fonte).
- Direct = `gpt-image-1`, quality medium (o mesmo modelo/qualidade do Vorix), `/v1/images/edits` com os
  assets como imagens de referência e o Brand Profile convertido em instruções naturais
  (`direct/direct-Sx-prompt.txt`). Sem nenhum output/layout do Vorix. Saída 1024×1536 recortada no
  centro para 4:5/9:16 — o prompt avisava o recorte e a área segura.
- Avaliação visual CEGA por um subagente sem acesso à chave: pares A/B sorteados (`blind-key.json`,
  aberta só depois das notas), 10 critérios + vencedor visual + defeitos visíveis + publicável.
- Avaliação técnica (texto exato, fatos, logo, produto, screenshot, marca): gate do Vorix + inspeção.

| Cenário | Perfil | Vorix (execução) | Direct | Técnico | Visual (cego) | Resultado |
|---|---|---|---|---|---|---|
| S1 PRODUCT 4:5 | P3 minimal/corporate | execution-mv2yfiw3-k2ofdz — PASS, publicável | "Presentes. lista"; logo cortada no recorte; produto redesenhado | VORIX | VORIX | VORIX_WIN |
| S2 PRODUCT 9:16 | P2 tech/bold | execution-mv2ygkmv-q0sn6z — PASS, publicável | "e·RSVP", "sò"; logo cortada; produto redesenhado | VORIX | **DIRECT** (mais energia azul/violeta) | VORIX_WIN técnico; visual DIRECT |
| S3 INSTITUTIONAL 4:5 | P1 premium/editorial | execution-mv2yhtrt-92li0j — PASS, publicável | "vocès", "Şite", "confirmaçáo", "presenca"; falta "e"; logo redesenhada | VORIX | VORIX | VORIX_WIN |
| S4 INSTITUTIONAL 9:16 | P3 minimal/corporate | execution-mv2yiuxo-zg8co1 — PASS, publicável | "Conhega", "confirmaçào", "sô"; logo cortada; fundo escuro proibido | VORIX | VORIX | VORIX_WIN |
| S5 DIGITAL 4:5 | P2 tech/bold | execution-mv2zyxqs-3e8y8s — PASS, publicável (avaliado às cegas); pós-correção execution-mv30r5qn-k5m2l0 — PASS, publicável | screenshot redesenhado em texto ilegível; preços inventados "£3.12.00"; "so lugar"; logo/CTA cortados | VORIX | VORIX | VORIX_WIN |
| S6 DIGITAL 9:16 | P1 premium/editorial | execution-mv2ykyor-bsxeg0 — PASS, publicável | screenshot ilegível; preços inventados "RS 7000"; sem logo; sem CTA | VORIX | VORIX | VORIX_WIN |

Vorix: técnico 6/6, publicável 6/6. Direct: publicável 0/6 (todos com cópia corrompida e/ou asset
alterado). Vencedor visual cego: Vorix 5, Direct 1 (S2).

## Achado do benchmark e correção (S5)

A 1ª execução do S5 (execution-mv2yjtgn-mkllen) reprovou: "Criar meu site" = CTA do renderer + barra do
site no screenshot, a visão deslocou as duas bboxes, e a reconciliação pelo ledger exige o scan da base
(falha fechada) — que vinha NOT_AVAILABLE. Causa raiz, provada com chamadas reais: o gpt-4o RECUSAVA a
leitura ("I'm sorry, I can't assist with that.") de bases PNG com alfa logo após a geração; o provider
registrava como "sem conteúdo". Correções: 8b68109 (bytes em memória como data URL com MIME real),
57ebce6 (base achatada sobre cinza para a visão; provider registra a recusa), 26795ca (novas tentativas
espaçadas 15 s/30 s, motivo no diagnóstico). Falha fechada preservada. Execuções: S5 #2
(execution-mv2zyxqs-3e8y8s) passou sem precisar do scan; S5 #3 (execution-mv30d2eb-l2k0z2, após 57ebce6)
reprovou pela mesma recusa; S5 #4 (execution-mv30r5qn-k5m2l0, após 26795ca) scan AVAILABLE, PASS.
Reavaliação local do S5 #1 com o scan real da base (sonda): pass (`S5-vorix-run1/`).

## Custo

16 gerações de imagem (P2 1 + Vorix 6 + Direct 6 + reruns 3) ≈ US$ 1,16; leituras de visão de
diagnóstico (inventário, sondas do scan) ≈ US$ 0,04. Nenhuma peça foi aprovada/publicada no fluxo.
