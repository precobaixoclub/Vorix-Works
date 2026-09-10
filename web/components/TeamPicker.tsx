"use client";

import { SearchableCombo } from "@/components/SearchableCombo";
import { useTeams } from "@/features/identity/hooks";
import type { Team } from "@/features/identity/types";

export function TeamPicker({
  workspaceId,
  value,
  onValueChange,
  placeholder = "Equipe",
  extraOption,
  disabled,
  className,
}: {
  workspaceId: string;
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  extraOption?: { value: string; label: string };
  disabled?: boolean;
  className?: string;
}) {
  const { data, isLoading } = useTeams(workspaceId);
  const items = (data ?? []).map((team) => ({ id: team.id, label: team.name }));

  return (
    <SearchableCombo
      items={items}
      loading={isLoading}
      value={value}
      onValueChange={onValueChange}
      placeholder={placeholder}
      searchPlaceholder="Buscar equipe..."
      emptyText="Nenhuma equipe encontrada."
      extraOption={extraOption}
      disabled={disabled}
      className={className}
    />
  );
}

export function teamLabel(teamId: string | undefined, teams: readonly Team[] | undefined): string {
  if (!teamId) return "Sem equipe";
  return teams?.find((team) => team.id === teamId)?.name ?? "Equipe não encontrada";
}
