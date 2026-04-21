import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  accountSchema,
  capitalDepositInputSchema,
  capitalDepositSchema,
  computePaymentTotal,
  expenseInputSchema,
  expenseSchema,
  isRealMoneyAccount,
  participantPaymentInputSchema,
  participantPaymentSchema,
  profitSharingInputSchema,
  profitSharingSchema,
  sessionSchema,
  slugId,
  type Account,
  type AppData,
  type CapitalDeposit,
  type CapitalDepositInput,
  type CollectionName,
  type Expense,
  type ExpenseInput,
  type ParticipantPayment,
  type ParticipantPaymentInput,
  type ProfitSharing,
  type ProfitSharingInput,
  type Session,
  type User,
  userSchema,
} from "@/lib/domain";
import { defaultAccounts } from "@/lib/defaults";
import { getAdminDb, isFirebaseConfigured } from "@/server/firebase";

type LocalStore = AppData & {
  users: User[];
};

const localStorePath = path.join(process.cwd(), ".data", "rueclub.local.json");

function nowIso() {
  return new Date().toISOString();
}

function emptyLocalStore(): LocalStore {
  return {
    accounts: defaultAccounts,
    sessions: [],
    participantPayments: [],
    expenses: [],
    capitalDeposits: [],
    profitSharings: [],
    users: [],
  };
}

function collectionKey(collection: CollectionName): keyof LocalStore {
  return collection;
}

function shouldUseLocalStore() {
  return process.env.DATA_BACKEND === "local" || !isFirebaseConfigured();
}

async function readLocalStore(): Promise<LocalStore> {
  try {
    const raw = await readFile(localStorePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<LocalStore>;
    return { ...emptyLocalStore(), ...parsed };
  } catch {
    return emptyLocalStore();
  }
}

async function writeLocalStore(data: LocalStore) {
  await mkdir(path.dirname(localStorePath), { recursive: true });
  await writeFile(localStorePath, JSON.stringify(data, null, 2), "utf8");
}

function reviveFirestoreValue(value: unknown): unknown {
  if (value && typeof value === "object" && "toDate" in value) {
    const timestamp = value as { toDate: () => Date };
    return timestamp.toDate().toISOString();
  }

  return value;
}

function sanitizeFirestoreValue(value: unknown): unknown {
  if (value === undefined) {
    return undefined;
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeFirestoreValue(item))
      .filter((item) => item !== undefined);
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .map(([key, item]) => [key, sanitizeFirestoreValue(item)] as const)
      .filter(([, item]) => item !== undefined);

    return Object.fromEntries(entries);
  }

  return value;
}

async function readCollection<T>(
  collection: CollectionName,
  parse: (value: unknown) => T,
): Promise<T[]> {
  if (shouldUseLocalStore()) {
    const store = await readLocalStore();
    return (store[collectionKey(collection)] as unknown[]).map(parse);
  }

  const snapshot = await getAdminDb().collection(collection).get();
  return snapshot.docs.map((doc) => {
    const data = Object.fromEntries(
      Object.entries(doc.data()).map(([key, value]) => [key, reviveFirestoreValue(value)]),
    );
    return parse({ id: doc.id, ...data });
  });
}

async function saveDocument<T extends { id: string }>(
  collection: CollectionName,
  value: T,
): Promise<T> {
  if (shouldUseLocalStore()) {
    const store = await readLocalStore();
    const key = collectionKey(collection);
    const rows = store[key] as Array<{ id: string }>;
    const index = rows.findIndex((row) => row.id === value.id);
    if (index >= 0) {
      rows[index] = value;
    } else {
      rows.push(value);
    }
    await writeLocalStore(store);
    return value;
  }

  const { id, ...payload } = value;
  const sanitizedPayload = sanitizeFirestoreValue(payload) as Record<string, unknown>;
  await getAdminDb().collection(collection).doc(id).set(sanitizedPayload, { merge: true });
  return value;
}

export async function deleteDocument(collection: CollectionName, id: string) {
  if (shouldUseLocalStore()) {
    const store = await readLocalStore();
    const key = collectionKey(collection);
    store[key] = (store[key] as Array<{ id: string }>).filter((row) => row.id !== id) as never;
    await writeLocalStore(store);
    return;
  }

  await getAdminDb().collection(collection).doc(id).delete();
}

export async function getAppData(): Promise<AppData> {
  const [accounts, sessions, participantPayments, expenses, capitalDeposits, profitSharings] = await Promise.all([
    readCollection("accounts", accountSchema.parse),
    readCollection("sessions", sessionSchema.parse),
    readCollection("participantPayments", participantPaymentSchema.parse),
    readCollection("expenses", expenseSchema.parse),
    readCollection("capitalDeposits", capitalDepositSchema.parse),
    readCollection("profitSharings", profitSharingSchema.parse),
  ]);

  return {
    accounts: (accounts.length ? accounts : defaultAccounts).filter(isRealMoneyAccount),
    sessions,
    participantPayments,
    expenses,
    capitalDeposits,
    profitSharings,
  };
}

export async function getUsers(): Promise<User[]> {
  return readCollection("users", userSchema.parse);
}

export async function upsertUser(user: User) {
  return saveDocument("users", userSchema.parse(user));
}

export async function upsertAccount(account: Omit<Account, "id"> & { id?: string }) {
  const value = accountSchema.parse({
    ...account,
    id: account.id ?? slugId(account.name),
  });
  return saveDocument("accounts", value);
}

