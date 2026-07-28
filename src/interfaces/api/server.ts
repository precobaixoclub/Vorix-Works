import { buildApp } from "./app.js";
import { loadApiConfig } from "./config/api-config.js";

/** Único arquivo que efetivamente sobe um processo HTTP escutando — ponto de entrada real (`npm run zuno:api`), equivalente a `dist/interfaces/cli/index.js` para o transporte HTTP. */
async function main(): Promise<void> {
  const config = loadApiConfig();
  const app = await buildApp({ config });

  try {
    await app.listen({ port: config.port, host: config.host });
  } catch (error) {
    app.log.error(error);
    process.exitCode = 1;
  }
}

main();
