/**
 * Helpers compartilhados por todo `features/.../data.ts` — Chat/Assets/Campaigns/Knowledge/Calendar
 * ainda não têm endpoint HTTP real (só Workspace tem, ver `features/workspace/api.ts`). Cada
 * módulo mock expõe funções `async` com a MESMA assinatura que uma chamada real à API teria, para
 * que trocar a implementação por `apiClient.get(...)` no futuro não exija tocar em nenhum
 * componente — só no arquivo `data.ts` correspondente.
 */

export function delay(ms = 220): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function generateId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
