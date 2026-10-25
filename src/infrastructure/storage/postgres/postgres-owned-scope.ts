import type { OwnedResourceScope } from "../../../application/ports/owned-resource-scope.js";

export function ownedScopeSql(scope: OwnedResourceScope, params: unknown[], alias = ""): string | undefined {
  if (!scope.ownerUserIdsIn && !scope.teamIdsIn) return undefined;
  const owner = `${alias}owner_user_id`, team = `${alias}team_id`;
  params.push([...(scope.ownerUserIdsIn ?? [])]);
  const own = `${owner} = any($${params.length}::text[])`;
  if (!scope.teamIdsIn) return own;
  params.push([...scope.teamIdsIn]);
  const teamCondition = `(${team} = any($${params.length}::text[]) or (${team} is null and ${own}))`;
  if (!scope.ownUserId) return teamCondition;
  params.push(scope.ownUserId);
  return `(${owner} = $${params.length} or ${teamCondition})`;
}
