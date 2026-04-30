import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  accountSchema,
  capitalDepositInputSchema,
  capitalDepositSchema,
  computePaymentTotal,
  courtMemberPackageInputSchema,
  courtMemberPackageSchema,
  expenseInputSchema,
  expenseSchema,
  isRealMoneyAccount,
  participantPaymentInputSchema,
  participantPaymentSchema,
  profitSharingInputSchema,
  profitSharingSchema,
  sessionInputSchema,
  sessionSchema,
  slugId,
  type Account,
  type AppData,
  type CapitalDeposit,
  type CapitalDepositInput,
  type CollectionName,
  type CourtMemberPackage,
  type CourtMemberPackageInput,
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
import { buildMigratedSessionCodes, DEFAULT_SESSION_CODE_FORMAT } from "@/lib/session-code";
import { syncParticipantSlotPriceWithSessionDefault } from "@/lib/session-slot-sync";
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
    courtMemberPackages: [],
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

function parseSessionWithCompatibility(value: unknown): Session {
  const source = value as Record<string, unknown>;
  const parsedInput = sessionInputSchema.parse(source);
  return sessionSchema.parse({
    ...parsedInput,
    id: String(source.id ?? crypto.randomUUID()),
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
  const [accounts, sessions, participantPayments, expenses, courtMemberPackages, capitalDeposits, profitSharings] = await Promise.all([
    readCollection("accounts", accountSchema.parse),
    readCollection("sessions", parseSessionWithCompatibility),
    readCollection("participantPayments", participantPaymentSchema.parse),
    readCollection("expenses", expenseSchema.parse),
    readCollection("courtMemberPackages", courtMemberPackageSchema.parse),
    readCollection("capitalDeposits", capitalDepositSchema.parse),
    readCollection("profitSharings", profitSharingSchema.parse),
  ]);

  const migratedSessions = await migrateSessionCodesIfNeeded(sessions);

  return {
    accounts: (accounts.length ? accounts : defaultAccounts).filter(isRealMoneyAccount),
    sessions: migratedSessions,
    participantPayments,
    expenses,
    courtMemberPackages,
    capitalDeposits,
    profitSharings,
  };
}

async function migrateSessionCodesIfNeeded(sessions: Session[]) {
  const updates = buildMigratedSessionCodes(sessions, DEFAULT_SESSION_CODE_FORMAT);
  if (!updates.length) return sessions;

  const byId = new Map(sessions.map((session) => [session.id, session]));
  const migratedSessions = [...sessions];

  for (const update of updates) {
    const existing = byId.get(update.id);
    if (!existing) continue;
    const migrated = sessionSchema.parse({ ...existing, code: update.code });
    await saveDocument("sessions", migrated);
    await syncSessionCourtExpense(migrated, "system-migration");
    const index = migratedSessions.findIndex((session) => session.id === migrated.id);
    if (index >= 0) migratedSessions[index] = migrated;
  }

  return migratedSessions;
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
  const parsedInput = sessionInputSchema.parse(session);
  const value = sessionSchema.parse({
    ...parsedInput,
    id: session.id ?? crypto.randomUUID(),
  });
  const saved = await saveDocument("sessions", value);
  await syncSessionCourtExpense(saved, userId);
  return saved;
}

export async function deleteSession(id: string) {
  await deleteDocument("sessions", id);
  await deleteDocument("expenses", sessionCourtExpenseId(id));
  await deleteDocument("expenses", sessionCourtMemberUsageExpenseId(id));
}

export async function syncSessionParticipantSlotPricesWithDefaultChange(
  sessionId: string,
  oldDefaultSlotPrice: number,
  newDefaultSlotPrice: number,
  userId: string,
) {
  if (oldDefaultSlotPrice === newDefaultSlotPrice) return 0;

  const participantPayments = await readCollection("participantPayments", participantPaymentSchema.parse);
  const targetPayments = participantPayments.filter((payment) => payment.sessionId === sessionId);
  if (!targetPayments.length) return 0;

  const timestamp = nowIso();
  let updatedCount = 0;

  for (const payment of targetPayments) {
    const synced = syncParticipantSlotPriceWithSessionDefault(payment, oldDefaultSlotPrice, newDefaultSlotPrice);
    if (!synced.shouldUpdate) continue;

    const value: ParticipantPayment = participantPaymentSchema.parse({
      ...payment,
      slotPrice: synced.slotPrice,
      discount: synced.discount,
      total: synced.total,
      updatedAt: timestamp,
      updatedBy: userId,
    });
    await saveDocument("participantPayments", value);
    updatedCount += 1;
  }

  return updatedCount;
}

function sessionCourtExpenseId(sessionId: string) {
  return `court-expense-${sessionId}`;
}

function sessionCourtMemberUsageExpenseId(sessionId: string) {
  return `court-member-usage-expense-${sessionId}`;
}

async function syncSessionCourtExpense(session: Session, userId: string) {
  const regularExpenseId = sessionCourtExpenseId(session.id);
  const memberExpenseId = sessionCourtMemberUsageExpenseId(session.id);
  const hasMemberPackage = Boolean(session.courtMemberPackageId);
  const memberDuration = hasMemberPackage ? Math.max(0, session.memberUsageHours) : 0;
  const regularDuration = Math.max(0, session.totalDurationHours - memberDuration);
  const allExpenses = await readCollection("expenses", expenseSchema.parse);

  if (hasMemberPackage && memberDuration > 0) {
    const memberPackage = (await readCollection("courtMemberPackages", courtMemberPackageSchema.parse)).find(
      (row) => row.id === session.courtMemberPackageId,
    );

    if (!memberPackage) {
      await deleteDocument("expenses", memberExpenseId);
    } else {
      const hourlyRate = memberPackage.totalAmount / memberPackage.totalHours;
      const memberAmount = Math.round(hourlyRate * memberDuration);
      const timestamp = nowIso();
      const existing = allExpenses.find((expense) => expense.id === memberExpenseId);

      const value: Expense = expenseSchema.parse({
        id: memberExpenseId,
        date: session.date,
        description: `Court Member Usage - ${session.code}`,
        category: "Court",
        sessionId: session.id,
        amount: memberAmount,
        accountId: memberPackage.expenseAccountId,
        intent: "courtMemberUsage",
        notes: `Auto-generated from member package ${memberPackage.name} (${memberDuration} jam)`,
        reimbursed: false,
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
        createdBy: existing?.createdBy ?? userId,
        updatedBy: userId,
      });

      await saveDocument("expenses", value);
    }
  } else {
    await deleteDocument("expenses", memberExpenseId);
  }

  if (session.courtFree || regularDuration <= 0 || session.courtPrice <= 0 || !session.courtExpenseAccountId) {
    await deleteDocument("expenses", regularExpenseId);
    return;
  }

  const timestamp = nowIso();
  const existing = allExpenses.find((expense) => expense.id === regularExpenseId);
  const value: Expense = expenseSchema.parse({
    id: regularExpenseId,
    date: session.date,
    description: `Court - ${session.code}`,
    category: "Court",
    sessionId: session.id,
    amount: Math.round(session.courtPrice * regularDuration),
    accountId: session.courtExpenseAccountId,
    intent: "operational",
    notes: `Auto-generated from session court price (${regularDuration} jam reguler x ${session.courtPrice}/jam)`,
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

export async function upsertCourtMemberPackage(
  input: Omit<CourtMemberPackageInput, "active"> & { active?: boolean; id?: string },
  userId: string,
) {
  const parsed = courtMemberPackageInputSchema.parse(input);
  const timestamp = nowIso();
  const existing = input.id
    ? (await readCollection("courtMemberPackages", courtMemberPackageSchema.parse)).find(
      (row) => row.id === input.id,
    )
    : undefined;

  const value: CourtMemberPackage = courtMemberPackageSchema.parse({
    ...parsed,
    id: input.id ?? crypto.randomUUID(),
    active: input.active ?? true,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
    createdBy: existing?.createdBy ?? userId,
    updatedBy: userId,
  });

  const saved = await saveDocument("courtMemberPackages", value);

  const purchaseExpenseId = `court-member-purchase-${saved.id}`;
  const existingPurchaseExpense = (await readCollection("expenses", expenseSchema.parse)).find(
    (expense) => expense.id === purchaseExpenseId,
  );
  const purchaseExpense: Expense = expenseSchema.parse({
    id: purchaseExpenseId,
    date: saved.purchaseDate,
    description: `Beli paket member - ${saved.name}`,
    category: "Court",
    amount: saved.totalAmount,
    accountId: saved.expenseAccountId,
    intent: "courtMemberPurchase",
    notes: saved.notes,
    reimbursed: false,
    createdAt: existingPurchaseExpense?.createdAt ?? timestamp,
    updatedAt: timestamp,
    createdBy: existingPurchaseExpense?.createdBy ?? userId,
    updatedBy: userId,
  });
  await saveDocument("expenses", purchaseExpense);

  return saved;
}

export function backendLabel() {
  return shouldUseLocalStore() ? "Local development store" : "Firebase Firestore";
}
