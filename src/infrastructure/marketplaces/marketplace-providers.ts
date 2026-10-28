import type { MarketplaceProvider } from "../../application/ports/marketplace-provider.port.js";
import { MercadoLivreProvider, mercadoLivreConfig } from "./mercado-livre-provider.js";
import { ShopeeProvider, shopeeConfig } from "./shopee-provider.js";
import { TikTokShopProvider, tiktokShopConfig } from "./tiktok-shop-provider.js";

/** Canais com credenciais de app válidas neste ambiente. Canal sem credencial simplesmente não aparece. */
export function marketplaceProvidersFromEnv(env:NodeJS.ProcessEnv):MarketplaceProvider[]{
 const providers:MarketplaceProvider[]=[];
 const ml=mercadoLivreConfig(env);if(ml)providers.push(new MercadoLivreProvider(ml));
 const shopee=shopeeConfig(env);if(shopee)providers.push(new ShopeeProvider(shopee));
 const tiktok=tiktokShopConfig(env);if(tiktok)providers.push(new TikTokShopProvider(tiktok));
 return providers;
}
