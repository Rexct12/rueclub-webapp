"use client";

import type { FormEvent, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Account, AiDraft, AppData, Expense, ParticipantPayment, ProfitSharing, Session } from "@/lib/domain";
import { expenseCategories, paymentCategories, paymentMethods, paymentStatuses, profitSharingCalculationTypes, todayInBangkok } from "@/lib/domain";
import { formatCurrency, formatNumber, parseRupiah } from "@/lib/format";
import { jsonErrorMessage, readResponseJson } from "@/lib/fetch-json";
import type { DashboardReport } from "@/lib/reports";

type Props = { userName: string; data: AppData; report: DashboardReport; backend: string };
type Toast = { type: "ok" | "error"; message: string };
type View = "dashboard" | "input" | "ai" | "reports" | "data" | "settings";
type TimeFormat = "12h" | "24h";
type ColorMode = "light" | "dark";
const dateFormatOptions = [
  ["yyyy-mm-dd", "YYYY-MM-DD"],
  ["dd-mm-yyyy", "DD-MM-YYYY"],
  ["mm-dd-yyyy", "MM-DD-YYYY"],
  ["dd/mm/yyyy", "DD/MM/YYYY"],
] as const;
type DateFormat = (typeof dateFormatOptions)[number][0];
type Step = 1 | 2 | 3 | 4;
type SessionDraft = { date: string; time: string; code: string; venue: string; defaultSlotPrice: string; courtPrice: string; courtFree: boolean; courtExpenseAccountId: string };
type ExpenseDraft = { id: string; category: string; description: string; amount: string; accountId: string; notes: string };
type ParticipantDraft = { id: string; username: string; idReclub: string; instagram: string; whatsapp: string; category: string; slotPrice: string; discount: string; status: string; method: string; accountId: string; notes: string };

const navItems: Array<{ id: View; label: string; helper: string }> = [
  { id: "dashboard", label: "Dashboard", helper: "Ringkasan" },
  { id: "input", label: "Input", helper: "Sesi aktif" },
  { id: "ai", label: "AI Quick Entry", helper: "Draft otomatis" },
  { id: "reports", label: "Reports", helper: "Laporan bisnis" },
  { id: "data", label: "Data", helper: "Riwayat & export" },
  { id: "settings", label: "Settings", helper: "Preferensi app" },
];

const exportLinks = [
  ["participant-payments", "Pemasukan"],
  ["expenses", "Expense"],
  ["capital-deposits", "Modal Titipan"],
  ["profit-sharings", "Bagi Hasil"],
  ["sessions", "Sesi"],
  ["report", "Laporan"],
];

const viewTitles: Record<View, { eyebrow: string; title: string; description: string }> = {
  dashboard: { eyebrow: "Dashboard", title: "Ringkasan usaha", description: "Visualisasi saldo, cashflow, expense, dan performa sesi aktif." },
  input: { eyebrow: "Input", title: "Kelola sesi", description: "Buat sesi, input peserta secara cepat, dan pantau profit sesi berjalan." },
  ai: { eyebrow: "AI Quick Entry", title: "Input dari kalimat", description: "Buat draft transaksi dari bahasa Indonesia, lalu review sebelum simpan." },
  reports: { eyebrow: "Reports", title: "Laporan bisnis", description: "Profit per sesi, expense per kategori, dan ringkasan bulanan." },
  data: { eyebrow: "Data", title: "Riwayat data", description: "Transaksi terakhir dan export CSV untuk backup." },
  settings: { eyebrow: "Settings", title: "Pengaturan", description: "Atur format jam, tanggal, dan mode tampilan sesuai cara kerja kamu." },
};

function viewFromHash(): View {
  if (typeof window === "undefined") return "dashboard";
  const hash = window.location.hash.replace("#", "");
  return navItems.some((item) => item.id === hash) ? (hash as View) : "dashboard";
}

function money(value: string | number | undefined) {
  return parseRupiah(value);
}

function formatMoneyInput(value: string | number | undefined) {
  const digits = String(value ?? "")
    .replace(/\D/g, "")
    .replace(/^0+(?=\d)/, "");
  if (!digits) return "";
  return formatNumber(Number(digits));
}

function readTimeFormat(): TimeFormat {
  if (typeof window === "undefined") return "24h";
  return window.localStorage.getItem("rueclub.timeFormat") === "12h" ? "12h" : "24h";
}

function readColorMode(): ColorMode {
  if (typeof window === "undefined") return "light";
  return window.localStorage.getItem("rueclub.colorMode") === "dark" ? "dark" : "light";
}

function readDateFormat(): DateFormat {
  if (typeof window === "undefined") return "yyyy-mm-dd";
  const savedFormat = window.localStorage.getItem("rueclub.dateFormat");
  return dateFormatOptions.some(([format]) => format === savedFormat) ? (savedFormat as DateFormat) : "yyyy-mm-dd";
}

function formatDisplayDate(date: string, dateFormat: DateFormat) {
  const [year, month, day] = date.split("-");
  if (!year || !month || !day) return date;
  if (dateFormat === "dd-mm-yyyy") return `${day}-${month}-${year}`;
  if (dateFormat === "mm-dd-yyyy") return `${month}-${day}-${year}`;
  if (dateFormat === "dd/mm/yyyy") return `${day}/${month}/${year}`;
  return `${year}-${month}-${day}`;
}

