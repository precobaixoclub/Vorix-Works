"use client";

import { SearchableCombo } from "@/components/SearchableCombo";
import { useInboxMembers } from "@/features/inbox/hooks";

export type UserPickerMember = {
  userId: string;
  name: string;
  email: string;
};

export function UserPicker({
  workspaceId,
  value,
  onValueChange,
  placeholder = "Responsável",
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
  const { data, isLoading } = useInboxMembers(workspaceId);
  const items = (data?.members ?? []).map((member) => ({
    id: member.userId,
    label: `${member.name} · ${member.email}`,
  }));

  return (
    <SearchableCombo
      items={items}
      loading={isLoading}
      value={value}
      onValueChange={onValueChange}
      placeholder={placeholder}
      searchPlaceholder="Buscar pessoa..."
      emptyText="Nenhum usuário encontrado."
      extraOption={extraOption}
      disabled={disabled}
      className={className}
    />
  );
}

export function userLabel(userId: string | undefined, members: readonly UserPickerMember[] | undefined): string {
  if (!userId) return "Sem responsável";
  const member = members?.find((item) => item.userId === userId);
  return member ? member.name : "Responsável não encontrado";
}

export function userInitials(userId: string | undefined, members: readonly UserPickerMember[] | undefined): string {
  const label = userLabel(userId, members);
  return label
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "SR";
}
