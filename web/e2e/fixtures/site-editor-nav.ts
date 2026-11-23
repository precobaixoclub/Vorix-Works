import type { Page } from "@playwright/test";
import { SITE_EDITOR_GROUP_LABELS, SITE_EDITOR_SECTIONS } from "../../features/sites/editor-groups";

/**
 * Abre uma seção do editor de sites pela navegação em dois níveis da Fase 8: primeiro o grupo
 * ("Grupos do editor"), depois a seção ("Navegação da seção"). Grupos de uma seção só (Modelo) não
 * têm a segunda linha — o grupo já abre a seção.
 */
export async function openSiteSection(page: Page, label: string) {
  const entry = SITE_EDITOR_SECTIONS.find((item) => item.label === label);
  if (!entry) throw new Error(`Seção do editor inexistente: ${label}`);
  await page.getByRole("navigation", { name: "Grupos do editor" }).getByRole("button", { name: SITE_EDITOR_GROUP_LABELS[entry.group], exact: true }).click();
  if (SITE_EDITOR_SECTIONS.filter((item) => item.group === entry.group).length > 1) {
    await page.getByRole("navigation", { name: "Navegação da seção" }).getByRole("button", { name: label, exact: true }).click();
  }
}
