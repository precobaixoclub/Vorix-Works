/**
 * Bloco "roteamento por equipe" (réplica adaptada do CMDesk `ChannelRoutingConfig`, pedido
 * explícito do usuário) — versão simplificada: só `defaultTeamId` + distribuição "default" (sempre
 * a mesma equipe) vs "round_robin" (rodízio entre as equipes vinculadas ao canal). Sem menu
 * hierárquico, sem sticky/pinned por contato+canal — fora de escopo desta rodada (subsistemas
 * grandes o suficiente pra merecer rodada própria).
 */

export const CHANNEL_DISTRIBUTION_MODES = ["default", "round_robin"] as const;
export type ChannelDistributionMode = (typeof CHANNEL_DISTRIBUTION_MODES)[number];

export type ChannelRoutingConfig = {
  id: string;
  connectionId: string;
  defaultTeamId: string;
  distributionMode: ChannelDistributionMode;
  createdAt: string;
  updatedAt: string;
};

export type ChannelRoutingRepositoryPort = {
  /** Substituição total (mesmo idioma do CMDesk: "salvar canal" sempre reescreve a lista inteira de
   * equipes vinculadas, nunca um patch incremental) — único jeito de mudar o vínculo, nunca
   * link/unlink individuais (nenhum caso de uso real precisa disso além de "salvar o formulário"). */
  replaceLinkedTeams(connectionId: string, teamIds: readonly string[]): Promise<void>;
  listTeamIdsByConnection(connectionId: string): Promise<string[]>;
  upsertRoutingConfig(input: { connectionId: string; defaultTeamId: string; distributionMode: ChannelDistributionMode }): Promise<ChannelRoutingConfig>;
  getRoutingConfig(connectionId: string): Promise<ChannelRoutingConfig | undefined>;
  /**
   * Resolve a equipe pra uma conversa NOVA nesse canal. `DEFAULT` sempre devolve `defaultTeamId`
   * (nunca avança ponteiro nenhum). `ROUND_ROBIN` gira circularmente entre as equipes vinculadas,
   * serializado por lock advisory (mesmo padrão do round-robin de agentes) — a implementação real
   * vive só no adapter Postgres. Sem config nem equipe vinculada → `undefined` (quem chama decide
   * o que fazer: conversa fica sem equipe).
   */
  resolveTeamForNewConversation(connectionId: string): Promise<string | undefined>;
};
