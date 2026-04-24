import type {
  Account,
  AppData,
  CapitalDeposit,
  Expense,
  ParticipantPayment,
  ProfitSharing,
  Session,
} from "@/lib/domain";

function isCashExpense(expense: Expense) {
  return expense.intent !== "courtMemberUsage";
}

export type AccountBalance = {
  accountId: string;
  accountName: string;
  openingBalance: number;
  cashIn: number;
  cashOut: number;
  balance: number;
};

export type SessionReport = {
  sessionId: string;
  code: string;
  date: string;
  income: number;
  discount: number;
  netIncome: number;
  costOfService: number;
  profitBeforeSharing: number;
  profitSharing: number;
  profit: number;
  slotSold: number;
};

export type ExpenseCategoryReport = {
  category: string;
  amount: number;
};

export type DashboardReport = {
  cashIn: number;
  expenseTotal: number;
  currentBalance: number;
  profitLoss: number;
  accountBalances: AccountBalance[];
  sessionReports: SessionReport[];
  expenseByCategory: ExpenseCategoryReport[];
  monthlySummary: Array<{
    month: string;
    income: number;
    expense: number;
    profitSharing: number;
    profit: number;
  }>;
};

function paidIncome(payment: ParticipantPayment) {
  return payment.status === "Lunas" ? payment.total : 0;
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function byAccount<T extends { accountId?: string; amount?: number; total?: number }>(
  records: T[],
  accountId: string,
  readValue: (record: T) => number,
) {
  return sum(records.filter((record) => record.accountId === accountId).map(readValue));
}

export function buildDashboardReport(data: AppData): DashboardReport {
  const profitSharings = data.profitSharings ?? [];
  const cashExpenses = data.expenses.filter(isCashExpense);
  const cashInFromPayments = sum(data.participantPayments.map(paidIncome));
  const cashInFromCapital = sum(data.capitalDeposits.map((deposit) => deposit.amount));
  const cashIn = cashInFromPayments + cashInFromCapital;
  const expenseTotal = sum(cashExpenses.map((expense) => expense.amount));
  const profitSharingTotal = sum(profitSharings.map((sharing) => sharing.amount));
  const openingBalance = sum(data.accounts.map((account) => account.openingBalance));
  const currentBalance = openingBalance + cashIn - expenseTotal - profitSharingTotal;

  const accountBalances = data.accounts.map((account) =>
    buildAccountBalance(account, data.participantPayments, cashExpenses, data.capitalDeposits, profitSharings),
  );

  const sessionReports = data.sessions
    .map((session) => buildSessionReport(session, data.participantPayments, data.expenses, profitSharings))
    .sort((a, b) => b.date.localeCompare(a.date) || a.code.localeCompare(b.code));

  const expenseByCategory = Object.entries(
    cashExpenses.reduce<Record<string, number>>((acc, expense) => {
      acc[expense.category] = (acc[expense.category] ?? 0) + expense.amount;
      return acc;
    }, {}),
  )
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);

  const monthlySummary = buildMonthlySummary(data.participantPayments, cashExpenses, profitSharings);
  const profitLoss = sum(sessionReports.map((session) => session.profit));

  return {
    cashIn,
    expenseTotal,
    currentBalance,
    profitLoss,
    accountBalances,
    sessionReports,
    expenseByCategory,
    monthlySummary,
  };
}

function buildAccountBalance(
  account: Account,
  payments: ParticipantPayment[],
  expenses: Expense[],
  deposits: CapitalDeposit[],
  profitSharings: ProfitSharing[],
): AccountBalance {
  const paymentIn = byAccount(payments, account.id, (payment) => paidIncome(payment));
  const depositIn = byAccount(deposits, account.id, (deposit) => deposit.amount);
  const cashIn = paymentIn + depositIn;
  const cashOut =
    byAccount(expenses, account.id, (expense) => expense.amount) +
    byAccount(profitSharings, account.id, (sharing) => sharing.amount);

  return {
    accountId: account.id,
    accountName: account.name,
    openingBalance: account.openingBalance,
    cashIn,
    cashOut,
    balance: account.openingBalance + cashIn - cashOut,
  };
}

function buildSessionReport(
  session: Session,
  payments: ParticipantPayment[],
  expenses: Expense[],
  profitSharings: ProfitSharing[],
): SessionReport {
  const sessionPayments = payments.filter((payment) => payment.sessionId === session.id);
  const sessionExpenses = expenses.filter((expense) => expense.sessionId === session.id);
  const sessionProfitSharings = profitSharings.filter((sharing) => sharing.sessionId === session.id);
  const income = sum(sessionPayments.map((payment) => payment.slotPrice));
  const discount = sum(sessionPayments.map((payment) => payment.discount));
  const netIncome = sum(sessionPayments.map(paidIncome));
  const costOfService = sum(sessionExpenses.map((expense) => expense.amount));
  const sharingTotal = sum(sessionProfitSharings.map((sharing) => sharing.amount));
  const profitBeforeSharing = netIncome - costOfService;

  return {
    sessionId: session.id,
    code: session.code,
    date: session.date,
    income,
    discount,
    netIncome,
    costOfService,
    profitBeforeSharing,
    profitSharing: sharingTotal,
    profit: profitBeforeSharing - sharingTotal,
    slotSold: sessionPayments.length,
  };
}

function buildMonthlySummary(payments: ParticipantPayment[], expenses: Expense[], profitSharings: ProfitSharing[]) {
  const monthMap = new Map<string, { month: string; income: number; expense: number; profitSharing: number; profit: number }>();

  for (const payment of payments) {
    const month = payment.date.slice(0, 7);
    const row = monthMap.get(month) ?? { month, income: 0, expense: 0, profitSharing: 0, profit: 0 };
    row.income += paidIncome(payment);
    row.profit = row.income - row.expense - row.profitSharing;
    monthMap.set(month, row);
  }

  for (const expense of expenses) {
    const month = expense.date.slice(0, 7);
    const row = monthMap.get(month) ?? { month, income: 0, expense: 0, profitSharing: 0, profit: 0 };
    row.expense += expense.amount;
    row.profit = row.income - row.expense - row.profitSharing;
    monthMap.set(month, row);
  }

  for (const sharing of profitSharings) {
    const month = sharing.date.slice(0, 7);
    const row = monthMap.get(month) ?? { month, income: 0, expense: 0, profitSharing: 0, profit: 0 };
    row.profitSharing += sharing.amount;
    row.profit = row.income - row.expense - row.profitSharing;
    monthMap.set(month, row);
  }

  return [...monthMap.values()].sort((a, b) => b.month.localeCompare(a.month));
}
