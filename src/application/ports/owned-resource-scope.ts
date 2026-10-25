/** Tenant/workspace filtering is mandatory in addition to this ownership scope. */
export type OwnedResourceScope = { ownUserId?: string; ownerUserIdsIn?: readonly string[]; teamIdsIn?: readonly string[] };

export function matchesOwnedScope(record: { ownerUserId?: string; teamId?: string }, scope: OwnedResourceScope): boolean {
  if (!scope.ownerUserIdsIn && !scope.teamIdsIn) return true;
  if (scope.ownUserId && record.ownerUserId === scope.ownUserId) return true;
  // An explicit team on the record determines its scope. A colleague belonging to two teams
  // must not expose team B's records to the manager of team A.
  if (scope.teamIdsIn && record.teamId) return scope.teamIdsIn.includes(record.teamId);
  return Boolean(record.ownerUserId && scope.ownerUserIdsIn?.includes(record.ownerUserId));
}
