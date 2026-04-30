import { describe, expect, it } from "vitest";
import type { AppData } from "@/lib/domain";
import { buildDashboardReport } from "@/lib/reports";

const data: AppData = {
  accounts: [
    { id: "bca", name: "BCA", type: "bank", openingBalance: 100000, active: true },
    { id: "jago", name: "Jago", type: "bank", openingBalance: 0, active: true },
  ],
  sessions: [
    {
      id: "kaya-001",
      code: "Kaya Padel-001",
      date: "2026-04-01",
      time: undefined,
      venue: "Kaya Padel",
      defaultSlotPrice: 100000,
      courtPrice: 45000,
      courtFree: false,
      courtExpenseAccountId: "bca",
      courtMemberPackageId: undefined,
      totalDurationHours: 1,
      memberUsageHours: 0,
      active: true,
    },
  ],
  participantPayments: [
    {
      id: "p1",
      date: "2026-04-01",
      playerName: "Ryan",
      rueclubName: undefined,
      instagram: undefined,
      whatsapp: undefined,
      category: "Umum",
      sessionId: "kaya-001",
      slotPrice: 100000,
      discount: 0,
      total: 100000,
      status: "Lunas",
      method: "Transfer",
      accountId: "bca",
      notes: undefined,
      receiptUrl: undefined,
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
      createdBy: "u1",
      updatedBy: "u1",
    },
    {
      id: "p2",
      date: "2026-04-01",
      playerName: "Nura",
      rueclubName: undefined,
      instagram: undefined,
      whatsapp: undefined,
      category: "Owner",
      sessionId: "kaya-001",
      slotPrice: 100000,
      discount: 100000,
      total: 0,
      status: "Free",
      method: undefined,
      accountId: undefined,
      notes: undefined,
      receiptUrl: undefined,
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
      createdBy: "u1",
      updatedBy: "u1",
    },
  ],
  expenses: [
    {
      id: "e1",
      date: "2026-04-01",
      description: "Court",
      category: "Court",
      sessionId: "kaya-001",
      amount: 45000,
      accountId: "bca",
      intent: "operational",
      notes: undefined,
      receiptUrl: undefined,
      reimbursed: false,
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
      createdBy: "u1",
      updatedBy: "u1",
    },
  ],
  courtMemberPackages: [],
  capitalDeposits: [
    {
      id: "c1",
      date: "2026-04-01",
      description: "Modal",
      sessionId: undefined,
      amount: 50000,
      accountId: "jago",
      sharingInvest: false,
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
      createdBy: "u1",
      updatedBy: "u1",
    },
  ],
  profitSharings: [],
};

describe("buildDashboardReport", () => {
  it("calculates balances, session profit, and monthly summary", () => {
    const report = buildDashboardReport(data);

    expect(report.cashIn).toBe(150000);
    expect(report.expenseTotal).toBe(45000);
    expect(report.currentBalance).toBe(205000);
    expect(report.profitLoss).toBe(55000);
    expect(report.accountBalances.find((row) => row.accountId === "bca")?.balance).toBe(155000);
    expect(report.accountBalances.find((row) => row.accountId === "jago")?.balance).toBe(50000);
    expect(report.sessionReports[0]).toMatchObject({
      code: "Kaya Padel-001",
      netIncome: 100000,
      costOfService: 45000,
      profit: 55000,
      slotSold: 2,
    });
    expect(report.monthlySummary[0]).toMatchObject({
      month: "2026-04",
      income: 100000,
      expense: 45000,
      profit: 55000,
    });
  });

  it("keeps profit sharing separate from operational expense while reducing net profit and balance", () => {
    const report = buildDashboardReport({
      ...data,
      profitSharings: [
        {
          id: "ps1",
          date: "2026-04-01",
          sessionId: "kaya-001",
          recipientName: "Partner",
          role: "Jaga sesi",
          calculationType: "percent",
          percentage: 50,
          baseAmount: 55000,
          amount: 27500,
          accountId: "bca",
          notes: undefined,
          receiptUrl: undefined,
          createdAt: "2026-04-01T00:00:00.000Z",
          updatedAt: "2026-04-01T00:00:00.000Z",
          createdBy: "u1",
          updatedBy: "u1",
        },
      ],
    });

    expect(report.expenseTotal).toBe(45000);
    expect(report.currentBalance).toBe(177500);
    expect(report.profitLoss).toBe(27500);
    expect(report.accountBalances.find((row) => row.accountId === "bca")?.balance).toBe(127500);
    expect(report.sessionReports[0]).toMatchObject({
      costOfService: 45000,
      profitBeforeSharing: 55000,
      profitSharing: 27500,
      profit: 27500,
    });
  });

  it("does not reduce cash balance for court member usage expense intent", () => {
    const report = buildDashboardReport({
      ...data,
      expenses: [
        ...data.expenses,
        {
          id: "e2",
          date: "2026-04-01",
          description: "Court Member Usage",
          category: "Court",
          sessionId: "kaya-001",
          amount: 100000,
          accountId: "bca",
          intent: "courtMemberUsage",
          notes: undefined,
          receiptUrl: undefined,
          reimbursed: false,
          createdAt: "2026-04-01T00:00:00.000Z",
          updatedAt: "2026-04-01T00:00:00.000Z",
          createdBy: "u1",
          updatedBy: "u1",
        },
      ],
    });

    expect(report.expenseTotal).toBe(45000);
    expect(report.currentBalance).toBe(205000);
    expect(report.accountBalances.find((row) => row.accountId === "bca")?.balance).toBe(155000);
    expect(report.sessionReports[0]).toMatchObject({
      costOfService: 145000,
      profitBeforeSharing: -45000,
      profit: -45000,
    });
  });
});