function formatSessionTime(time: string | undefined, timeFormat: TimeFormat) {
  if (!time) return "";
  if (timeFormat === "24h") return time;
  const [hourText, minute = "00"] = time.split(":");
  const hour = Number(hourText);
  if (!Number.isFinite(hour)) return time;
  const period = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minute} ${period}`;
}

function formatSessionDateTime(date: string, time: string | undefined, timeFormat: TimeFormat, dateFormat: DateFormat) {
  const formattedTime = formatSessionTime(time, timeFormat);
  const formattedDate = formatDisplayDate(date, dateFormat);
  return formattedTime ? `${formattedDate}, ${formattedTime}` : formattedDate;
}

function profitSharingAmount(calculationType: string, percentage: string | number | undefined, fixedAmount: string | number | undefined, baseAmount: number) {
  if (calculationType === "percent") {
    const percent = Number(percentage ?? 0);
    return Math.max(0, Math.round((baseAmount * (Number.isFinite(percent) ? percent : 0)) / 100));
  }
  return money(fixedAmount);
}

function makeParticipant(slotPrice: string, accountId: string): ParticipantDraft {
  return { id: crypto.randomUUID(), username: "", idReclub: "", instagram: "", whatsapp: "", category: "Umum", slotPrice, discount: "0", status: "Belum", method: "Transfer", accountId, notes: "" };
}

function makeParticipants(count: number, slotPrice: string, accountId: string) {
  return Array.from({ length: count }, () => makeParticipant(slotPrice, accountId));
}

function makeExpense(category = "Biaya Compliment", description = "", accountId = ""): ExpenseDraft {
  return { id: crypto.randomUUID(), category, description, amount: "", accountId, notes: "" };
}

function makeExpenses(accountId: string) {
  return [
    makeExpense("Biaya Compliment", "Compliment", accountId),
    makeExpense("Bensin", "Transport", accountId),
    makeExpense("Biaya Dokumentasi", "Dokumentasi", accountId),
  ];
}

function participantTotal(row: ParticipantDraft) {
  return row.status === "Free" ? 0 : Math.max(0, money(row.slotPrice) - money(row.discount));
}

function participantDiscount(row: ParticipantDraft) {
  return row.status === "Free" ? money(row.slotPrice) : money(row.discount);
}

function participantSummary(rows: ParticipantDraft[]) {
  const filled = rows.filter((row) => row.username.trim());
  return {
    count: filled.length,
    collected: filled.reduce((sum, row) => sum + (row.status === "Lunas" ? participantTotal(row) : 0), 0),
    outstanding: filled.reduce((sum, row) => sum + (row.status === "Belum" ? participantTotal(row) : 0), 0),
    discount: filled.reduce((sum, row) => sum + participantDiscount(row), 0),
    free: filled.filter((row) => row.status === "Free").length,
  };
}

export function FinanceWorkspace({ userName, data, report, backend }: Props) {
  const router = useRouter();
  const [toast, setToast] = useState<Toast | null>(null);
  const [savingMasterType, setSavingMasterType] = useState<"account" | "session" | null>(null);
  const [savingTransactionType, setSavingTransactionType] = useState<"expense" | "capitalDeposit" | null>(null);
  const transactionInFlight = useRef<"expense" | "capitalDeposit" | null>(null);
  const [activeView, setActiveView] = useState<View>(() => viewFromHash());
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState<Step>(1);
  const [wizardError, setWizardError] = useState<string | null>(null);
  const [savingWizard, setSavingWizard] = useState(false);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [participantSessionId, setParticipantSessionId] = useState<string | null>(null);
  const [detailMode, setDetailMode] = useState<"wizard" | "quick" | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [aiInput, setAiInput] = useState("");
  const [draft, setDraft] = useState<AiDraft | null>(null);
  const [timeFormat, setTimeFormat] = useState<TimeFormat>(() => readTimeFormat());
  const [colorMode, setColorMode] = useState<ColorMode>(() => readColorMode());
  const [dateFormat, setDateFormat] = useState<DateFormat>(() => readDateFormat());
  const [isPending, startTransition] = useTransition();
  const today = todayInBangkok();

  useEffect(() => {
    document.documentElement.dataset.theme = colorMode;
    window.localStorage.setItem("rueclub.colorMode", colorMode);
  }, [colorMode]);

  useEffect(() => {
    window.localStorage.setItem("rueclub.timeFormat", timeFormat);
  }, [timeFormat]);

  useEffect(() => {
    window.localStorage.setItem("rueclub.dateFormat", dateFormat);
  }, [dateFormat]);

  const activeAccounts = useMemo(() => data.accounts.filter((account) => account.active), [data.accounts]);
  const activeSessions = useMemo(() => data.sessions.filter((session) => session.active), [data.sessions]);
  const accountOptions = useMemo(() => activeAccounts.map((account): [string, string] => [account.id, account.name]), [activeAccounts]);
  const sessionOptions = useMemo(() => activeSessions.map((session): [string, string] => [session.id, session.code]), [activeSessions]);
  const firstAccountId = activeAccounts[0]?.id ?? "";

  const [sessionDraft, setSessionDraft] = useState<SessionDraft>(() => ({ date: today, time: "", code: "", venue: "", defaultSlotPrice: "0", courtPrice: "0", courtFree: false, courtExpenseAccountId: firstAccountId }));
  const [initialExpenses, setInitialExpenses] = useState<ExpenseDraft[]>(() => makeExpenses(firstAccountId));
  const [wizardParticipants, setWizardParticipants] = useState<ParticipantDraft[]>(() => makeParticipants(8, "0", firstAccountId));
  const [quickParticipants, setQuickParticipants] = useState<ParticipantDraft[]>(() => makeParticipants(8, "0", firstAccountId));

  const reportBySessionId = useMemo(() => new Map(report.sessionReports.map((row) => [row.sessionId, row])), [report.sessionReports]);
  const paymentStatsBySession = useMemo(() => {
    const map = new Map<string, { filled: number; lunas: number; belum: number; free: number; outstanding: number; discount: number }>();
    for (const payment of data.participantPayments) {
      const row = map.get(payment.sessionId) ?? { filled: 0, lunas: 0, belum: 0, free: 0, outstanding: 0, discount: 0 };
      row.filled += 1;
      row.discount += payment.status === "Free" ? payment.slotPrice : payment.discount;
      if (payment.status === "Lunas") row.lunas += 1;
      if (payment.status === "Belum") {
        row.belum += 1;
        row.outstanding += payment.total;
      }
      if (payment.status === "Free") row.free += 1;
      map.set(payment.sessionId, row);
    }
    return map;
  }, [data.participantPayments]);

  const editingSession = editingSessionId ? data.sessions.find((session) => session.id === editingSessionId) ?? null : null;
  const editingSessionPayments = useMemo(() => editingSessionId ? data.participantPayments.filter((payment) => payment.sessionId === editingSessionId) : [], [data.participantPayments, editingSessionId]);
  const editingSessionExpenses = useMemo(() => editingSessionId ? data.expenses.filter((expense) => expense.sessionId === editingSessionId) : [], [data.expenses, editingSessionId]);
  const editingSessionProfitSharings = useMemo(() => editingSessionId ? data.profitSharings.filter((sharing) => sharing.sessionId === editingSessionId) : [], [data.profitSharings, editingSessionId]);
  const participantSession = participantSessionId ? data.sessions.find((session) => session.id === participantSessionId) ?? null : null;
  const detailRows = detailMode === "wizard" ? wizardParticipants : quickParticipants;
  const detailParticipant = detailId ? detailRows.find((row) => row.id === detailId) ?? null : null;

  function goToView(view: View) {
    setActiveView(view);
    window.history.replaceState(null, "", `#${view}`);
    setDrawerOpen(false);
  }

  async function postJson(url: string, payload: unknown) {
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const data = await readResponseJson(response);
    if (!response.ok) {
      throw new Error(jsonErrorMessage(data) || `Request gagal (${response.status}).`);
    }
    return (data ?? {}) as unknown;
  }

  async function putJson(url: string, payload: unknown) {
    const response = await fetch(url, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const data = await readResponseJson(response);
    if (!response.ok) {
      throw new Error(jsonErrorMessage(data) || `Request gagal (${response.status}).`);
    }
    return (data ?? {}) as unknown;
  }

  function reloadAfter(message: string) {
    setToast({ type: "ok", message });
    window.setTimeout(() => router.refresh(), 350);
  }

  function openWizard() {
    setWizardStep(1);
    setWizardError(null);
    setSavingWizard(false);
    setSessionDraft({ date: today, time: "", code: "", venue: "", defaultSlotPrice: "0", courtPrice: "0", courtFree: false, courtExpenseAccountId: firstAccountId });
    setInitialExpenses(makeExpenses(firstAccountId));
    setWizardParticipants(makeParticipants(8, "0", firstAccountId));
    setWizardOpen(true);
  }

  function nextStep() {
    if (wizardStep === 1 && (!sessionDraft.date || !sessionDraft.code.trim())) {
      setWizardError("Tanggal dan kode sesi wajib diisi.");
      return;
    }
    setWizardError(null);
    if (wizardStep === 1) {
      setWizardParticipants((rows) => rows.map((row) => row.slotPrice && row.slotPrice !== "0" ? row : { ...row, slotPrice: sessionDraft.defaultSlotPrice || "0" }));
    }
    setWizardStep((step) => Math.min(4, step + 1) as Step);
  }

  function goToWizardStep(step: Step) {
    setWizardError(null);
    if (step >= 3) {
      setWizardParticipants((rows) => rows.map((row) => row.slotPrice && row.slotPrice !== "0" ? row : { ...row, slotPrice: sessionDraft.defaultSlotPrice || "0" }));
    }
    setWizardStep(step);
  }

  async function submitMaster(event: FormEvent<HTMLFormElement>, type: "account" | "session") {
    event.preventDefault();
    if (savingMasterType) return;
    setSavingMasterType(type);
    const formData = new FormData(event.currentTarget);
    const payload = type === "account"
      ? { type, name: formData.get("name"), accountType: formData.get("accountType"), openingBalance: money(String(formData.get("openingBalance") ?? 0)) }
      : { id: formData.get("id") || undefined, type, date: formData.get("date"), time: formData.get("time"), code: formData.get("code"), venue: formData.get("venue"), defaultSlotPrice: money(String(formData.get("defaultSlotPrice") ?? 0)), courtPrice: money(String(formData.get("courtPrice") ?? 0)), courtFree: formData.get("courtFree") === "on", courtExpenseAccountId: formData.get("courtExpenseAccountId") || undefined, active: formData.get("active") !== "false" };
    try {
      await postJson("/api/master", payload);
      reloadAfter(type === "account" ? "Akun ditambahkan." : "Sesi disimpan.");
    } catch (error) {
      setToast({ type: "error", message: error instanceof Error ? error.message : "Gagal menyimpan." });
    } finally {
      setSavingMasterType(null);
    }
  }

  async function deleteSession(id: string, code: string) {
    if (!window.confirm(`Hapus sesi ${code}? Transaksi yang sudah memakai sesi ini tidak ikut terhapus.`)) return;
    const response = await fetch(`/api/master?type=session&id=${id}`, { method: "DELETE" });
    if (response.ok) reloadAfter("Sesi dihapus.");
    else setToast({ type: "error", message: "Gagal menghapus sesi." });
  }

  async function deleteAccount(id: string, name: string) {
    if (!window.confirm(`Hapus akun ${name}? Ini hanya bisa dilakukan jika akun belum dipakai transaksi atau sesi.`)) return;
    const response = await fetch(`/api/master?type=account&id=${id}`, { method: "DELETE" });
    if (response.ok) {
      reloadAfter("Akun dihapus.");
      return;
    }
    const data = await readResponseJson(response);
    setToast({ type: "error", message: jsonErrorMessage(data) || "Gagal menghapus akun." });
  }

  function filledParticipants(rows: ParticipantDraft[]) {
    const filled = rows.filter((row) => row.username.trim());
    for (const row of filled) {
      if (row.status === "Lunas" && !row.accountId) throw new Error(`Akun masuk wajib diisi untuk peserta lunas: ${row.username}.`);
    }
    return filled;
  }

  async function saveParticipants(session: Session, rows: ParticipantDraft[]) {
    const filled = filledParticipants(rows);
    for (const row of filled) {
      const status = paymentStatuses.includes(row.status as never) ? row.status : "Belum";
      const isPaid = status === "Lunas";
      await postJson("/api/transactions", {
        type: "participantPayment",
        payload: {
          date: session.date,
          playerName: row.username,
          rueclubName: row.idReclub,
          instagram: row.instagram,
          whatsapp: row.whatsapp,
          category: paymentCategories.includes(row.category as never) ? row.category : "Umum",
          sessionId: session.id,
          slotPrice: money(row.slotPrice),
          discount: status === "Free" ? money(row.slotPrice) : money(row.discount),
          status,
          method: isPaid ? row.method : undefined,
          accountId: isPaid ? row.accountId : undefined,
          notes: row.notes,
        },
      });
    }
    return filled.length;
  }

  async function saveWizard() {
    if (savingWizard) return;
    setWizardError(null);
    setSavingWizard(true);
    try {
      const extraExpenses = initialExpenses.filter((row) => money(row.amount) > 0);
      for (const expense of extraExpenses) {
        if (!expense.description.trim() || !expense.accountId) throw new Error("Expense awal yang nominalnya diisi wajib punya keterangan dan akun keluar.");
      }
      if (!sessionDraft.date || !sessionDraft.code.trim()) throw new Error("Tanggal dan kode sesi wajib diisi.");
      const result = (await postJson("/api/master", { type: "session", ...sessionDraft, defaultSlotPrice: money(sessionDraft.defaultSlotPrice), courtPrice: money(sessionDraft.courtPrice), active: true })) as { session?: Session };
      if (!result.session) {
        throw new Error("Server tidak mengembalikan data sesi. Coba lagi atau cek koneksi.");
      }
      for (const expense of extraExpenses) {
        await postJson("/api/transactions", { type: "expense", payload: { date: result.session.date, description: expense.description, category: expenseCategories.includes(expense.category as never) ? expense.category : "Biaya Compliment", sessionId: result.session.id, amount: money(expense.amount), accountId: expense.accountId, notes: expense.notes, reimbursed: false } });
      }
      const count = await saveParticipants(result.session, wizardParticipants);
      setWizardOpen(false);
      reloadAfter(`Sesi ${result.session.code} dibuat dengan ${count} peserta.`);
    } catch (error) {
      setWizardError(error instanceof Error ? error.message : "Gagal membuat sesi.");
    } finally {
      setSavingWizard(false);
    }
  }

  async function saveParticipantsForExistingSession() {
    if (!participantSession) return;
    try {
      const count = await saveParticipants(participantSession, quickParticipants);
      setParticipantSessionId(null);
      reloadAfter(`${count} peserta ditambahkan ke sesi ${participantSession.code}.`);
    } catch (error) {
      setToast({ type: "error", message: error instanceof Error ? error.message : "Gagal menyimpan peserta." });
    }
  }

  async function saveParticipantsFromSessionEdit(session: Session, rows: ParticipantDraft[]) {
    try {
      const count = await saveParticipants(session, rows);
      reloadAfter(`${count} peserta ditambahkan ke sesi ${session.code}.`);
      return count;
    } catch (error) {
      setToast({ type: "error", message: error instanceof Error ? error.message : "Gagal menyimpan peserta." });
      return 0;
    }
  }

  async function submitTransaction(event: FormEvent<HTMLFormElement>, type: "expense" | "capitalDeposit") {
    event.preventDefault();
    if (transactionInFlight.current) return;
    transactionInFlight.current = type;
    setSavingTransactionType(type);
    const base = Object.fromEntries(new FormData(event.currentTarget).entries());
    const payload = type === "expense"
      ? { date: base.date, description: base.description, category: base.category, sessionId: base.sessionId || undefined, amount: money(String(base.amount ?? 0)), accountId: base.accountId, notes: base.notes, reimbursed: base.reimbursed === "on", receiptUrl: base.receiptUrl }
      : { date: base.date, description: base.description, sessionId: base.sessionId || undefined, amount: money(String(base.amount ?? 0)), accountId: base.accountId, sharingInvest: base.sharingInvest === "on" };
    try {
      await postJson("/api/transactions", { type, payload });
      event.currentTarget.reset();
      reloadAfter(type === "capitalDeposit" ? "Modal tersimpan." : "Expense tersimpan.");
    } catch (error) {
      setToast({ type: "error", message: error instanceof Error ? error.message : "Gagal menyimpan." });
    } finally {
      transactionInFlight.current = null;
      setSavingTransactionType(null);
    }
  }

  async function createAiDraft() {
    setToast(null);
    startTransition(async () => {
      try {
        const response = (await postJson("/api/ai/draft", { input: aiInput })) as { draft: AiDraft };
        setDraft(response.draft);
      } catch (error) {
        setToast({ type: "error", message: error instanceof Error ? error.message : "AI draft gagal." });
      }
    });
  }

  async function saveDraft() {
    if (!draft) return;
    const accountId = activeAccounts.find((account) => account.name.toLowerCase() === draft.accountName?.toLowerCase())?.id;
    const sessionId = activeSessions.find((session) => session.code.toLowerCase() === draft.sessionCode?.toLowerCase())?.id;
    const status = paymentStatuses.includes(draft.status as never) ? draft.status : "Lunas";
    const paidParticipant = draft.intent === "participantPayment" && status === "Lunas";
    const accountRequired = draft.intent !== "participantPayment" || paidParticipant;
    if ((accountRequired && !accountId) || !draft.amount) {
      setToast({ type: "error", message: "Lengkapi akun dan nominal sebelum menyimpan." });
      return;
    }
    const payload = draft.intent === "capitalDeposit"
      ? { date: draft.date ?? today, description: draft.description ?? "Modal titipan", sessionId, amount: draft.amount, accountId: accountId!, sharingInvest: false }
      : draft.intent === "expense"
        ? { date: draft.date ?? today, description: draft.description ?? draft.notes ?? "Expense", category: expenseCategories.includes(draft.category as never) ? draft.category : "Court", sessionId, amount: draft.amount, accountId: accountId!, notes: draft.notes, reimbursed: false }
        : { date: draft.date ?? today, playerName: draft.playerName ?? "Tanpa username", category: paymentCategories.includes(draft.category as never) ? draft.category : "Umum", sessionId: sessionId ?? activeSessions[0]?.id, slotPrice: draft.amount, discount: status === "Free" ? draft.amount : 0, status, method: paidParticipant ? "Transfer" : undefined, accountId: paidParticipant ? accountId : undefined, notes: draft.notes };
    if (draft.intent === "participantPayment" && !payload.sessionId) {
      setToast({ type: "error", message: "Pilih atau buat sesi sebelum menyimpan pembayaran peserta." });
      return;
    }
    try {
      await postJson("/api/transactions", { type: draft.intent === "capitalDeposit" ? "capitalDeposit" : draft.intent, payload });
      reloadAfter("Draft AI disimpan sebagai transaksi.");
    } catch (error) {
      setToast({ type: "error", message: error instanceof Error ? error.message : "Gagal menyimpan draft." });
    }
  }

  async function deleteTransaction(type: string, id: string) {
    const response = await fetch(`/api/transactions?type=${type}&id=${id}`, { method: "DELETE" });
    if (response.ok) reloadAfter("Transaksi dihapus.");
    else setToast({ type: "error", message: "Gagal menghapus transaksi." });
  }

  async function updateParticipantPayment(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    const base = Object.fromEntries(new FormData(event.currentTarget).entries());
    const status = paymentStatuses.includes(base.status as never) ? String(base.status) : "Belum";
    const isPaid = status === "Lunas";
    const slotPrice = money(String(base.slotPrice ?? 0));
    const payload = {
      date: base.date,
      playerName: base.playerName,
      rueclubName: base.rueclubName,
      instagram: base.instagram,
      whatsapp: base.whatsapp,
      category: paymentCategories.includes(base.category as never) ? base.category : "Umum",
      sessionId: base.sessionId,
      slotPrice,
      discount: status === "Free" ? slotPrice : money(String(base.discount ?? 0)),
      status,
      method: isPaid ? base.method : undefined,
      accountId: isPaid ? base.accountId : undefined,
      notes: base.notes,
    };
    try {
      await putJson("/api/transactions", { type: "participantPayment", id, payload });
      reloadAfter("Peserta sesi diperbarui.");
    } catch (error) {
      setToast({ type: "error", message: error instanceof Error ? error.message : "Gagal update peserta." });
    }
  }

  async function updateExpense(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    const base = Object.fromEntries(new FormData(event.currentTarget).entries());
    const payload = {
      date: base.date,
      description: base.description,
      category: expenseCategories.includes(base.category as never) ? base.category : "Biaya Compliment",
      sessionId: base.sessionId || undefined,
      amount: money(String(base.amount ?? 0)),
      accountId: base.accountId,
      notes: base.notes,
      reimbursed: base.reimbursed === "on",
      receiptUrl: base.receiptUrl,
    };
    try {
      await putJson("/api/transactions", { type: "expense", id, payload });
      reloadAfter("Expense sesi diperbarui.");
    } catch (error) {
      setToast({ type: "error", message: error instanceof Error ? error.message : "Gagal update expense." });
    }
  }

  async function createSessionExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const base = Object.fromEntries(new FormData(event.currentTarget).entries());
    const payload = {
      date: base.date,
      description: base.description,
      category: expenseCategories.includes(base.category as never) ? base.category : "Biaya Compliment",
      sessionId: base.sessionId || undefined,
      amount: money(String(base.amount ?? 0)),
      accountId: base.accountId,
      notes: base.notes,
      reimbursed: base.reimbursed === "on",
      receiptUrl: base.receiptUrl,
    };
    try {
      await postJson("/api/transactions", { type: "expense", payload });
      event.currentTarget.reset();
      reloadAfter("Expense sesi ditambahkan.");
    } catch (error) {
      setToast({ type: "error", message: error instanceof Error ? error.message : "Gagal menambah expense." });
    }
  }

  function profitSharingPayloadFromForm(form: HTMLFormElement) {
    const base = Object.fromEntries(new FormData(form).entries());
    const calculationType = profitSharingCalculationTypes.includes(base.calculationType as never) ? String(base.calculationType) : "fixed";
    const baseAmount = money(String(base.baseAmount ?? 0));
    const percentage = Number(base.percentage ?? 0);
    const amount = profitSharingAmount(calculationType, percentage, String(base.amount ?? 0), baseAmount);
    if (!String(base.recipientName ?? "").trim()) {
      throw new Error("Penerima bagi hasil wajib diisi.");
    }
    if (!String(base.accountId ?? "").trim()) {
      throw new Error("Akun keluar bagi hasil wajib dipilih.");
    }
    if (calculationType === "percent" && (!Number.isFinite(percentage) || percentage <= 0)) {
      throw new Error("Persentase bagi hasil wajib lebih dari 0.");
    }
    if (calculationType === "fixed" && amount <= 0) {
      throw new Error("Nominal fixed bagi hasil wajib lebih dari 0.");
    }
    return {
      date: base.date,
      sessionId: base.sessionId,
      recipientName: base.recipientName,
      role: base.role,
      calculationType,
      percentage: calculationType === "percent" ? percentage : undefined,
      baseAmount,
      amount,
      accountId: base.accountId,
      notes: base.notes,
      receiptUrl: base.receiptUrl,
    };
  }

  async function createProfitSharing(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await postJson("/api/transactions", { type: "profitSharing", payload: profitSharingPayloadFromForm(event.currentTarget) });
      event.currentTarget.reset();
      reloadAfter("Bagi hasil disimpan.");
    } catch (error) {
      setToast({ type: "error", message: error instanceof Error ? error.message : "Gagal menyimpan bagi hasil." });
    }
  }

  async function updateProfitSharing(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    try {
      await putJson("/api/transactions", { type: "profitSharing", id, payload: profitSharingPayloadFromForm(event.currentTarget) });
      reloadAfter("Bagi hasil diperbarui.");
    } catch (error) {
      setToast({ type: "error", message: error instanceof Error ? error.message : "Gagal update bagi hasil." });
    }
  }

  async function deleteSessionTransaction(type: "participantPayment" | "expense" | "profitSharing", id: string, label: string) {
    if (!window.confirm(`Hapus ${label}?`)) return;
    await deleteTransaction(type, id);
  }

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/login";
  }

  function openDetail(mode: "wizard" | "quick", id: string) {
    setDetailMode(mode);
    setDetailId(id);
  }

  const header = viewTitles[activeView];

  return (
    <main className={`app-shell view-${activeView}`}>
      <button className="hamburger-button" onClick={() => setDrawerOpen(true)} aria-label="Buka menu"><span /><span /><span /></button>
      <div className={`drawer-scrim ${drawerOpen ? "open" : ""}`} onClick={() => setDrawerOpen(false)} />
      <aside className={`sidebar ${drawerOpen ? "open" : ""}`}>
        <div><p className="brand">RUE CLUB</p><p className="muted">Finance workspace</p></div>
        <nav>{navItems.map((item) => <button className={activeView === item.id ? "active" : ""} key={item.id} onClick={() => goToView(item.id)}><span>{item.label}</span><small>{item.helper}</small></button>)}</nav>
        <div className="sidebar-footer"><p>{userName}</p><p className="muted">{backend}</p><button className="ghost-button" onClick={logout}>Keluar</button></div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div><p className="eyebrow">{header.eyebrow}</p><h1>{header.title}</h1><p className="topbar-description">{header.description}</p></div>
          <div className="topbar-actions">
            {activeView === "dashboard" || activeView === "input" ? <button onClick={openWizard}>Buat Sesi Baru</button> : null}
            {activeView === "dashboard" ? <button className="secondary-button" onClick={() => goToView("input")}>Kelola Sesi</button> : null}
            {activeView === "reports" || activeView === "data" ? <ExportButtons /> : null}
          </div>
        </header>
        {toast ? <p className={`toast ${toast.type}`}>{toast.message}</p> : null}

        <section className="metric-band" id="dashboard">
          <Metric label="Cash In" value={formatCurrency(report.cashIn)} />
          <Metric label="Expense" value={formatCurrency(report.expenseTotal)} />
          <Metric label="Current Balance" value={formatCurrency(report.currentBalance)} />
          <Metric label="Profit/Loss" value={formatCurrency(report.profitLoss)} tone={report.profitLoss < 0 ? "bad" : "good"} />
        </section>

        <section className="split-section">
          <div className="panel"><div className="section-head"><h2>Account Balance</h2><p>Saldo awal + cash in - cash out.</p></div><BarList rows={report.accountBalances.map((row) => ({ label: row.accountName, value: row.balance, helper: `${formatCurrency(row.cashIn)} in / ${formatCurrency(row.cashOut)} out` }))} /></div>
          <div className="panel"><div className="section-head"><h2>Expense Category</h2><p>Breakdown pengeluaran aktif.</p></div><BarList rows={report.expenseByCategory.slice(0, 6).map((row) => ({ label: row.category, value: row.amount, helper: formatCurrency(row.amount) }))} empty="Belum ada expense." /></div>
          <div className="panel session-summary"><div className="section-head horizontal-head"><div><h2>Sesi Terbaru</h2><p>{activeSessions.length} sesi aktif tersimpan.</p></div><button onClick={openWizard}>Buat Sesi</button></div><SessionSummaryTable dateFormat={dateFormat} report={report} sessions={activeSessions} timeFormat={timeFormat} onEditSession={setEditingSessionId} /></div>
        </section>

        <section className="session-workspace" id="input">
          <details className="admin-drawer"><summary>Administrasi manual</summary><ManualAdminForms accounts={activeAccounts} today={today} accountOptions={accountOptions} savingTransactionType={savingTransactionType} sessionOptions={sessionOptions} onDeleteAccount={deleteAccount} onSaveMaster={submitMaster} onSaveTransaction={submitTransaction} /></details>
          <div className="section-head horizontal-head">
            <div><h2>Sesi Berjalan</h2><p>Pilih sesi untuk cek slot terisi, expense, profit, dan pembayaran yang belum masuk.</p></div>
            <div className="session-section-actions"><button className="secondary-button" onClick={() => goToView("reports")}>Lihat Laporan</button><button onClick={openWizard}>Buat Sesi Baru</button></div>
          </div>
          <div className="session-board">
            {activeSessions.map((session) => {
              const sessionReport = reportBySessionId.get(session.id);
              const stats = paymentStatsBySession.get(session.id);
              const sessionTime = formatSessionTime(session.time, timeFormat) || "-";
              return (
                <article className="session-card" key={session.id}>
                  <div className="session-card-main"><p className="eyebrow">Kode sesi</p><h3>{session.code}</h3><p className="table-subtext">Harga slot {formatCurrency(session.defaultSlotPrice)}</p></div>
                  <div className="session-card-stats"><MiniStat label="Tanggal" value={formatDisplayDate(session.date, dateFormat)} /><MiniStat label="Jam" value={sessionTime} /><MiniStat label="Slot" value={String(stats?.filled ?? 0)} /><MiniStat label="Expense" value={formatCurrency(sessionReport?.costOfService ?? 0)} /><MiniStat label="Profit" value={formatCurrency(sessionReport?.profit ?? 0)} tone={(sessionReport?.profit ?? 0) < 0 ? "bad" : "good"} /></div>
                  <div className="session-payment-strip"><span>Lunas {stats?.lunas ?? 0}</span><span>Belum {stats?.belum ?? 0}</span><span>Free {stats?.free ?? 0}</span><span>Diskon {formatCurrency(stats?.discount ?? 0)}</span></div>
                  <div className="session-card-actions"><button className="secondary-button" onClick={() => setEditingSessionId(session.id)}>Edit Sesi</button></div>
                </article>
              );
            })}
            {!activeSessions.length ? <div className="empty-state"><h3>Belum ada sesi aktif.</h3><p>Buat sesi pertama, lalu lanjutkan langsung ke input peserta secara batch.</p><button onClick={openWizard}>Buat Sesi Baru</button></div> : null}
          </div>
        </section>

        <AiPanel aiInput={aiInput} draft={draft} isPending={isPending} onAiInput={setAiInput} onDraftChange={setDraft} onDraftCreate={createAiDraft} onDraftSave={saveDraft} today={today} />
        <ReportsPanel dateFormat={dateFormat} report={report} />
        <section className="panel" id="data"><div className="section-head"><h2>Transaksi Terakhir</h2><p>Hapus hanya untuk koreksi input. Edit penuh bisa ditambahkan di iterasi berikutnya.</p></div><ExportButtons /><RecentTransactions data={data} dateFormat={dateFormat} onDelete={deleteTransaction} /></section>
        <SettingsPanel colorMode={colorMode} dateFormat={dateFormat} onColorModeChange={setColorMode} onDateFormatChange={setDateFormat} onTimeFormatChange={setTimeFormat} timeFormat={timeFormat} />
      </section>

      {wizardOpen ? <SessionWizard accountOptions={accountOptions} dateFormat={dateFormat} error={wizardError} expenses={initialExpenses} isSaving={savingWizard} onClose={() => setWizardOpen(false)} onExpenseChange={setInitialExpenses} onParticipantDetail={(id) => openDetail("wizard", id)} onParticipantsChange={setWizardParticipants} onSave={saveWizard} onSessionChange={setSessionDraft} onStepBack={() => { setWizardError(null); setWizardStep((step) => Math.max(1, step - 1) as Step); }} onStepNext={nextStep} onStepSelect={goToWizardStep} participants={wizardParticipants} session={sessionDraft} step={wizardStep} timeFormat={timeFormat} /> : null}
      {editingSession ? (
        <SessionEditModal
          accountOptions={accountOptions}
          expenses={editingSessionExpenses}
          onClose={() => setEditingSessionId(null)}
          onDelete={deleteSession}
          onDeleteTransaction={deleteSessionTransaction}
          onExpenseCreate={createSessionExpense}
          onExpenseSave={updateExpense}
          isSaving={savingMasterType === "session"}
          onNewParticipantsSave={saveParticipantsFromSessionEdit}
          onParticipantSave={updateParticipantPayment}
          onProfitSharingCreate={createProfitSharing}
          onProfitSharingSave={updateProfitSharing}
          onSave={submitMaster}
          payments={editingSessionPayments}
          profitSharings={editingSessionProfitSharings}
          session={editingSession}
        />
      ) : null}
      {participantSession ? <ParticipantAppendModal accountOptions={accountOptions} onClose={() => setParticipantSessionId(null)} onDetail={(id) => openDetail("quick", id)} onParticipantsChange={setQuickParticipants} onSave={saveParticipantsForExistingSession} participants={quickParticipants} session={participantSession} /> : null}
      {detailParticipant ? <ParticipantDetailModal participant={detailParticipant} onChange={(next) => detailMode === "wizard" ? setWizardParticipants((rows) => rows.map((row) => row.id === next.id ? next : row)) : setQuickParticipants((rows) => rows.map((row) => row.id === next.id ? next : row))} onClose={() => { setDetailId(null); setDetailMode(null); }} /> : null}
    </main>
  );
}

