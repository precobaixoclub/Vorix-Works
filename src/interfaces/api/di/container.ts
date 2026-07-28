import type { AuthPort } from "../../../application/ports/auth.port.js";
import { createNoopAuthAdapter } from "../../../infrastructure/auth/noop-auth-adapter.js";

/**
 * Raiz de composição da API — mesmo papel que `buildRuntime()` cumpre para a CLI
 * (`src/interfaces/cli/run-command.ts`), só que para o transporte HTTP. Intencionalmente enxuto
 * nesta sprint: nenhuma rota de negócio existe ainda (só o healthcheck), então o container só
 * precisa prover o que o healthcheck e o middleware de autenticação já usam. Arthur/Caio/Helena/
 * Valentina/Clara/Icaro NÃO são conectados aqui ainda — conectar sem nenhum endpoint que os
 * consuma seria acoplamento prematuro; a Sprint em que a primeira rota de negócio nascer é quem
 * decide como reaproveitar `buildRuntime()` (ou uma variação dele) para a API.
 */
export type ApiContainer = {
  authPort: AuthPort;
};

export function buildApiContainer(): ApiContainer {
  return {
    authPort: createNoopAuthAdapter(),
  };
}
