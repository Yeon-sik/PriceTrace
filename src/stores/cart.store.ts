"use client";

import { create } from "zustand";
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
  add: (productId, quantity) => set((state) => ({ lines: persist({ ...state.lines, [productId]: (state.lines[productId] ?? 0) + quantity }) })),
  setQuantity: (productId, quantity) => set((state) => {
    const lines = { ...state.lines };
    if (quantity < 1) delete lines[productId];
    else lines[productId] = quantity;
    return { lines: persist(lines) };
  }),
  remove: (productId) => set((state) => {
    const lines = { ...state.lines };
    delete lines[productId];
    return { lines: persist(lines) };
  }),
  clear: () => { repository.clear(); set({ lines: {} }); },
}));