function SessionWizard({
  accountOptions,
  dateFormat,
  error,
  expenses,
  isSaving,
  onClose,
  onExpenseChange,
  onParticipantDetail,
  onParticipantsChange,
  onSave,
  onSessionChange,
  onStepBack,
  onStepNext,
  onStepSelect,
  participants,
  session,
  step,
  timeFormat,
}: {
  accountOptions: Array<[string, string]>;
  dateFormat: DateFormat;
  error: string | null;
  expenses: ExpenseDraft[];
  isSaving: boolean;
  onClose: () => void;
  onExpenseChange: (expenses: ExpenseDraft[]) => void;
  onParticipantDetail: (id: string) => void;
  onParticipantsChange: (participants: ParticipantDraft[]) => void;
  onSave: () => void;
  onSessionChange: (session: SessionDraft) => void;
  onStepBack: () => void;
  onStepNext: () => void;
  onStepSelect: (step: Step) => void;
  participants: ParticipantDraft[];
  session: SessionDraft;
  step: Step;
  timeFormat: TimeFormat;
}) {
  const summary = participantSummary(participants);
  const extraExpense = expenses.reduce((sum, row) => sum + money(row.amount), 0);
  const courtExpense = session.courtFree ? 0 : money(session.courtPrice);
  const totalExpense = courtExpense + extraExpense;

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section className="modal-panel wizard-panel" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div><p className="eyebrow">Step {step} dari 4</p><h2>Buat sesi baru</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="Tutup modal">X</button>
        </div>
        {error ? <p className="modal-error">{error}</p> : null}
        <WizardSteps activeStep={step} onStepSelect={onStepSelect} />

        {step === 1 ? (
          <div className="wizard-grid">
            <label>Tanggal sesi<input type="date" value={session.date} onChange={(event) => onSessionChange({ ...session, date: event.target.value })} required /></label>
            <label>Jam sesi<input type="time" value={session.time} onChange={(event) => onSessionChange({ ...session, time: event.target.value })} /></label>
            <label>Kode sesi<input value={session.code} onChange={(event) => onSessionChange({ ...session, code: event.target.value })} placeholder="Kaya Padel-001" required /></label>
            <label>Venue<input value={session.venue} onChange={(event) => onSessionChange({ ...session, venue: event.target.value })} placeholder="Kaya Padel" /></label>
            <label>Harga slot default<MoneyInput value={session.defaultSlotPrice} onValueChange={(value) => onSessionChange({ ...session, defaultSlotPrice: value })} /></label>
            <label>Harga lapangan<MoneyInput value={session.courtPrice} onValueChange={(value) => onSessionChange({ ...session, courtPrice: value })} disabled={session.courtFree} /></label>
            <label>Akun biaya lapangan<Select options={accountOptions} value={session.courtExpenseAccountId} onChange={(value) => onSessionChange({ ...session, courtExpenseAccountId: value })} /></label>
            <label className="checkbox inline-checkbox"><input type="checkbox" checked={session.courtFree} onChange={(event) => onSessionChange({ ...session, courtFree: event.target.checked })} /> Lapangan free</label>
          </div>
        ) : null}

        {step === 2 ? <InitialExpenseEditor accountOptions={accountOptions} courtExpense={courtExpense} expenses={expenses} onChange={onExpenseChange} session={session} /> : null}
        {step === 3 ? <BulkParticipantsTable accountOptions={accountOptions} defaultSlotPrice={session.defaultSlotPrice || "0"} onDetail={onParticipantDetail} onRowsChange={onParticipantsChange} rows={participants} /> : null}
        {step === 4 ? (
          <div className="review-grid">
            <ReviewItem label="Sesi" value={session.code || "-"} helper={formatSessionDateTime(session.date, session.time, timeFormat, dateFormat)} />
            <ReviewItem label="Venue" value={session.venue || "-"} helper={`Harga slot ${formatCurrency(money(session.defaultSlotPrice))}`} />
            <ReviewItem label="Peserta" value={`${summary.count} slot`} helper={`${summary.free} free`} />
            <ReviewItem label="Collected" value={formatCurrency(summary.collected)} helper="Uang sudah masuk" />
            <ReviewItem label="Outstanding" value={formatCurrency(summary.outstanding)} helper="Belum dibayar" />
            <ReviewItem label="Discount" value={formatCurrency(summary.discount)} helper="Potongan/free" />
            <ReviewItem label="Expense awal" value={formatCurrency(totalExpense)} helper={`Court ${formatCurrency(courtExpense)} + lainnya ${formatCurrency(extraExpense)}`} />
            <ReviewItem label="Estimasi profit" value={formatCurrency(summary.collected - totalExpense)} helper="Berdasarkan pembayaran lunas" />
          </div>
        ) : null}

        <div className="wizard-actions">
          <button className="secondary-button" type="button" onClick={step === 1 ? onClose : onStepBack}>{step === 1 ? "Batal" : "Kembali"}</button>
          {step < 4 ? <button type="button" onClick={onStepNext}>Lanjut</button> : <button type="button" onClick={onSave} disabled={isSaving}>{isSaving ? "Menyimpan..." : "Simpan Sesi"}</button>}
        </div>
      </section>
    </div>
  );
}

