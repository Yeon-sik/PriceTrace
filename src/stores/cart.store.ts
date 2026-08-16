"use client";

import { create } from "zustand";
import { normalizeCartQuantity } from "@/domain/cart";
import { LocalStorageCartRepository, type CartLines } from "@/repositories/cart.repository";

const repository = new LocalStorageCartRepository();

type CartStore = {
  lines: CartLines;
  hydrated: boolean;
  hydrate: () => void;
  add: (productId: string, quantity: number) => void;
  setQuantity: (productId: string, quantity: number) => void;
  remove: (productId: string) => void;
  clear: () => void;
};

function persist(lines: CartLines) {
  if (Object.keys(lines).length === 0) repository.clear();
  else repository.save(lines);
  return lines;
}

export const useCartStore = create<CartStore>((set) => ({
  lines: {},
  hydrated: false,
  hydrate: () => set({ lines: repository.load(), hydrated: true }),
  add: (productId, quantity) => set((state) => {
    const addedQuantity = normalizeCartQuantity(quantity);
    if (addedQuantity === null) return { lines: state.lines };
    const currentQuantity = normalizeCartQuantity(state.lines[productId]) ?? 0;
    return { lines: persist({ ...state.lines, [productId]: currentQuantity + addedQuantity }) };
  }),
  setQuantity: (productId, quantity) => set((state) => {
    if (!Number.isFinite(quantity)) return { lines: state.lines };
    const lines = { ...state.lines };
    const normalizedQuantity = normalizeCartQuantity(quantity);
    if (normalizedQuantity === null) delete lines[productId];
    else lines[productId] = normalizedQuantity;
    return { lines: persist(lines) };
  }),
  remove: (productId) => set((state) => {
    const lines = { ...state.lines };
    delete lines[productId];
    return { lines: persist(lines) };
  }),
  clear: () => { repository.clear(); set({ lines: {} }); },
}));
