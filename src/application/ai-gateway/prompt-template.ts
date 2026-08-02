/**
 * `PromptTemplate` — Sprint 08 (Fase 9). Nenhum caso de uso monta prompt "na mão" — todo prompt
 * nasce de um template registrado, versionado e hasheado. Telemetria (`ai_executions`) grava só
 * `promptTemplateId`/`promptVersion`/`promptHash` — nunca o texto renderizado inteiro.
 */
export type PromptTemplate<TContext> = {
  id: string;
  version: number;
  operation: string;
  changelog: string;
  /** sha256 do texto ESTÁTICO do template (a prosa de instrução, não o conteúdo dinâmico
   * renderizado por chamada) — muda só quando o template em si muda de versão. */
  hash: string;
  buildSystemInstructions(context: TContext): string;
  buildUserInput(context: TContext): string;
};