function WizardSteps({ activeStep, onStepSelect }: { activeStep: Step; onStepSelect: (step: Step) => void }) {
  return (
    <div className="wizard-steps">
      {["Detail sesi", "Expense awal", "Peserta", "Review"].map((label, index) => (
        <button className={activeStep === index + 1 ? "active" : ""} key={label} type="button" onClick={() => onStepSelect((index + 1) as Step)}><span>{index + 1}</span><p>{label}</p></button>
      ))}
    </div>
  );
}

function InitialExpenseEditor({ accountOptions, courtExpense, expenses, onChange, session }: { accountOptions: Array<[string, string]>; courtExpense: number; expenses: ExpenseDraft[]; onChange: (expenses: ExpenseDraft[]) => void; session: SessionDraft }) {
  function updateExpense(id: string, patch: Partial<ExpenseDraft>) {
    onChange(expenses.map((row) => row.id === id ? { ...row, ...patch } : row));
  }

  function removeExpense(id: string) {
    onChange(expenses.filter((row) => row.id !== id));
  }

  return (
    <div className="expense-step">
      <div className="court-expense-note"><div><p className="eyebrow">Auto expense court</p><h3>{session.courtFree ? "Lapangan free" : formatCurrency(courtExpense)}</h3><p>{session.courtFree ? "Tidak ada expense court otomatis." : "Akan dibuat sebagai expense kategori Court untuk sesi ini."}</p></div></div>
      <div className="expense-list">
        {expenses.map((expense) => (
          <div className="expense-row" key={expense.id}>
            <Select options={expenseCategories} value={expense.category} onChange={(value) => updateExpense(expense.id, { category: value })} />
            <input value={expense.description} onChange={(event) => updateExpense(expense.id, { description: event.target.value })} placeholder="Keterangan expense" />
            <MoneyInput value={expense.amount} onValueChange={(value) => updateExpense(expense.id, { amount: value })} placeholder="Nominal" />
            <Select options={accountOptions} value={expense.accountId} onChange={(value) => updateExpense(expense.id, { accountId: value })} />
            <input value={expense.notes} onChange={(event) => updateExpense(expense.id, { notes: event.target.value })} placeholder="Catatan" />
            <button className="table-button" type="button" onClick={() => removeExpense(expense.id)}>Hapus</button>
          </div>
        ))}
      </div>
      <button className="secondary-button" type="button" onClick={() => onChange([...expenses, makeExpense("Biaya Compliment", "", accountOptions[0]?.[0] ?? "")])}>Add Expense</button>
    </div>
  );
}

