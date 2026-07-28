# Release Candidate Report — Zuno v1.0-RC1

**Data da homologação:** 2026-07-10
**Escopo:** 55 cenários de `docs/homologacao-v1.0-checklist.md`, executados de fato contra a CLI real do Zuno em `LOCAL_PRODUCTION`, com geração assistida real (PNG/MP4 válidos criados e validados a cada pausa `WAITING_ASSISTED_GENERATION`). Nenhum código foi alterado durante esta etapa — o foco foi exclusivamente homologação e consolidação dos problemas encontrados, conforme determinado para o RC1.
**Lista consolidada de problemas:** `docs/rc1-consolidated-issues.md` (5 bugs/regressões + 5 melhorias/achados menores, todos com ID, severidade, módulo, Skill, reprodução, impacto e recomendação).

---

## 1. Resultado quantitativo

| Métrica | Valor |
|---|---|
| Cenários executados | 55 / 55 |
| **Cenários aprovados** | **39** (33 sem ressalva + 6 aprovados com ressalva) |
| **Cenários reprovados** | **16** |
| **Taxa de aprovação** | **70,9%** (39/55) |

**Cenários reprovados:** 3, 4, 6, 7, 11, 12, 23, 25, 27, 29, 31, 33, 34, 51, 52, 54.
**Cenários aprovados com ressalva** (passaram, mas com um achado registrado que não invalidou o resultado): 16, 18, 20, 22, 26, 55.

### Aprovação por seção da suíte

| Seção | Cenários | Aprovados | Reprovados | Taxa |
|---|---|---|---|---|
| A — Canal × formato (imagem) | 1–12 | 7 | 5 | 58,3% |
| B — Vídeo/Reels | 13–22 | 10 | 0 | 100% |
| C — Categorias de conteúdo | 23–34 | 6 | 6 | 50% |
| D — Campanhas | 35–42 | 8 | 0 | 100% |
| E — Fluxos operacionais/regressões | 43–55 | 8 | 5 | 61,5% |

A pipeline de **vídeo** e o módulo de **Campanhas** saíram com 100% de aprovação — nenhum bug foi encontrado em nenhum dos dois. Toda a reprovação está concentrada na pipeline de **imagem** (Bianca → Pedro) e nos dois fluxos operacionais de regressão dedicados (52 e 54).

---

## 2. Bugs por severidade

| Severidade | Quantidade | IDs |
|---|---|---|
| **Crítica** | 4 | BUG-01 (Story falha), BUG-02 (corte do slide de fechamento), BUG-03 (gerúndio não reconhecido), BUG-04 (colisão de id de execução) |
| **Alta** | 1 | BUG-05 (flag `--` rejeitada + mensagem de exemplo errada) |
| **Média** | 0 | — |
| **Baixa** | 5 | UX-01, MELHORIA-01, MELHORIA-02, MELHORIA-03, GAP-01 |

Detalhes completos de cada item (descrição, reprodução, impacto, recomendação) em `docs/rc1-consolidated-issues.md`.

---

## 3. Melhorias sugeridas (não-bloqueantes)

- **MELHORIA-01:** Priorizar keywords de engajamento explícitas sobre termos de tópico genéricos na classificação do Eduardo (evita que "presentear" enviese para conversão).
- **MELHORIA-02:** Expandir o vocabulário de conversão do Eduardo ("anunciando", "promoção" e termos comerciais correlatos).
- **MELHORIA-03:** Avaliar um rótulo `"video"` genérico no Eduardo, distinto de `"reels"`, para maior precisão em relatórios/logs.
- **UX-01:** Dar ao erro de cliente inexistente uma categoria de validação dedicada, em vez do wrapper genérico `"[zuno] Erro inesperado:"`.
- **GAP-01:** (registrado como limitação conhecida, não bloqueante) Eduardo não influencia a escolha entre pipeline de imagem e de vídeo quando o texto já contém "roteiro" — já mapeado como item de melhoria para a v2.0 na auditoria técnica anterior.

Nenhuma dessas melhorias impede o funcionamento do sistema; todas são candidatas a correção pós-RC1, priorizadas junto com os bugs críticos.

---

## 4. Regressões encontradas

Duas categorias distintas de regressão foram confirmadas nesta homologação:

1. **Regressões conhecidas, agora confirmadas com reprodução real** (já haviam sido sinalizadas por inferência estática na auditoria técnica anterior, `docs/zuno-auditoria-1.0.html`, mas nunca haviam sido reproduzidas em execução real):
   - **BUG-02** (corte do slide de fechamento) — confirmado com evidência direta do `execution-report.json` no Cenário 51.
   - **BUG-04** (colisão de id de execução) — confirmado de forma dramática no Cenário 52, com prova forense (pixel vermelho marcado entregue sob a identidade de um comando totalmente diferente).
   - **BUG-05** (flag `--` rejeitada) — confirmado ao vivo no Cenário 54.

