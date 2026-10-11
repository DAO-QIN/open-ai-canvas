import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useUserStore } from "@/stores/use-user-store";
import { commandProduct, fetchEcommerceOptions, fetchProduct, fetchProducts, fetchProductRun } from "@/services/api/ecommerce";
import { shouldPoll, type ProductCommand } from "@/lib/ecommerce/contracts";

export function useProducts(page = 1, archived = false) {
    const userID = useUserStore((state) => state.user?.id);
    return useQuery({
        queryKey: ["ecommerce", userID, "products", page, archived],
        enabled: Boolean(userID),
        queryFn: ({ signal }) => fetchProducts(page, archived, signal),
        refetchInterval: (query) => (query.state.data?.items.some((item) => shouldPoll(item.run?.status)) ? 4000 : false),
    });
}
export function useProduct(id?: string) {
    const userID = useUserStore((state) => state.user?.id);
    return useQuery({ queryKey: ["ecommerce", userID, "product", id], enabled: Boolean(userID && id), queryFn: ({ signal }) => fetchProduct(id!, signal), refetchInterval: (query) => (shouldPoll(query.state.data?.run?.status) ? 2500 : false) });
}
export function useProductOptions() {
    const userID = useUserStore((state) => state.user?.id);
    return useQuery({ queryKey: ["ecommerce", userID, "options"], enabled: Boolean(userID), queryFn: ({ signal }) => fetchEcommerceOptions(signal), staleTime: 15_000, refetchInterval: 30_000 });
}
export function useProductRun(productID: string, runID?: string) {
    const userID = useUserStore((state) => state.user?.id);
    return useQuery({
        queryKey: ["ecommerce", userID, "run", productID, runID],
        enabled: Boolean(userID && runID),
        queryFn: ({ signal }) => fetchProductRun(productID, runID!, signal),
        refetchInterval: (query) => (shouldPoll(query.state.data?.status) ? 5000 : false),
    });
}
export function useProductCommand(id: string) {
    const userID = useUserStore((state) => state.user?.id);
    const client = useQueryClient();
    return useMutation({ retry: false, mutationFn: (request: ProductCommand) => commandProduct(id, request), onSettled: () => client.invalidateQueries({ queryKey: ["ecommerce", userID] }) });
}