function BulkParticipantsTable({ accountOptions, defaultSlotPrice, onDetail, onRowsChange, rows }: { accountOptions: Array<[string, string]>; defaultSlotPrice: string; onDetail: (id: string) => void; onRowsChange: (rows: ParticipantDraft[]) => void; rows: ParticipantDraft[] }) {
  const [customCount, setCustomCount] = useState("2");
  const firstAccountId = accountOptions[0]?.[0] ?? "";
  const summary = participantSummary(rows);

  function updateRow(id: string, patch: Partial<ParticipantDraft>) {
    onRowsChange(rows.map((row) => {
      if (row.id !== id) return row;
      const next = { ...row, ...patch };
      if (patch.status === "Free") {
        next.discount = next.slotPrice || defaultSlotPrice || "0";
        next.method = "";
        next.accountId = "";
      }
      if (patch.status === "Belum") {
        next.method = "";
        next.accountId = "";
      }
      if (patch.status === "Lunas") {
        next.method = next.method || "Transfer";
        next.accountId = next.accountId || firstAccountId;
      }
      if (patch.slotPrice !== undefined && next.status === "Free") next.discount = patch.slotPrice || "0";
      return next;
    }));
  }

  function addRows(count: number) {
    onRowsChange([...rows, ...makeParticipants(count, defaultSlotPrice, firstAccountId)]);
  }

  function removeRow(id: string) {
    const nextRows = rows.filter((row) => row.id !== id);
    onRowsChange(nextRows.length ? nextRows : makeParticipants(1, defaultSlotPrice, firstAccountId));
  }

  return (
    <div className="participant-step">
      <div className="participant-summary">
        <MiniStat label="Peserta" value={String(summary.count)} />
        <MiniStat label="Collected" value={formatCurrency(summary.collected)} />
        <MiniStat label="Outstanding" value={formatCurrency(summary.outstanding)} tone={summary.outstanding > 0 ? "bad" : undefined} />
        <MiniStat label="Discount" value={formatCurrency(summary.discount)} />
      </div>
      <div className="participant-table-wrap">
        <table className="participant-table">
          <thead><tr><th>Username</th><th>Harga</th><th>Diskon</th><th>Total</th><th>Status</th><th>Metode</th><th>Akun</th><th>Catatan</th><th>Detail</th><th>Hapus</th></tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td><input value={row.username} onChange={(event) => updateRow(row.id, { username: event.target.value })} placeholder="username" /></td>
                <td><MoneyInput value={row.slotPrice} onValueChange={(value) => updateRow(row.id, { slotPrice: value })} /></td>
                <td><MoneyInput value={row.discount} onValueChange={(value) => updateRow(row.id, { discount: value })} disabled={row.status === "Free"} /></td>
                <td><strong>{formatCurrency(participantTotal(row))}</strong></td>
                <td><Select options={paymentStatuses} value={row.status} onChange={(value) => updateRow(row.id, { status: value })} /></td>
                <td><Select options={[["", "-"], ...paymentMethods.map((method) => [method, method] as const)]} value={row.method} onChange={(value) => updateRow(row.id, { method: value })} /></td>
                <td><Select options={[["", "-"], ...accountOptions]} value={row.accountId} onChange={(value) => updateRow(row.id, { accountId: value })} /></td>
                <td><input value={row.notes} onChange={(event) => updateRow(row.id, { notes: event.target.value })} placeholder="Diskon, utang, free..." /></td>
                <td><button className="table-button" type="button" onClick={() => onDetail(row.id)}>Detail</button></td>
                <td><button className="table-button" type="button" onClick={() => removeRow(row.id)}>Hapus</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="participant-add-row">
        <button type="button" className="secondary-button" onClick={() => addRows(1)}>Add Participant</button>
        <button type="button" className="text-button" onClick={() => addRows(1)}>+1</button>
        <button type="button" className="text-button" onClick={() => addRows(8)}>+8</button>
        <div className="custom-add"><input type="number" min={1} value={customCount} onChange={(event) => setCustomCount(event.target.value)} aria-label="Jumlah custom peserta" /><button type="button" className="text-button" onClick={() => addRows(Math.max(1, money(customCount)))}>+ Custom</button></div>
      </div>
    </div>
  );
}

function ParticipantDetailModal({ participant, onChange, onClose }: { participant: ParticipantDraft | null; onChange: (participant: ParticipantDraft) => void; onClose: () => void }) {
  if (!participant) return null;

  return (
    <div className="modal-backdrop nested-modal" role="presentation" onClick={onClose}>
      <section className="modal-panel detail-panel" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head"><div><p className="eyebrow">Detail peserta</p><h2>{participant.username || "Peserta baru"}</h2></div><button className="icon-button" onClick={onClose} aria-label="Tutup detail">X</button></div>
        <div className="wizard-grid">
          <label>Username<input value={participant.username} onChange={(event) => onChange({ ...participant, username: event.target.value })} /></label>
          <label>ID Reclub<input value={participant.idReclub} onChange={(event) => onChange({ ...participant, idReclub: event.target.value })} /></label>
          <label>Instagram<input value={participant.instagram} onChange={(event) => onChange({ ...participant, instagram: event.target.value })} /></label>
          <label>WhatsApp<input value={participant.whatsapp} onChange={(event) => onChange({ ...participant, whatsapp: event.target.value })} /></label>
          <label className="wide-field">Catatan peserta<textarea value={participant.notes} onChange={(event) => onChange({ ...participant, notes: event.target.value })} /></label>
        </div>
        <div className="wizard-actions"><button onClick={onClose}>Selesai</button></div>
      </section>
    </div>
  );
}

