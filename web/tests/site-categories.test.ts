import { describe, expect, it } from "vitest";
import { categoryMenuLinks, rootCategoryId, topLevelCategories } from "@/features/sites/site-categories";

const cat = (id: string, name: string, position = 0, parentId?: string) => ({ id, name, slug: name.toLowerCase(), position, ...(parentId ? { parentId } : {}) });
const categories = [cat("m", "Masculino", 1), cat("f", "Feminino", 0), cat("c", "Camisas", 0, "m"), cat("o", "Órfã", 2, "sumiu")];

describe("site categories", () => {
  it("main categories follow the order set on the products screen; an orphan counts as main", () => {
    expect(topLevelCategories(categories).map((c) => c.name)).toEqual(["Feminino", "Masculino", "Órfã"]);
  });

  it("a subcategory belongs to its main category", () => {
    expect(rootCategoryId(categories, "c")).toBe("m");
    expect(rootCategoryId(categories, "f")).toBe("f");
    expect(rootCategoryId(categories, undefined)).toBeUndefined();
  });

  it("menu adds the main categories, skipping one the owner already linked by hand", () => {
    expect(categoryMenuLinks(categories, [{ url: "/categoria/feminino/" }]).map((c) => c.name)).toEqual(["Masculino", "Órfã"]);
    expect(categoryMenuLinks(categories, [], 1).map((c) => c.name)).toEqual(["Feminino"]);
  });
});