export async function upsertSession(session: Omit<Session, "id"> & { id?: string }, userId = "system") {
  const value = sessionSchema.parse({
    ...session,
    id: session.id ?? slugId(session.code),
  });
  const saved = await saveDocument("sessions", value);
  await syncSessionCourtExpense(saved, userId);
  return saved;
}

export async function deleteSession(id: string) {
  await deleteDocument("sessions", id);
  await deleteDocument("expenses", sessionCourtExpenseId(id));
}

function sessionCourtExpenseId(sessionId: string) {
  return `court-expense-${sessionId}`;
}

async function syncSessionCourtExpense(session: Session, userId: string) {
  const expenseId = sessionCourtExpenseId(session.id);

  if (session.courtFree || session.courtPrice <= 0 || !session.courtExpenseAccountId) {
    await deleteDocument("expenses", expenseId);
    return;
  }

  const timestamp = nowIso();
  const existing = (await readCollection("expenses", expenseSchema.parse)).find(
    (expense) => expense.id === expenseId,
  );
  const value: Expense = expenseSchema.parse({
    id: expenseId,
    date: session.date,
    description: `Court - ${session.code}`,
    category: "Court",
    sessionId: session.id,
    amount: session.courtPrice,
    accountId: session.courtExpenseAccountId,
    notes: "Auto-generated from session court price",
    reimbursed: false,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
    createdBy: existing?.createdBy ?? userId,
    updatedBy: userId,
  });

  await saveDocument("expenses", value);
}

export async function createParticipantPayment(input: ParticipantPaymentInput, userId: string) {
  const parsed = participantPaymentInputSchema.parse(input);
  const timestamp = nowIso();
  const value: ParticipantPayment = participantPaymentSchema.parse({
    ...parsed,
    id: crypto.randomUUID(),
    total: computePaymentTotal(parsed),
    createdAt: timestamp,
    updatedAt: timestamp,
    createdBy: userId,
    updatedBy: userId,
  });
  return saveDocument("participantPayments", value);
}

export async function updateParticipantPayment(id: string, input: ParticipantPaymentInput, userId: string) {
  const parsed = participantPaymentInputSchema.parse(input);
  const existing = (await readCollection("participantPayments", participantPaymentSchema.parse)).find(
    (payment) => payment.id === id,
  );
  if (!existing) throw new Error("Participant payment not found.");

  const timestamp = nowIso();
  const value: ParticipantPayment = participantPaymentSchema.parse({
    ...parsed,
    id,
    total: computePaymentTotal(parsed),
    createdAt: existing.createdAt,
    updatedAt: timestamp,
    createdBy: existing.createdBy,
    updatedBy: userId,
  });
  return saveDocument("participantPayments", value);
}

export async function createExpense(input: ExpenseInput, userId: string) {
  const parsed = expenseInputSchema.parse(input);
  const timestamp = nowIso();
  const value: Expense = expenseSchema.parse({
    ...parsed,
    id: crypto.randomUUID(),
    createdAt: timestamp,
    updatedAt: timestamp,
    createdBy: userId,
    updatedBy: userId,
  });
  return saveDocument("expenses", value);
}

export async function updateExpense(id: string, input: ExpenseInput, userId: string) {
  const parsed = expenseInputSchema.parse(input);
  const existing = (await readCollection("expenses", expenseSchema.parse)).find(
    (expense) => expense.id === id,
  );
  if (!existing) throw new Error("Expense not found.");

  const timestamp = nowIso();
  const value: Expense = expenseSchema.parse({
    ...parsed,
    id,
    createdAt: existing.createdAt,
    updatedAt: timestamp,
    createdBy: existing.createdBy,
    updatedBy: userId,
  });
  return saveDocument("expenses", value);
}

export async function createProfitSharing(input: ProfitSharingInput, userId: string) {
  const parsed = profitSharingInputSchema.parse(input);
  const timestamp = nowIso();
  const value: ProfitSharing = profitSharingSchema.parse({
    ...parsed,
    id: crypto.randomUUID(),
    createdAt: timestamp,
    updatedAt: timestamp,
    createdBy: userId,
    updatedBy: userId,
  });
  return saveDocument("profitSharings", value);
}

export async function updateProfitSharing(id: string, input: ProfitSharingInput, userId: string) {
  const parsed = profitSharingInputSchema.parse(input);
  const existing = (await readCollection("profitSharings", profitSharingSchema.parse)).find(
    (sharing) => sharing.id === id,
  );
  if (!existing) throw new Error("Profit sharing not found.");

  const timestamp = nowIso();
  const value: ProfitSharing = profitSharingSchema.parse({
    ...parsed,
    id,
    createdAt: existing.createdAt,
    updatedAt: timestamp,
    createdBy: existing.createdBy,
    updatedBy: userId,
  });
  return saveDocument("profitSharings", value);
}

export async function createCapitalDeposit(input: CapitalDepositInput, userId: string) {
  const parsed = capitalDepositInputSchema.parse(input);
  const timestamp = nowIso();
  const value: CapitalDeposit = capitalDepositSchema.parse({
    ...parsed,
    id: crypto.randomUUID(),
    createdAt: timestamp,
    updatedAt: timestamp,
    createdBy: userId,
    updatedBy: userId,
  });
  return saveDocument("capitalDeposits", value);
}

export function backendLabel() {
  return shouldUseLocalStore() ? "Local development store" : "Firebase Firestore";
}
