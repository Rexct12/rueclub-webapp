import { parse } from "csv-parse/sync";
import {
  capitalDepositInputSchema,
  expenseCategories,
  expenseInputSchema,
  participantPaymentInputSchema,
  paymentCategories,
  paymentMethods,
  paymentStatuses,
  slugId,
  todayInBangkok,
  type Account,
  type CapitalDepositInput,
  type ExpenseInput,
  type ParticipantPaymentInput,
  type Session,
} from "@/lib/domain";
import { normalizeDate, parseRupiah } from "@/lib/format";

export type ImportContext = {
  accounts: Account[];
  sessions: Session[];
};

type CsvRecord = Record<string, string | undefined>;

export function parseCsv(content: string): CsvRecord[] {
  return parse(content, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    trim: true,
  }) as CsvRecord[];
}

function findValue(record: CsvRecord, names: string[]) {
  const normalized = new Map(
    Object.entries(record).map(([key, value]) => [key.trim().toLowerCase(), value]),
  );

  for (const name of names) {
    const value = normalized.get(name.toLowerCase());
    if (value !== undefined && value !== "") {
      return value;
    }
  }

  return undefined;
}

function findAccountId(name: string | undefined, context: ImportContext) {
  const fallback = context.accounts[0]?.id ?? slugId("BCA Naufal");
  if (!name) {
    return fallback;
  }

  return (
    context.accounts.find((account) => account.name.toLowerCase() === name.toLowerCase())?.id ??
    slugId(name)
  );
}

function isFreePaymentValue(value: string | undefined) {
  return value?.trim().toLowerCase() === "free";
}

function findSessionId(code: string | undefined, context: ImportContext) {
  if (!code) {
    return undefined;
  }

  return (
    context.sessions.find((session) => session.code.toLowerCase() === code.toLowerCase())?.id ??
    slugId(code)
  );
}

function enumOrDefault<T extends readonly string[]>(value: string | undefined, values: T, fallback: T[number]) {
  return values.includes(value as never) ? (value as T[number]) : fallback;
}

export function mapParticipantRow(record: CsvRecord, context: ImportContext): ParticipantPaymentInput {
  const fallbackDate = todayInBangkok();
  const slotPrice = parseRupiah(findValue(record, ["Harga Slot"]));
  const status = enumOrDefault(findValue(record, ["Status bayar"]), paymentStatuses, "Lunas");
  const discount =
    status === "Free" ? slotPrice : parseRupiah(findValue(record, ["Diskon"]));
  const total =
    status === "Free" ? 0 : parseRupiah(findValue(record, ["Total"])) || Math.max(0, slotPrice - discount);
  const rawMethod = findValue(record, ["Metode"]);
  const rawAccount = findValue(record, ["Rek Masuk"]);
  const method = paymentMethods.includes(rawMethod as never) ? rawMethod : undefined;
  const accountId =
    status === "Free" || isFreePaymentValue(rawAccount) ? undefined : findAccountId(rawAccount, context);

  return participantPaymentInputSchema.parse({
    date: normalizeDate(findValue(record, ["Tanggal"]), fallbackDate),
    playerName: findValue(record, ["Nama Pemain"]) ?? "Tanpa nama",
    rueclubName: findValue(record, ["Reclub Name (@)", "RueClub Name (@)"]),
    instagram: findValue(record, ["Instagram (@)"]),
    whatsapp: findValue(record, ["WA"]),
    category: enumOrDefault(findValue(record, ["Kategori"]), paymentCategories, "Umum"),
    sessionId: findSessionId(findValue(record, ["Sesi"]), context),
    slotPrice,
    discount,
    total,
    status,
    method,
    accountId,
    notes: findValue(record, ["Catatan"]),
  });
}

export function mapExpenseRow(record: CsvRecord, context: ImportContext): ExpenseInput {
  const fallbackDate = todayInBangkok();
  return expenseInputSchema.parse({
    date: normalizeDate(findValue(record, ["Tanggal"]), fallbackDate),
    description: findValue(record, ["Keterangan"]) ?? "Expense",
    category: enumOrDefault(findValue(record, ["Category"]), expenseCategories, "Court"),
    sessionId: findSessionId(findValue(record, ["Lapangan"]), context),
    amount: parseRupiah(findValue(record, ["Nominal"])),
    accountId: findAccountId(findValue(record, ["Akun"]), context),
    notes: findValue(record, ["Catatan", "Keterangan 2"]),
    reimbursed: findValue(record, ["Reimburse"])?.toLowerCase() === "true",
  });
}

export function mapCapitalRow(record: CsvRecord, context: ImportContext): CapitalDepositInput {
  const fallbackDate = todayInBangkok();
  return capitalDepositInputSchema.parse({
    date: normalizeDate(findValue(record, ["Tanggal"]), fallbackDate),
    description: findValue(record, ["Keterangan"]) ?? "Modal titipan",
    sessionId: findSessionId(findValue(record, ["Lapangan"]), context),
    amount: parseRupiah(findValue(record, ["Nominal"])),
    accountId: findAccountId(findValue(record, ["Akun"]), context),
    sharingInvest: findValue(record, ["Sharing Invest"])?.toLowerCase() === "true",
  });
}
