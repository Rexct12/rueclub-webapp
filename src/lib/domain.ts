import { z } from "zod";

export const accountTypes = ["bank", "cash", "other"] as const;
export const paymentCategories = ["Teman", "Umum", "Owner"] as const;
export const paymentStatuses = ["Lunas", "Belum", "Free"] as const;
export const paymentMethods = ["Transfer", "Cash"] as const;
export const profitSharingCalculationTypes = ["fixed", "percent"] as const;
export const expenseIntents = ["operational", "courtMemberPurchase", "courtMemberUsage"] as const;
export const expenseCategories = [
  "Biaya Admin TF",
  "Biaya Compliment",
  "Biaya Dokumentasi",
  "Coach",
  "Court",
  "Parkir",
  "Pembelian Aset",
  "Bensin",
  "Perawatan Aset",
] as const;
export const transactionIntents = [
  "capitalDeposit",
  "expense",
  "participantPayment",
] as const;

const dateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD format");

const requiredText = z.string().trim().min(1);
const optionalText = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value ? value : undefined));

const moneySchema = z.coerce.number().finite().min(0);
const paymentMethodSchema = z.preprocess(
  (value) => (value === "Free" || value === "" || value == null ? undefined : value),
  z.enum(paymentMethods).optional(),
);

export const accountSchema = z.object({
  id: z.string(),
  name: requiredText,
  type: z.enum(accountTypes).catch("other"),
  openingBalance: z.coerce.number().finite().default(0),
  active: z.boolean().default(true),
});

export const sessionSchema = z.object({
  id: z.string(),
  date: dateStringSchema,
  time: optionalText,
  code: requiredText,
  venue: optionalText,
  defaultSlotPrice: moneySchema.default(0),
  courtPrice: moneySchema.default(0),
  courtFree: z.boolean().default(false),
  courtExpenseAccountId: optionalText,
  courtMemberPackageId: optionalText,
  memberUsageHours: z.coerce.number().finite().min(0).default(0),
  active: z.boolean().default(true),
});

export const userSchema = z.object({
  id: z.string(),
  name: requiredText,
  role: z.literal("admin"),
  pinHash: requiredText,
  active: z.boolean().default(true),
});

const participantPaymentBaseSchema = z.object({
  date: dateStringSchema,
  playerName: requiredText,
  rueclubName: optionalText,
  instagram: optionalText,
  whatsapp: optionalText,
  category: z.enum(paymentCategories).default("Umum"),
  sessionId: requiredText,
  slotPrice: moneySchema,
  discount: moneySchema.default(0),
  total: moneySchema.optional(),
  status: z.enum(paymentStatuses).default("Lunas"),
  method: paymentMethodSchema,
  accountId: optionalText,
  notes: optionalText,
  receiptUrl: optionalText,
});

type ParticipantPaymentBase = z.infer<typeof participantPaymentBaseSchema>;

function getPaymentTotal(input: ParticipantPaymentBase) {
  if (input.status === "Free") {
    return 0;
  }

  return Math.max(0, input.total ?? input.slotPrice - input.discount);
}

function normalizeParticipantPayment<T extends ParticipantPaymentBase>(
  payment: T,
): T & { total: number } {
  const total = getPaymentTotal(payment);

  if (payment.status === "Free") {
    return {
      ...payment,
      discount: Math.max(payment.discount, payment.slotPrice),
      total: 0,
      method: undefined,
      accountId: undefined,
    } as T & { total: number };
  }

  return {
    ...payment,
    total,
    method: payment.method ?? (payment.status === "Lunas" ? "Transfer" : undefined),
  } as T & { total: number };
}

function validateParticipantPayment(
  payment: ParticipantPaymentBase,
  ctx: z.RefinementCtx,
) {
  if (payment.status === "Lunas" && !payment.accountId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["accountId"],
      message: "Akun masuk wajib diisi untuk pembayaran lunas.",
    });
  }
}

export const participantPaymentInputSchema = participantPaymentBaseSchema
  .superRefine(validateParticipantPayment)
  .transform(normalizeParticipantPayment);

export const expenseInputSchema = z.object({
  date: dateStringSchema,
  description: requiredText,
  category: z.enum(expenseCategories),
  sessionId: optionalText,
  amount: moneySchema,
  accountId: requiredText,
  intent: z.enum(expenseIntents).default("operational"),
  notes: optionalText,
  reimbursed: z.boolean().default(false),
  receiptUrl: optionalText,
});

