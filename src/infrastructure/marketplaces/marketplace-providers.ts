import type { MarketplaceProvider } from "../../application/ports/marketplace-provider.port.js";
import { MercadoLivreProvider, mercadoLivreConfig } from "./mercado-livre-provider.js";

/** Canais com credenciais de app válidas neste ambiente. Canal sem credencial simplesmente não aparece. */
export function marketplaceProvidersFromEnv(env:NodeJS.ProcessEnv):MarketplaceProvider[]{
 const providers:MarketplaceProvider[]=[];
 const ml=mercadoLivreConfig(env);if(ml)providers.push(new MercadoLivreProvider(ml));
 return providers;
}
