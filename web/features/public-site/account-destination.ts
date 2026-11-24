const destinations = {
  assinatura: "/conta/plano",
  reunioes: "/conta/plano#plano-reunioes",
} as const;

export function destinationAfterLogin(value: string | null): string {
  if (value === "assinatura" || value === "reunioes") return destinations[value];
  return "/workspaces";
}
