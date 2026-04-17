import type { Account } from "@/lib/domain";
import { slugId } from "@/lib/domain";

export const defaultAccounts: Account[] = [
  { id: slugId("BCA Naufal"), name: "BCA Naufal", type: "bank", openingBalance: 0, active: true },
  { id: slugId("BCA Nura"), name: "BCA Nura", type: "bank", openingBalance: 0, active: true },
  { id: slugId("Jago"), name: "Jago", type: "bank", openingBalance: 0, active: true },
  { id: slugId("Cash"), name: "Cash", type: "cash", openingBalance: 0, active: true },
];
