import "server-only";
import { fetchPublicCatalog } from "@/features/platform-plans/api";
import { buildPublicProductCatalog } from "./catalog";

export async function getPublicProductCatalog() {
  try { return buildPublicProductCatalog(await fetchPublicCatalog()); }
  catch { return buildPublicProductCatalog(null); }
}
