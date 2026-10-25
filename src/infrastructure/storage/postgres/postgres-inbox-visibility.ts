import type { InboxConversationVisibility } from "../../../application/ports/inbox-conversation-repository.port.js";

export function inboxVisibilitySql(visibility: InboxConversationVisibility | undefined, params: unknown[], alias = "c"): string {
  if (!visibility) return "true";
  params.push([...visibility.userIds], [...visibility.teamIds], [...visibility.queueTeamIds], visibility.ownUserId ? [visibility.ownUserId] : [...visibility.userIds]);
  const [users, teams, queue, own] = [params.length - 3, params.length - 2, params.length - 1, params.length];
  return `(${alias}.assigned_user_id = any($${own}::text[]) or (${alias}.current_team_id is null and ${alias}.assigned_user_id = any($${users}::text[])) or ${alias}.current_team_id = any($${teams}::text[]) or (${alias}.assigned_user_id is null and (${alias}.current_team_id is null or ${alias}.current_team_id = any($${queue}::text[]))))`;
}
