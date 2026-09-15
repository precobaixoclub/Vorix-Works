import type { Pool } from "pg";
import type { ChannelDistributionMode, ChannelRoutingConfig, ChannelRoutingRepositoryPort } from "../../../application/ports/channel-routing-repository.port.js";
import { withIdentityLock } from "./identity-advisory-lock.js";

const linkIdGenerator = () => `mctlink-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const configIdGenerator = () => `chanrouting-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

type ConfigRow = {
  id: string; connection_id: string; default_team_id: string; distribution_mode: string;
  last_team_round_robin_index: number; created_at: Date; updated_at: Date;
};

export class PostgresChannelRoutingRepository implements ChannelRoutingRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async linkTeam(connectionId: string, teamId: string): Promise<void> {
    await this.pool.query(
      "insert into messaging_connection_teams (id, connection_id, team_id) values ($1, $2, $3) on conflict (connection_id, team_id) do nothing",
      [linkIdGenerator(), connectionId, teamId],
    );
  }

  async unlinkTeam(connectionId: string, teamId: string): Promise<void> {
    await this.pool.query("delete from messaging_connection_teams where connection_id = $1 and team_id = $2", [connectionId, teamId]);
  }

  async replaceLinkedTeams(connectionId: string, teamIds: readonly string[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("delete from messaging_connection_teams where connection_id = $1", [connectionId]);
      for (const teamId of teamIds) {
        await client.query(
          "insert into messaging_connection_teams (id, connection_id, team_id) values ($1, $2, $3) on conflict (connection_id, team_id) do nothing",
          [linkIdGenerator(), connectionId, teamId],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async listTeamIdsByConnection(connectionId: string): Promise<string[]> {
    const result = await this.pool.query<{ team_id: string }>(
      "select team_id from messaging_connection_teams where connection_id = $1 order by created_at asc",
      [connectionId],
    );
    return result.rows.map((row) => row.team_id);
  }

  async upsertRoutingConfig(input: { connectionId: string; defaultTeamId: string; distributionMode: ChannelDistributionMode }): Promise<ChannelRoutingConfig> {
    const result = await this.pool.query<ConfigRow>(
      `insert into inbox_channel_routing_configs (id, connection_id, default_team_id, distribution_mode)
       values ($1, $2, $3, $4)
       on conflict (connection_id) do update set
         default_team_id = excluded.default_team_id,
         distribution_mode = excluded.distribution_mode,
         updated_at = now()
       returning *`,
      [configIdGenerator(), input.connectionId, input.defaultTeamId, input.distributionMode],
    );
    return this.toDomain(result.rows[0]);
  }

  async getRoutingConfig(connectionId: string): Promise<ChannelRoutingConfig | undefined> {
    const result = await this.pool.query<ConfigRow>("select * from inbox_channel_routing_configs where connection_id = $1", [connectionId]);
    return result.rows[0] ? this.toDomain(result.rows[0]) : undefined;
  }

  async resolveTeamForNewConversation(connectionId: string): Promise<string | undefined> {
    const config = await this.getRoutingConfig(connectionId);

    if (config?.distributionMode !== "round_robin") {
      // DEFAULT (ou sem config nenhuma) — equipe fixa se configurada; senão, a primeira vinculada
      // ao canal (fallback final, mesmo racional do CMDesk).
      if (config?.defaultTeamId) return config.defaultTeamId;
      const linked = await this.listTeamIdsByConnection(connectionId);
      return linked[0];
    }

    const linkedTeamIds = await this.listTeamIdsByConnection(connectionId);
    if (linkedTeamIds.length === 0) return config.defaultTeamId;

    return withIdentityLock(this.pool, `channel-roundrobin:${connectionId}`, async (client) => {
      const pointerResult = await client.query<{ last_team_round_robin_index: number }>(
        "select last_team_round_robin_index from inbox_channel_routing_configs where connection_id = $1",
        [connectionId],
      );
      const pointer = pointerResult.rows[0]?.last_team_round_robin_index ?? 0;
      const index = pointer % linkedTeamIds.length;
      const selected = linkedTeamIds[index];
      await client.query(
        "update inbox_channel_routing_configs set last_team_round_robin_index = $2, updated_at = now() where connection_id = $1",
        [connectionId, index + 1],
      );
      return selected;
    });
  }

  private toDomain(row: ConfigRow): ChannelRoutingConfig {
    return {
      id: row.id,
      connectionId: row.connection_id,
      defaultTeamId: row.default_team_id,
      distributionMode: row.distribution_mode as ChannelDistributionMode,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }
}
