"use client";
// Loyalty-card wallet (localStorage) — keep chain loyalty numbers in one place to show
// at checkout. (A scannable Code128 barcode render is a planned follow-up.)

export type WalletCard = { store: string; code: string };
const KEY = "cosmic_wallet";
export const WALLET_EVENT = "cosmic-wallet";

export const LOYALTY_STORES = ["Kaufland", "Lidl Plus", "Carrefour", "Auchan", "Mega Image", "Profi", "Penny", "Cora", "dm", "Farmacia Tei"];

export function getCards(): WalletCard[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function save(c: WalletCard[]) {
  localStorage.setItem(KEY, JSON.stringify(c));
  window.dispatchEvent(new Event(WALLET_EVENT));
}
export function addCard(store: string, code: string) {
  const list = getCards().filter((c) => c.store !== store);
  save([...list, { store, code: code.trim() }]);
}
export function removeCard(store: string) {
  save(getCards().filter((c) => c.store !== store));
}