2. **Achados novos, não identificados na auditoria estática anterior:**
   - **BUG-01** (Story com múltiplas telas falha sempre) — só é visível em execução real, pois depende da interação entre a heurística de Bianca e o `imageCount` do Pedro.
   - **BUG-03** (gerúndio/formas conjugadas não reconhecidas na classificação do Eduardo) — só é visível testando frases em português natural, algo que a auditoria estática anterior (baseada em leitura de código) não cobriu.

Nenhuma funcionalidade que antes funcionava passou a falhar — não há regressão no sentido de "quebrou algo que já funcionava". As regressões da categoria 1 são bugs pré-existentes agora comprovados; a categoria 2 são bugs pré-existentes recém-descobertos.

---

## 5. Avaliação da estabilidade do sistema

O sistema é **funcionalmente estável para os fluxos centrais**: a pipeline de vídeo (10/10 cenários), o Campaign Manager (8/8 cenários) e todos os fluxos operacionais de aprovação/rejeição/feedback/retomada (Cenários 43–50, 53) passaram sem nenhuma ressalva. A arquitetura de Skills isoladas, o Developer Assisted Mode e a integração Campaign Manager → Arthur se mostraram robustos sob uso real repetido.

Por outro lado, a pipeline de **imagem** (Bianca → Pedro) tem **dois bugs críticos ativos que afetam a integridade do conteúdo entregue em uso comum**:
- Qualquer Story com mais de 1 tela é hoje **inutilizável** (BUG-01).
- A maioria dos carrosséis fora do objetivo de conversão perde silenciosamente o slide de fechamento/CTA (BUG-02) — o slide mais importante do ponto de vista de negócio.

Some-se a isso um bug de **integridade entre execuções** (BUG-04) que, embora dependa de um padrão de uso específico (duas invocações da CLI em sequência sem isolar diretórios de dados), tem o pior tipo de impacto possível: entrega silenciosa de conteúdo errado sob a identidade de outro pedido, sem qualquer sinalização de erro.

**Conclusão:** o sistema está estável para demonstração e para o fluxo de conversão em carrossel (o caminho mais testado e mais usado), mas **não está pronto para uso irrestrito em produção** enquanto os quatro bugs críticos permanecerem sem correção — especialmente BUG-01 e BUG-02, que afetam formatos e fluxos de uso corriqueiro, não apenas casos extremos.

---

## 6. Recomendação final

- [ ] Pronto para v1.0
- [x] **Necessita RC2**

**Justificativa:** 4 bugs de severidade Crítica confirmados com reprodução real (um deles — BUG-04 — com prova forense de que conteúdo errado pode ser entregue sob a identidade de outro pedido), afetando formatos de uso corriqueiro (Story, carrossel fora do objetivo de conversão). A taxa de aprovação de 70,9% e a concentração de reprovações na pipeline de imagem indicam que uma rodada de correção focada (BUG-01 a BUG-04, nessa ordem de prioridade) seguida de uma nova homologação direcionada aos cenários reprovados (RC2) é necessária antes da liberação da v1.0.

### Recomendação de ordem de correção para o RC2

1. **BUG-04** (colisão de id) — maior risco de integridade, correção já validada em outros módulos (`TimestampRandomIdGenerator`), aplicação direta e de baixo risco.
2. **BUG-02** (corte do slide de fechamento) — afeta a maioria dos carrosséis não-conversão; unificar a contagem de slides entre Eduardo e Bianca.
3. **BUG-01** (Story falha) — mesma causa raiz de fundo do BUG-02 (falta de reconciliação de contagem de telas/slides); corrigir junto com BUG-02.
4. **BUG-03** (gerúndio não reconhecido) — melhora a precisão da classificação, sem risco de quebrar nada existente.
5. **BUG-05** (flag `--`) — isolado, baixo risco, independente dos demais.
6. Melhorias de baixa severidade (UX-01, MELHORIA-01/02/03) — oportunistas, podem entrar na mesma janela de correção.

Após as correções, recomenda-se reexecutar ao menos os cenários hoje reprovados (3, 4, 6, 7, 11, 12, 23, 25, 27, 29, 31, 33, 34, 51, 52, 54) e os aprovados-com-ressalva (16, 18, 20, 22, 26, 55) como suíte de regressão do RC2, sem necessidade de repetir os 33 cenários já aprovados sem ressalva.
