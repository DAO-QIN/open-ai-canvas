import type { PetAppearance } from "@/services/api/appearance";

export const PET_CATALOG_LIMIT = 64;
export const PET_CATALOG_PAGE_SIZE = 12;

export function filterPetCatalog(catalog: PetAppearance[], query: string, status = "all") {
    const term = query.trim().toLocaleLowerCase();
    return catalog.filter((pet) => (!term || pet.name.toLocaleLowerCase().includes(term)) && (status === "all" || pet.published === (status === "published")));
}
