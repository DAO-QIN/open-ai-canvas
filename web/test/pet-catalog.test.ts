import { expect, test } from "bun:test";
import { filterPetCatalog } from "../src/lib/canvas/pet-catalog";
import type { PetAppearance } from "../src/services/api/appearance";

test("large catalogs remain searchable past the original limit and combine publication filters", () => {
    const pets = Array.from({ length: 64 }, (_, index) => ({ id: `p${index}`, name: index === 63 ? "Claude娘" : `角色${index}`, published: index % 2 === 0 } as PetAppearance));
    expect(filterPetCatalog(pets, "")).toHaveLength(64);
    expect(filterPetCatalog(pets, "  CLAUDE ").map(p => p.id)).toEqual(["p63"]);
    expect(filterPetCatalog(pets, "claude", "published")).toHaveLength(0);
    expect(filterPetCatalog(pets, "claude", "draft").map(p => p.id)).toEqual(["p63"]);
});