function SessionEditModal({
  accountOptions,
  expenses,
  isSaving,
  onClose,
  onDelete,
  onDeleteTransaction,
  onExpenseCreate,
  onExpenseSave,
  onNewParticipantsSave,
  onParticipantSave,
  onProfitSharingCreate,
  onProfitSharingSave,
  onSave,
  payments,
  profitSharings,
  session,
}: {
  accountOptions: Array<[string, string]>;
  expenses: Expense[];
  isSaving: boolean;
  onClose: () => void;
  onDelete: (id: string, code: string) => void;
  onDeleteTransaction: (type: "participantPayment" | "expense" | "profitSharing", id: string, label: string) => void;
  onExpenseCreate: (event: FormEvent<HTMLFormElement>) => void;
  onExpenseSave: (event: FormEvent<HTMLFormElement>, id: string) => void;
  onNewParticipantsSave: (session: Session, rows: ParticipantDraft[]) => Promise<number>;
  onParticipantSave: (event: FormEvent<HTMLFormElement>, id: string) => void;
  onProfitSharingCreate: (event: FormEvent<HTMLFormElement>) => void;
  onProfitSharingSave: (event: FormEvent<HTMLFormElement>, id: string) => void;
  onSave: (event: FormEvent<HTMLFormElement>, type: "session") => void;
  payments: ParticipantPayment[];
  profitSharings: ProfitSharing[];
  session: Session;
}) {
  const [activeStep, setActiveStep] = useState<Step>(1);
  const firstAccountId = accountOptions[0]?.[0] ?? "";
  const [addingParticipants, setAddingParticipants] = useState(false);
  const [addingExpense, setAddingExpense] = useState(false);
  const [newProfitSharingType, setNewProfitSharingType] = useState<(typeof profitSharingCalculationTypes)[number]>("fixed");
  const [newParticipants, setNewParticipants] = useState<ParticipantDraft[]>(() => makeParticipants(1, String(session.defaultSlotPrice ?? 0), firstAccountId));
  const [newParticipantDetailId, setNewParticipantDetailId] = useState<string | null>(null);
  const newParticipantDetail = newParticipantDetailId ? newParticipants.find((participant) => participant.id === newParticipantDetailId) ?? null : null;
  const paidTotal = payments.reduce((sum, payment) => sum + (payment.status === "Lunas" ? payment.total : 0), 0);
  const outstandingTotal = payments.reduce((sum, payment) => sum + (payment.status === "Belum" ? payment.total : 0), 0);
  const discountTotal = payments.reduce((sum, payment) => sum + (payment.status === "Free" ? payment.slotPrice : payment.discount), 0);
  const expenseTotal = expenses.reduce((sum, expense) => sum + expense.amount, 0);
  const profitSharingBase = paidTotal - expenseTotal;
  const profitSharingTotal = profitSharings.reduce((sum, sharing) => sum + sharing.amount, 0);
  const stepItems: Array<{ step: Step; label: string; helper: string }> = [
    { step: 1, label: "Detail sesi", helper: "Tanggal, venue, harga" },
    { step: 2, label: "Peserta", helper: `${payments.length} peserta` },
    { step: 3, label: "Pengeluaran", helper: `${formatCurrency(expenseTotal)} + ${formatCurrency(profitSharingTotal)}` },
    { step: 4, label: "Review", helper: "Ringkasan koreksi" },
  ];

  async function saveNewParticipants() {
    const count = await onNewParticipantsSave(session, newParticipants);
    if (!count) return;
    setAddingParticipants(false);
    setNewParticipants(makeParticipants(1, String(session.defaultSlotPrice ?? 0), firstAccountId));
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section className="modal-panel session-edit-panel" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head"><div><p className="eyebrow">Edit sesi</p><h2>{session.code}</h2></div><button className="icon-button" onClick={onClose} aria-label="Tutup edit">X</button></div>
        <div className="session-edit-layout">
          <aside className="session-edit-sidebar" aria-label="Tahap edit sesi">
            {stepItems.map((item) => (
              <button className={activeStep === item.step ? "active" : ""} key={item.step} type="button" onClick={() => setActiveStep(item.step)}>
                <span>{item.step}</span>
                <strong>{item.label}</strong>
                <small>{item.helper}</small>
              </button>
            ))}
          </aside>

          <div className="session-edit-main">
          {activeStep === 1 ? (
          <section className="session-edit-section">
            <div className="section-head compact-head"><h3>Detail sesi</h3><p>Ubah tanggal, jam, venue, harga slot, dan biaya lapangan.</p></div>
            <form onSubmit={(event) => onSave(event, "session")} className="wizard-grid">
              <input type="hidden" name="id" value={session.id} />
              <label>Tanggal<input name="date" type="date" defaultValue={session.date} required /></label>
              <label>Jam<input name="time" type="time" defaultValue={session.time ?? ""} /></label>
              <label>Kode sesi<input name="code" defaultValue={session.code} required /></label>
              <label>Venue<input name="venue" defaultValue={session.venue ?? ""} /></label>
              <label>Harga slot default<MoneyInput name="defaultSlotPrice" defaultValue={session.defaultSlotPrice} /></label>
              <label>Harga lapangan<MoneyInput name="courtPrice" defaultValue={session.courtPrice} /></label>
              <label>Akun biaya lapangan<select name="courtExpenseAccountId" defaultValue={session.courtExpenseAccountId ?? accountOptions[0]?.[0] ?? ""}>{accountOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label>Status<select name="active" defaultValue={String(session.active)}><option value="true">Aktif</option><option value="false">Nonaktif</option></select></label>
              <label className="checkbox inline-checkbox"><input name="courtFree" type="checkbox" defaultChecked={session.courtFree} /> Lapangan free</label>
              {isSaving ? <p className="inline-status wide-field">Menyimpan perubahan sesi...</p> : null}
              <div className="modal-action-row wide-field"><button type="submit" disabled={isSaving}>{isSaving ? "Menyimpan..." : "Update Sesi"}</button><button className="table-button" type="button" disabled={isSaving} onClick={() => onDelete(session.id, session.code)}>Hapus Sesi</button></div>
            </form>
          </section>
          ) : null}

          {activeStep === 2 ? (
          <section className="session-edit-section">
            <div className="section-head compact-head horizontal-head">
              <div><h3>Peserta sesi</h3><p>Koreksi username, diskon, status bayar, akun, dan catatan peserta.</p><p className="table-subtext">Harga slot sesi {formatCurrency(session.defaultSlotPrice)}. Ubah harga peserta hanya dari Detail jika ada pengecualian.</p></div>
              <button type="button" onClick={() => setAddingParticipants((value) => !value)}>{addingParticipants ? "Tutup Tambah Peserta" : "Tambah Peserta"}</button>
            </div>
            {addingParticipants ? (
              <div className="session-add-participants">
                <div className="section-head compact-head"><h3>Peserta baru</h3><p>Tambahkan slot peserta baru untuk sesi ini, lalu simpan.</p></div>
                <BulkParticipantsTable accountOptions={accountOptions} defaultSlotPrice={String(session.defaultSlotPrice ?? 0)} onDetail={setNewParticipantDetailId} onRowsChange={setNewParticipants} rows={newParticipants} />
                <div className="wizard-actions"><button className="secondary-button" type="button" onClick={() => setAddingParticipants(false)}>Batal</button><button type="button" onClick={saveNewParticipants}>Simpan Peserta Baru</button></div>
              </div>
            ) : null}
            <div className="participant-edit-list">
              <div className="participant-edit-head" aria-hidden="true"><span>Username</span><span>Status</span><span>Diskon</span><span>Akun</span><span>Total</span><span>Aksi</span></div>
              {payments.map((payment) => (
                <ParticipantPaymentEditCard
                  accountOptions={accountOptions}
                  key={`${payment.id}-${payment.updatedAt}`}
                  onDelete={() => onDeleteTransaction("participantPayment", payment.id, `peserta ${payment.playerName}`)}
                  onSave={(event) => onParticipantSave(event, payment.id)}
                  payment={payment}
                  sessionId={session.id}
                />
              ))}
              {!payments.length ? <p className="empty-note">Belum ada peserta di sesi ini.</p> : null}
            </div>
          </section>
          ) : null}

          {activeStep === 3 ? (
          <section className="session-edit-section">
            <div className="section-head compact-head horizontal-head">
              <div><h3>Pengeluaran & Bagi Hasil</h3><p>Expense operasional tetap dipisahkan dari payout bagi hasil, tetapi keduanya mengurangi saldo kas/bank.</p></div>
              <button type="button" onClick={() => setAddingExpense((value) => !value)}>{addingExpense ? "Tutup Tambah Expense" : "Tambah Expense"}</button>
            </div>
            {addingExpense ? (
              <form className="expense-create-row" onSubmit={onExpenseCreate}>
                <input type="hidden" name="sessionId" value={session.id} />
                <input name="date" type="date" defaultValue={session.date} aria-label="Tanggal expense baru" required />
                <input name="description" placeholder="Keterangan expense" required />
                <select name="category" defaultValue="Court" aria-label="Kategori expense baru">{expenseCategories.map((category) => <option key={category} value={category}>{category}</option>)}</select>
                <MoneyInput name="amount" placeholder="Nominal" ariaLabel="Nominal expense baru" required />
                <select name="accountId" defaultValue={firstAccountId} aria-label="Akun keluar expense baru" required>{accountOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
                <input name="receiptUrl" placeholder="Link bukti" />
                <input name="notes" placeholder="Catatan" />
                <label className="checkbox compact-checkbox"><input name="reimbursed" type="checkbox" /> Reimburse</label>
                <button type="submit">Simpan Expense</button>
              </form>
            ) : null}
            <div className="session-edit-table-wrap">
              <table className="session-edit-table">
                <thead><tr><th>Tanggal</th><th>Keterangan</th><th>Kategori</th><th>Nominal</th><th>Akun keluar</th><th>Link bukti</th><th>Catatan</th><th>Reimburse</th><th>Aksi</th></tr></thead>
                <tbody>
                  {expenses.map((expense) => (
                    <tr key={expense.id}>
                      <td colSpan={9}>
                        <form className="session-edit-row expense-edit-row" onSubmit={(event) => onExpenseSave(event, expense.id)}>
                          <input type="hidden" name="sessionId" value={session.id} />
                          <input name="date" type="date" defaultValue={expense.date} aria-label="Tanggal expense" required />
                          <input name="description" defaultValue={expense.description} aria-label="Keterangan expense" required />
                          <select name="category" defaultValue={expense.category} aria-label="Kategori expense">{expenseCategories.map((category) => <option key={category} value={category}>{category}</option>)}</select>
                          <MoneyInput name="amount" defaultValue={expense.amount} ariaLabel="Nominal expense" required />
                          <select name="accountId" defaultValue={expense.accountId} aria-label="Akun keluar">{accountOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
                          <input name="receiptUrl" defaultValue={expense.receiptUrl ?? ""} aria-label="Link bukti" placeholder="Link bukti" />
                          <input name="notes" defaultValue={expense.notes ?? ""} aria-label="Catatan expense" placeholder="Catatan" />
                          <label className="checkbox compact-checkbox"><input name="reimbursed" type="checkbox" defaultChecked={expense.reimbursed} /> Reimburse</label>
                          <div className="session-edit-row-actions"><button type="submit">Update</button><button className="table-button" type="button" onClick={() => onDeleteTransaction("expense", expense.id, `expense ${expense.description}`)}>Hapus</button></div>
                        </form>
                      </td>
                    </tr>
                  ))}
                  {!expenses.length ? <tr><td colSpan={9}>Belum ada expense di sesi ini.</td></tr> : null}
                </tbody>
              </table>
            </div>
            <div className="profit-sharing-section">
              <div className="section-head compact-head">
                <h3>Bagi Hasil / Payout</h3>
                <p>Dasar persen saat ini: profit sebelum bagi hasil {formatCurrency(profitSharingBase)}.</p>
              </div>
              <form className="profit-sharing-create-row" onSubmit={onProfitSharingCreate}>
                <input type="hidden" name="date" value={session.date} />
                <input type="hidden" name="sessionId" value={session.id} />
                <input type="hidden" name="baseAmount" value={profitSharingBase} />
                <input name="recipientName" placeholder="Penerima" required />
                <input name="role" placeholder="Role/alasan" defaultValue="Bagi hasil sesi" />
                <select name="calculationType" value={newProfitSharingType} onChange={(event) => setNewProfitSharingType(event.target.value as (typeof profitSharingCalculationTypes)[number])} aria-label="Tipe bagi hasil">{profitSharingCalculationTypes.map((type) => <option key={type} value={type}>{type === "percent" ? "Persen" : "Fixed"}</option>)}</select>
                {newProfitSharingType === "percent" ? (
                  <input name="percentage" type="number" min={0} max={100} step="0.01" placeholder="Persen" aria-label="Persentase" required />
                ) : (
                  <MoneyInput name="amount" placeholder="Nominal fixed" ariaLabel="Nominal fixed" required />
                )}
                <select name="accountId" defaultValue={accountOptions[0]?.[0] ?? ""} aria-label="Akun keluar" required>{accountOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
                <input name="notes" placeholder="Catatan" />
                <button type="submit">Tambah Bagi Hasil</button>
              </form>
              <div className="session-edit-table-wrap">
                <table className="session-edit-table profit-sharing-table">
                  <thead><tr><th>Penerima</th><th>Role</th><th>Tipe</th><th>Nilai</th><th>Base</th><th>Nominal</th><th>Akun</th><th>Catatan</th><th>Aksi</th></tr></thead>
                  <tbody>
                    {profitSharings.map((sharing) => (
                      <tr key={sharing.id}>
                        <td colSpan={9}>
                          <ProfitSharingEditForm
                            accountOptions={accountOptions}
                            baseAmount={profitSharingBase}
                            onDelete={() => onDeleteTransaction("profitSharing", sharing.id, `bagi hasil ${sharing.recipientName}`)}
                            onSave={(event) => onProfitSharingSave(event, sharing.id)}
                            sessionId={session.id}
                            sharing={sharing}
                          />
                        </td>
                      </tr>
                    ))}
                    {!profitSharings.length ? <tr><td colSpan={9}>Belum ada bagi hasil di sesi ini.</td></tr> : null}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
          ) : null}

          {activeStep === 4 ? (
          <section className="session-edit-section">
            <div className="section-head compact-head"><h3>Review sesi</h3><p>Cek ringkasan sebelum menutup modal edit.</p></div>
            <div className="review-grid">
              <ReviewItem label="Peserta" value={`${payments.length} slot`} helper={`${payments.filter((payment) => payment.status === "Free").length} free`} />
              <ReviewItem label="Collected" value={formatCurrency(paidTotal)} helper="Pembayaran lunas" />
              <ReviewItem label="Outstanding" value={formatCurrency(outstandingTotal)} helper="Status belum bayar" />
              <ReviewItem label="Discount" value={formatCurrency(discountTotal)} helper="Diskon dan free" />
              <ReviewItem label="Expense operasional" value={formatCurrency(expenseTotal)} helper={`${expenses.length} expense`} />
              <ReviewItem label="Profit sebelum bagi hasil" value={formatCurrency(profitSharingBase)} helper="Collected dikurangi expense" />
              <ReviewItem label="Bagi hasil" value={formatCurrency(profitSharingTotal)} helper={`${profitSharings.length} payout`} />
              <ReviewItem label="Profit bersih" value={formatCurrency(profitSharingBase - profitSharingTotal)} helper="Profit setelah payout" />
            </div>
            <div className="wizard-actions"><button className="secondary-button" type="button" onClick={() => setActiveStep(1)}>Cek Detail</button><button className="secondary-button" type="button" onClick={() => setActiveStep(2)}>Cek Peserta</button><button type="button" onClick={onClose}>Selesai</button></div>
          </section>
          ) : null}
          </div>
        </div>
        {newParticipantDetail ? <ParticipantDetailModal participant={newParticipantDetail} onChange={(next) => setNewParticipants((rows) => rows.map((row) => row.id === next.id ? next : row))} onClose={() => setNewParticipantDetailId(null)} /> : null}
      </section>
    </div>
  );
}

function ParticipantPaymentEditCard({
  accountOptions,
  onDelete,
  onSave,
  payment,
  sessionId,
}: {
  accountOptions: Array<[string, string]>;
  onDelete: () => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
  payment: ParticipantPayment;
  sessionId: string;
}) {
  const firstAccountId = accountOptions[0]?.[0] ?? "";
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState<ParticipantPayment["status"]>(payment.status);
  const [slotPrice, setSlotPrice] = useState(String(payment.slotPrice));
  const [discount, setDiscount] = useState(String(payment.discount));
  const [accountId, setAccountId] = useState(payment.accountId ?? "");

  function changeStatus(nextStatus: ParticipantPayment["status"]) {
    setStatus(nextStatus);
    if (nextStatus === "Free") {
      setDiscount(slotPrice);
      setAccountId("");
      return;
    }
    if (nextStatus === "Belum") {
      if (status === "Free") setDiscount("0");
      setAccountId("");
      return;
    }
    if (!accountId) setAccountId(firstAccountId);
    if (status === "Free") setDiscount("0");
  }

  function changeSlotPrice(value: string) {
    setSlotPrice(value);
    if (status === "Free") setDiscount(value);
  }

  const effectiveDiscount = status === "Free" ? slotPrice : discount;
  const previewTotal = status === "Free" ? 0 : Math.max(0, money(slotPrice) - money(effectiveDiscount));
  const accountDisabled = status !== "Lunas";

  return (
    <form className="participant-edit-card" onSubmit={onSave}>
      <input type="hidden" name="date" value={payment.date} />
      <input type="hidden" name="sessionId" value={sessionId} />
      {!expanded ? (
        <>
          <input type="hidden" name="category" value={payment.category} />
          <input type="hidden" name="rueclubName" value={payment.rueclubName ?? ""} />
          <input type="hidden" name="instagram" value={payment.instagram ?? ""} />
          <input type="hidden" name="whatsapp" value={payment.whatsapp ?? ""} />
          <input type="hidden" name="method" value={payment.method ?? "Transfer"} />
          <input type="hidden" name="notes" value={payment.notes ?? ""} />
          <input type="hidden" name="slotPrice" value={slotPrice} />
        </>
      ) : null}

      <div className="participant-edit-main">
        <input name="playerName" defaultValue={payment.playerName} aria-label="Username" required />
        <select name="status" value={status} onChange={(event) => changeStatus(event.target.value as ParticipantPayment["status"])} aria-label="Status bayar">
          {paymentStatuses.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        {status === "Free" ? (
          <input value={formatMoneyInput(slotPrice)} aria-label="Diskon" disabled />
        ) : (
          <MoneyInput name="discount" value={discount} onValueChange={setDiscount} ariaLabel="Diskon" />
        )}
        <select name="accountId" value={accountDisabled ? "" : accountId} onChange={(event) => setAccountId(event.target.value)} aria-label="Akun masuk" disabled={accountDisabled} required={!accountDisabled}>
          <option value="">Tanpa akun</option>
          {accountOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <strong className={previewTotal > 0 ? "participant-total-pill good" : "participant-total-pill"}>{formatCurrency(previewTotal)}</strong>
        <div className="participant-edit-actions">
          <button className="secondary-button" type="button" onClick={() => setExpanded((value) => !value)}>{expanded ? "Tutup" : "Detail"}</button>
          <button type="submit">Update</button>
          <button className="table-button" type="button" onClick={onDelete}>Hapus</button>
        </div>
      </div>

      {expanded ? (
        <div className="participant-edit-detail">
          <label>Kategori<select name="category" defaultValue={payment.category}>{paymentCategories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
          <label>Override harga slot<MoneyInput name="slotPrice" value={slotPrice} onValueChange={changeSlotPrice} ariaLabel="Override harga slot" required /></label>
          <label>ID Reclub<input name="rueclubName" defaultValue={payment.rueclubName ?? ""} placeholder="ID Reclub" /></label>
          <label>Instagram<input name="instagram" defaultValue={payment.instagram ?? ""} placeholder="Instagram" /></label>
          <label>WhatsApp<input name="whatsapp" defaultValue={payment.whatsapp ?? ""} placeholder="WhatsApp" /></label>
          <label>Metode<select name="method" defaultValue={payment.method ?? "Transfer"} disabled={status !== "Lunas"}>{paymentMethods.map((method) => <option key={method} value={method}>{method}</option>)}</select></label>
          <label className="participant-notes-field">Catatan<input name="notes" defaultValue={payment.notes ?? ""} placeholder="Diskon, utang, free..." /></label>
        </div>
      ) : null}
    </form>
  );
}

function ProfitSharingEditForm({
  accountOptions,
  baseAmount,
  onDelete,
  onSave,
  sessionId,
  sharing,
}: {
  accountOptions: Array<[string, string]>;
  baseAmount: number;
  onDelete: () => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
  sessionId: string;
  sharing: ProfitSharing;
}) {
  const [calculationType, setCalculationType] = useState<(typeof profitSharingCalculationTypes)[number]>(sharing.calculationType);
  const [percentage, setPercentage] = useState(String(sharing.percentage ?? ""));
  const previewAmount = calculationType === "percent"
    ? profitSharingAmount(calculationType, percentage, sharing.amount, baseAmount)
    : sharing.amount;

  return (
    <form className="session-edit-row profit-sharing-edit-row" onSubmit={onSave}>
      <input type="hidden" name="date" value={sharing.date} />
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="baseAmount" value={baseAmount} />
      <input name="recipientName" defaultValue={sharing.recipientName} aria-label="Penerima" required />
      <input name="role" defaultValue={sharing.role ?? ""} aria-label="Role" placeholder="Role/alasan" />
      <select name="calculationType" value={calculationType} onChange={(event) => setCalculationType(event.target.value as (typeof profitSharingCalculationTypes)[number])} aria-label="Tipe bagi hasil">
        {profitSharingCalculationTypes.map((type) => <option key={type} value={type}>{type === "percent" ? "Persen" : "Fixed"}</option>)}
      </select>
      {calculationType === "percent" ? (
        <input name="percentage" type="number" min={0} max={100} step="0.01" value={percentage} onChange={(event) => setPercentage(event.target.value)} aria-label="Persentase" placeholder="Persen" required />
      ) : (
        <MoneyInput name="amount" defaultValue={sharing.amount} ariaLabel="Nominal bagi hasil" required />
      )}
      <input value={formatCurrency(baseAmount)} aria-label="Base bagi hasil" readOnly />
      <input value={formatCurrency(previewAmount)} aria-label="Preview nominal bagi hasil" readOnly />
      <select name="accountId" defaultValue={sharing.accountId} aria-label="Akun keluar">{accountOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <input name="notes" defaultValue={sharing.notes ?? ""} aria-label="Catatan" placeholder="Catatan" />
      <div className="session-edit-row-actions"><button type="submit">Update</button><button className="table-button" type="button" onClick={onDelete}>Hapus</button></div>
    </form>
  );
}

function ParticipantAppendModal({ accountOptions, onClose, onDetail, onParticipantsChange, onSave, participants, session }: { accountOptions: Array<[string, string]>; onClose: () => void; onDetail: (id: string) => void; onParticipantsChange: (participants: ParticipantDraft[]) => void; onSave: () => void; participants: ParticipantDraft[]; session: Session }) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section className="modal-panel wizard-panel" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head"><div><p className="eyebrow">Tambah peserta</p><h2>{session.code}</h2><p className="muted">Harga default {formatCurrency(session.defaultSlotPrice)}.</p></div><button className="icon-button" onClick={onClose} aria-label="Tutup peserta">X</button></div>
        <BulkParticipantsTable accountOptions={accountOptions} defaultSlotPrice={String(session.defaultSlotPrice ?? 0)} onDetail={onDetail} onRowsChange={onParticipantsChange} rows={participants} />
        <div className="wizard-actions"><button className="secondary-button" type="button" onClick={onClose}>Batal</button><button type="button" onClick={onSave}>Simpan Peserta</button></div>
      </section>
    </div>
  );
}

function ManualAdminForms({ accounts, accountOptions, onDeleteAccount, onSaveMaster, onSaveTransaction, savingTransactionType, sessionOptions, today }: { accounts: Account[]; accountOptions: Array<[string, string]>; onDeleteAccount: (id: string, name: string) => void; onSaveMaster: (event: FormEvent<HTMLFormElement>, type: "account" | "session") => void; onSaveTransaction: (event: FormEvent<HTMLFormElement>, type: "expense" | "capitalDeposit") => void; savingTransactionType: "expense" | "capitalDeposit" | null; sessionOptions: Array<[string, string]>; today: string }) {
  return (
    <div className="manual-admin-grid">
      <FormPanel title="Tambah Modal">
        <p className="form-help">Gunakan ini untuk mencatat modal masuk ke rekening/kas RueClub. Ini akan menambah saldo akun tujuan.</p>
        <form onSubmit={(event) => onSaveTransaction(event, "capitalDeposit")} className="form-grid">
          <input name="date" type="date" defaultValue={today} required />
          <input name="description" placeholder="Keterangan" defaultValue="Modal titipan" required />
          <Select name="sessionId" options={[["", "Tanpa sesi"], ...sessionOptions]} />
          <MoneyInput name="amount" placeholder="Nominal modal" required />
          <Select name="accountId" options={accountOptions} required />
          <label className="checkbox"><input name="sharingInvest" type="checkbox" /> Sharing invest</label>
          {savingTransactionType === "capitalDeposit" ? <p className="inline-status">Menyimpan modal...</p> : null}
          <button type="submit" disabled={savingTransactionType !== null}>
            {savingTransactionType === "capitalDeposit" ? "Menyimpan..." : "Simpan Modal"}
          </button>
        </form>
      </FormPanel>

      <FormPanel title="Tambah Akun">
        <p className="form-help">Akun adalah rekening/dompet seperti BCA, Jago, atau Cash. Bukan untuk mencatat modal masuk.</p>
        <form onSubmit={(event) => onSaveMaster(event, "account")} className="form-grid">
          <input name="name" placeholder="Nama akun" required />
          <select name="accountType" defaultValue="bank"><option value="bank">Bank</option><option value="cash">Cash</option><option value="other">Other</option></select>
          <MoneyInput name="openingBalance" placeholder="Saldo awal" defaultValue={0} />
          <button type="submit">Simpan Akun</button>
        </form>
        <div className="account-delete-list">
          {accounts.map((account) => (
            <div className="account-delete-row" key={account.id}>
              <span>{account.name}</span>
              <button className="table-button" type="button" onClick={() => onDeleteAccount(account.id, account.name)}>Hapus</button>
            </div>
          ))}
        </div>
      </FormPanel>

      <FormPanel title="Expense Manual">
        <form onSubmit={(event) => onSaveTransaction(event, "expense")} className="form-grid">
          <input name="date" type="date" defaultValue={today} required />
          <input name="description" placeholder="Keterangan" required />
          <Select name="category" options={expenseCategories} />
          <Select name="sessionId" options={[["", "Tanpa sesi"], ...sessionOptions]} />
          <MoneyInput name="amount" placeholder="Nominal" required />
          <Select name="accountId" options={accountOptions} required />
          <input name="receiptUrl" placeholder="Link bukti (opsional)" />
          <label className="checkbox"><input name="reimbursed" type="checkbox" /> Reimburse</label>
          <textarea name="notes" placeholder="Catatan" />
          {savingTransactionType === "expense" ? <p className="inline-status">Menyimpan expense...</p> : null}
          <button type="submit" disabled={savingTransactionType !== null}>
            {savingTransactionType === "expense" ? "Menyimpan..." : "Simpan Expense"}
          </button>
        </form>
      </FormPanel>
    </div>
  );
}

function AiPanel({ aiInput, draft, isPending, onAiInput, onDraftChange, onDraftCreate, onDraftSave, today }: { aiInput: string; draft: AiDraft | null; isPending: boolean; onAiInput: (value: string) => void; onDraftChange: (draft: AiDraft) => void; onDraftCreate: () => void; onDraftSave: () => void; today: string }) {
  return (
    <section className="ai-panel" id="ai">
      <div className="section-head"><h2>AI Quick Entry</h2><p>Ketik kalimat bebas. AI hanya membuat draft, kamu tetap konfirmasi sebelum simpan.</p></div>
      <textarea value={aiInput} onChange={(event) => onAiInput(event.target.value)} placeholder="masukan modal sebesar 1 juta yang bersumber dari bank bca nura" />
      <button onClick={onDraftCreate} disabled={isPending || !aiInput.trim()}>{isPending ? "Membaca..." : "Buat Draft"}</button>
      {draft ? (
        <div className="draft-grid">
          <Select label="Intent" value={draft.intent} options={[["capitalDeposit", "Modal Titipan"], ["expense", "Expense"], ["participantPayment", "Pemasukan Peserta"]]} onChange={(value) => onDraftChange({ ...draft, intent: value as AiDraft["intent"] })} />
          <TextEdit label="Tanggal" value={draft.date ?? today} onChange={(value) => onDraftChange({ ...draft, date: value })} />
          <label>Nominal<MoneyInput value={draft.amount ?? ""} onValueChange={(value) => onDraftChange({ ...draft, amount: money(value) })} /></label>
          <TextEdit label="Akun" value={draft.accountName ?? ""} onChange={(value) => onDraftChange({ ...draft, accountName: value })} />
          <TextEdit label="Sesi" value={draft.sessionCode ?? ""} onChange={(value) => onDraftChange({ ...draft, sessionCode: value })} />
          <TextEdit label="Username" value={draft.playerName ?? ""} onChange={(value) => onDraftChange({ ...draft, playerName: value })} />
          <TextEdit label="Kategori" value={draft.category ?? ""} onChange={(value) => onDraftChange({ ...draft, category: value })} />
          <TextEdit label="Deskripsi" value={draft.description ?? ""} onChange={(value) => onDraftChange({ ...draft, description: value })} />
          <p className="draft-note">Confidence {Math.round(draft.confidence * 100)}%{draft.missingFields.length ? ` - Lengkapi: ${draft.missingFields.join(", ")}` : ""}</p>
          <button onClick={onDraftSave} disabled={draft.confidence < 0.6}>Simpan Draft</button>
        </div>
      ) : null}
    </section>
  );
}

function ReportsPanel({ dateFormat, report }: { dateFormat: DateFormat; report: DashboardReport }) {
  return (
    <section className="panel" id="reports">
      <div className="section-head"><h2>Profit per Sesi</h2><p>Income, cost, dan profit dihitung dari transaksi aktif.</p></div>
      <table><thead><tr><th>Sesi</th><th>Tanggal</th><th>Slot</th><th>Net Income</th><th>Expense</th><th>Profit sebelum bagi hasil</th><th>Bagi Hasil</th><th>Profit Bersih</th></tr></thead><tbody>{report.sessionReports.map((row) => <tr key={row.sessionId}><td>{row.code}</td><td>{formatDisplayDate(row.date, dateFormat)}</td><td>{row.slotSold}</td><td>{formatCurrency(row.netIncome)}</td><td>{formatCurrency(row.costOfService)}</td><td>{formatCurrency(row.profitBeforeSharing)}</td><td>{formatCurrency(row.profitSharing)}</td><td>{formatCurrency(row.profit)}</td></tr>)}</tbody></table>
    </section>
  );
}

function SettingsPanel({
  colorMode,
  dateFormat,
  onColorModeChange,
  onDateFormatChange,
  onTimeFormatChange,
  timeFormat,
}: {
  colorMode: ColorMode;
  dateFormat: DateFormat;
  onColorModeChange: (mode: ColorMode) => void;
  onDateFormatChange: (format: DateFormat) => void;
  onTimeFormatChange: (format: TimeFormat) => void;
  timeFormat: TimeFormat;
}) {
  return (
    <section className="panel settings-panel" id="settings">
      <div className="section-head"><h2>Preferensi aplikasi</h2><p>Pengaturan ini tersimpan di browser perangkat ini.</p></div>
      <div className="settings-grid">
        <div className="setting-row">
          <div><h3>Format jam</h3><p>Pilih tampilan jam untuk sesi dan ringkasan sesi.</p></div>
          <div className="segmented-control" role="group" aria-label="Format jam">
            <button className={timeFormat === "12h" ? "active" : ""} type="button" aria-pressed={timeFormat === "12h"} onClick={() => onTimeFormatChange("12h")}>12H</button>
            <button className={timeFormat === "24h" ? "active" : ""} type="button" aria-pressed={timeFormat === "24h"} onClick={() => onTimeFormatChange("24h")}>24H</button>
          </div>
        </div>
        <div className="setting-row">
          <div><h3>Format tanggal</h3><p>Pilih urutan tanggal untuk sesi, laporan, dan riwayat transaksi.</p></div>
          <div className="segmented-control date-format-control" role="group" aria-label="Format tanggal">
            {dateFormatOptions.map(([format, label]) => (
              <button className={dateFormat === format ? "active" : ""} key={format} type="button" aria-pressed={dateFormat === format} onClick={() => onDateFormatChange(format)}>{label}</button>
            ))}
          </div>
        </div>
        <div className="setting-row">
          <div><h3>Mode tampilan</h3><p>Pilih light mode atau dark mode untuk workspace.</p></div>
          <div className="segmented-control" role="group" aria-label="Mode tampilan">
            <button className={colorMode === "light" ? "active" : ""} type="button" aria-pressed={colorMode === "light"} onClick={() => onColorModeChange("light")}>Light</button>
            <button className={colorMode === "dark" ? "active" : ""} type="button" aria-pressed={colorMode === "dark"} onClick={() => onColorModeChange("dark")}>Dark</button>
          </div>
        </div>
      </div>
    </section>
  );
}

function SessionSummaryTable({ dateFormat, report, sessions, timeFormat, onEditSession }: { dateFormat: DateFormat; report: DashboardReport; sessions: Session[]; timeFormat: TimeFormat; onEditSession: (sessionId: string) => void }) {
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  return (
    <table>
      <thead><tr><th>Sesi</th><th>Harga Slot</th><th>Slot</th><th>Expense</th><th>Profit</th><th>Aksi</th></tr></thead>
      <tbody>
        {report.sessionReports.slice(0, 5).map((row) => {
          const session = sessionsById.get(row.sessionId);
          return (
            <tr key={row.sessionId}>
              <td><strong>{row.code}</strong><span className="table-subtext">{formatSessionDateTime(row.date, session?.time, timeFormat, dateFormat)}</span></td>
              <td>{formatCurrency(session?.defaultSlotPrice ?? 0)}</td>
              <td>{row.slotSold}</td>
              <td>{formatCurrency(row.costOfService)}</td>
              <td>{formatCurrency(row.profit)}</td>
              <td><button className="table-button" type="button" onClick={() => onEditSession(row.sessionId)}>Edit Sesi</button></td>
            </tr>
          );
        })}
        {!report.sessionReports.length ? <tr><td colSpan={6}>Belum ada transaksi sesi.</td></tr> : null}
      </tbody>
    </table>
  );
}

function ExportButtons() {
  return <div className="export-row">{exportLinks.map(([type, label]) => <a className="export-link" key={type} href={`/api/export/${type}`}>{label}</a>)}</div>;
}

function BarList({ rows, empty }: { rows: Array<{ label: string; value: number; helper?: string }>; empty?: string }) {
  const max = Math.max(1, ...rows.map((row) => Math.abs(row.value)));
  if (!rows.length) return <p className="empty-note">{empty ?? "Belum ada data."}</p>;
  return <div className="bar-list">{rows.map((row) => <div className="bar-row" key={row.label}><div className="bar-label"><span>{row.label}</span><strong>{formatCurrency(row.value)}</strong></div><div className="bar-track"><span style={{ width: `${Math.max(6, (Math.abs(row.value) / max) * 100)}%` }} /></div>{row.helper ? <small>{row.helper}</small> : null}</div>)}</div>;
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return <div className="metric"><span>{label}</span><strong className={tone}>{value}</strong></div>;
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return <div className="mini-stat"><span>{label}</span><strong className={tone}>{value}</strong></div>;
}

function ReviewItem({ label, value, helper }: { label: string; value: string; helper?: string }) {
  return <div className="review-item"><span>{label}</span><strong>{value}</strong>{helper ? <small>{helper}</small> : null}</div>;
}

function FormPanel({ title, children, className = "" }: { title: string; children: ReactNode; className?: string }) {
  return <section className={`form-panel ${className}`}><h2>{title}</h2>{children}</section>;
}

function MoneyInput({
  ariaLabel,
  defaultValue,
  disabled,
  name,
  onValueChange,
  placeholder,
  required,
  value,
}: {
  ariaLabel?: string;
  defaultValue?: string | number;
  disabled?: boolean;
  name?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  value?: string | number;
}) {
  const isControlled = value !== undefined;
  const [localValue, setLocalValue] = useState(() => formatMoneyInput(value ?? defaultValue));
  const displayValue = isControlled ? formatMoneyInput(value) : localValue;

  return (
    <input
      aria-label={ariaLabel}
      autoComplete="off"
      disabled={disabled}
      inputMode="numeric"
      name={name}
      onChange={(event) => {
        const nextValue = formatMoneyInput(event.target.value);
        if (!isControlled) setLocalValue(nextValue);
        onValueChange?.(nextValue);
      }}
      placeholder={placeholder}
      required={required}
      type="text"
      value={displayValue}
    />
  );
}

function Select({ name, options, required, label, value, onChange }: { name?: string; options: readonly string[] | Array<readonly [string, string]>; required?: boolean; label?: string; value?: string; onChange?: (value: string) => void }) {
  const select = (
    <select name={name} required={required} value={value} onChange={onChange ? (event) => onChange(event.target.value) : undefined}>
      {options.map((option) => {
        const tuple = Array.isArray(option) ? option : [option, option];
        return <option key={tuple[0]} value={tuple[0]}>{tuple[1]}</option>;
      })}
    </select>
  );
  return label ? <label>{label}{select}</label> : select;
}

function TextEdit({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label>{label}<input value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function RecentTransactions({ data, dateFormat, onDelete }: { data: AppData; dateFormat: DateFormat; onDelete: (type: string, id: string) => void }) {
  const rows = [
    ...data.participantPayments.map((row) => ({ id: row.id, type: "participantPayment", date: row.date, label: `Pemasukan - ${row.playerName}`, amount: row.total })),
    ...data.expenses.map((row) => ({ id: row.id, type: "expense", date: row.date, label: `Expense - ${row.description}`, amount: -row.amount })),
    ...data.capitalDeposits.map((row) => ({ id: row.id, type: "capitalDeposit", date: row.date, label: `Modal - ${row.description}`, amount: row.amount })),
    ...data.profitSharings.map((row) => ({ id: row.id, type: "profitSharing", date: row.date, label: `Bagi hasil - ${row.recipientName}`, amount: -row.amount })),
  ].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 20);

  return (
    <table>
      <thead><tr><th>Tanggal</th><th>Transaksi</th><th>Nominal</th><th>Aksi</th></tr></thead>
      <tbody>
        {rows.map((row) => <tr key={`${row.type}-${row.id}`}><td>{formatDisplayDate(row.date, dateFormat)}</td><td>{row.label}</td><td>{formatCurrency(row.amount)}</td><td><button className="table-button" onClick={() => onDelete(row.type, row.id)}>Hapus</button></td></tr>)}
        {!rows.length ? <tr><td colSpan={4}>Belum ada transaksi.</td></tr> : null}
      </tbody>
    </table>
  );
}