export const courtMemberPackageInputSchema = z.object({
  purchaseDate: dateStringSchema,
  name: requiredText,
  venue: requiredText,
  totalHours: z.coerce.number().finite().positive(),
  totalAmount: moneySchema,
  expenseAccountId: requiredText,
  notes: optionalText,
  active: z.boolean().default(true),
});

export const capitalDepositInputSchema = z.object({
  date: dateStringSchema,
  description: requiredText,
  sessionId: optionalText,
  amount: moneySchema,
  accountId: requiredText,
  sharingInvest: z.boolean().default(false),
});

export const profitSharingInputSchema = z.object({
  date: dateStringSchema,
  sessionId: requiredText,
  recipientName: requiredText,
  role: optionalText,
  calculationType: z.enum(profitSharingCalculationTypes).default("fixed"),
  percentage: z.coerce.number().finite().min(0).max(100).optional(),
  baseAmount: moneySchema.default(0),
  amount: moneySchema,
  accountId: requiredText,
  notes: optionalText,
  receiptUrl: optionalText,
}).superRefine((sharing, ctx) => {
  if (sharing.calculationType === "percent" && !sharing.percentage) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["percentage"],
      message: "Persentase wajib diisi untuk bagi hasil persen.",
    });
  }
});

export const participantPaymentSchema = participantPaymentBaseSchema
  .extend({
    id: z.string(),
    total: moneySchema,
    createdAt: z.string(),
    updatedAt: z.string(),
    createdBy: z.string(),
    updatedBy: z.string(),
  })
  .superRefine(validateParticipantPayment)
  .transform(normalizeParticipantPayment);

export const expenseSchema = expenseInputSchema.extend({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  createdBy: z.string(),
  updatedBy: z.string(),
});

export const courtMemberPackageSchema = courtMemberPackageInputSchema.extend({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  createdBy: z.string(),
  updatedBy: z.string(),
});

export const capitalDepositSchema = capitalDepositInputSchema.extend({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  createdBy: z.string(),
  updatedBy: z.string(),
});

export const profitSharingSchema = profitSharingInputSchema.extend({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  createdBy: z.string(),
  updatedBy: z.string(),
});

export const aiDraftSchema = z.object({
  intent: z.enum(transactionIntents),
  date: z.string().optional(),
  amount: moneySchema.optional(),
  accountName: optionalText,
  sessionCode: optionalText,
  playerName: optionalText,
  category: optionalText,
  method: optionalText,
  status: optionalText,
  description: optionalText,
  notes: optionalText,
  confidence: z.coerce.number().min(0).max(1).default(0),
  missingFields: z.array(z.string()).default([]),
});

export type Account = z.infer<typeof accountSchema>;
export type Session = z.infer<typeof sessionSchema>;
export type User = z.infer<typeof userSchema>;
export type ParticipantPaymentInput = z.infer<typeof participantPaymentInputSchema>;
export type ExpenseInput = z.infer<typeof expenseInputSchema>;
export type CourtMemberPackageInput = z.infer<typeof courtMemberPackageInputSchema>;
export type CapitalDepositInput = z.infer<typeof capitalDepositInputSchema>;
export type ProfitSharingInput = z.infer<typeof profitSharingInputSchema>;
export type ParticipantPayment = z.infer<typeof participantPaymentSchema>;
export type Expense = z.infer<typeof expenseSchema>;
export type CourtMemberPackage = z.infer<typeof courtMemberPackageSchema>;
export type CapitalDeposit = z.infer<typeof capitalDepositSchema>;
export type ProfitSharing = z.infer<typeof profitSharingSchema>;
export type AiDraft = z.infer<typeof aiDraftSchema>;
export type TransactionIntent = (typeof transactionIntents)[number];

export type AppData = {
  accounts: Account[];
  sessions: Session[];
  participantPayments: ParticipantPayment[];
  expenses: Expense[];
  courtMemberPackages: CourtMemberPackage[];
  capitalDeposits: CapitalDeposit[];
  profitSharings: ProfitSharing[];
};

export type CollectionName =
  | "accounts"
  | "sessions"
  | "participantPayments"
  | "expenses"
  | "courtMemberPackages"
  | "capitalDeposits"
  | "profitSharings"
  | "users";

export function todayInBangkok() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function slugId(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function computePaymentTotal(input: ParticipantPaymentInput) {
  return getPaymentTotal(input);
}

export function isRealMoneyAccount(account: Account) {
  return account.id.toLowerCase() !== "free" && account.name.trim().toLowerCase() !== "free";
}
