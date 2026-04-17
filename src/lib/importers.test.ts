import { describe, expect, it } from "vitest";
import { defaultAccounts } from "@/lib/defaults";
import { mapCapitalRow, mapExpenseRow, mapParticipantRow, parseCsv } from "@/lib/importers";

const context = {
  accounts: defaultAccounts,
  sessions: [
    { id: "kaya-padel-001", code: "Kaya Padel-001", date: "2026-04-01", defaultSlotPrice: 95000, active: true },
  ],
};

describe("importers", () => {
  it("parses csv and maps participant rows", () => {
    const [row] = parseCsv("Tanggal,Nama Pemain,Kategori,Sesi,Harga Slot,Diskon,Total,Status bayar,Metode,Rek Masuk\n2026-04-01,Ryan,Umum,Kaya Padel-001,\"Rp99,000\",0,\"Rp99,000\",Lunas,Transfer,BCA Naufal");
    const mapped = mapParticipantRow(row, context);

    expect(mapped).toMatchObject({
      playerName: "Ryan",
      sessionId: "kaya-padel-001",
      slotPrice: 99000,
      total: 99000,
      accountId: "bca-naufal",
    });
  });

  it("maps free participant rows without a cash account", () => {
    const [row] = parseCsv("Tanggal,Nama Pemain,Kategori,Sesi,Harga Slot,Diskon,Total,Status bayar,Metode,Rek Masuk\n2026-04-01,Nura,Owner,Kaya Padel-001,\"Rp99,000\",0,\"Rp99,000\",Free,Free,Free");
    const mapped = mapParticipantRow(row, context);

    expect(mapped).toMatchObject({
      playerName: "Nura",
      slotPrice: 99000,
      discount: 99000,
      total: 0,
      status: "Free",
    });
    expect(mapped.accountId).toBeUndefined();
    expect(mapped.method).toBeUndefined();
  });

  it("maps expense rows", () => {
    const mapped = mapExpenseRow(
      {
        Tanggal: "2026-04-01",
        Keterangan: "Court",
        Category: "Court",
        Lapangan: "Kaya Padel-001",
        Nominal: "450 ribu",
        Akun: "BCA Naufal",
      },
      context,
    );

    expect(mapped.amount).toBe(450000);
    expect(mapped.sessionId).toBe("kaya-padel-001");
  });

  it("maps capital rows", () => {
    const mapped = mapCapitalRow(
      {
        Tanggal: "2026-04-01",
        Keterangan: "Modal",
        Nominal: "1 juta",
        Akun: "BCA Nura",
      },
      context,
    );

    expect(mapped.amount).toBe(1000000);
    expect(mapped.accountId).toBe("bca-nura");
  });
});
