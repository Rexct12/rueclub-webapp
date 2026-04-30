import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { parseRupiah } from "@/lib/format";
import {
  DEFAULT_SESSION_CODE_FORMAT,
  isSessionCodeFormat,
  resolveSessionCodeForUpsert,
} from "@/lib/session-code";
import { getSessionUser } from "@/server/auth";
import {
  deleteDocument,
  deleteSession,
  getAppData,
  syncSessionParticipantSlotPricesWithDefaultChange,
  upsertAccount,
  upsertCourtMemberPackage,
  upsertSession,
} from "@/server/store";

function jsonFromError(error: unknown, status = 500) {
  if (error instanceof ZodError) {
    const message = error.issues.map((issue) => issue.message).join("; ") || "Validasi gagal.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
  if (error instanceof Error) {
    return NextResponse.json({ error: error.message }, { status });
  }
  return NextResponse.json({ error: "Gagal memproses permintaan." }, { status: 500 });
}

export async function POST(request: Request) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();

    if (body.type === "account") {
      const account = await upsertAccount({
        name: body.name,
        type: body.accountType ?? "bank",
        openingBalance: parseRupiah(body.openingBalance),
        active: true,
      });
      return NextResponse.json({ account });
    }

    if (body.type === "session") {
      const data = await getAppData();
      const previousSession = body.id
        ? data.sessions.find((session) => session.id === String(body.id))
        : undefined;
      const sessionCodeFormat = isSessionCodeFormat(body.sessionCodeFormat)
        ? body.sessionCodeFormat
        : DEFAULT_SESSION_CODE_FORMAT;
      let code: string;
      try {
        code = resolveSessionCodeForUpsert({
          seed: {
            date: String(body.date ?? ""),
            venue: String(body.venue ?? ""),
            code: String(body.code ?? "").trim(),
          },
          format: sessionCodeFormat,
          sessions: data.sessions,
          requestedCode: body.code,
          sessionId: body.id ? String(body.id) : undefined,
        });
      } catch (error) {
        return jsonFromError(error, 409);
      }

      const session = await upsertSession({
        id: body.id,
        date: body.date,
        time: body.time,
        code,
        venue: body.venue,
        defaultSlotPrice: parseRupiah(body.defaultSlotPrice),
        courtPrice: parseRupiah(body.courtPrice),
        courtFree: Boolean(body.courtFree),
        courtExpenseAccountId: body.courtExpenseAccountId,
        courtMemberPackageId: body.courtMemberPackageId,
        totalDurationHours: Number(body.totalDurationHours ?? body.memberUsageHours ?? 1),
        memberUsageHours: Number(body.memberUsageHours ?? 0),
        active: body.active ?? true,
      }, user.id);

      const syncedParticipantCount = previousSession
        ? await syncSessionParticipantSlotPricesWithDefaultChange(
          session.id,
          previousSession.defaultSlotPrice,
          session.defaultSlotPrice,
          user.id,
        )
        : 0;

      return NextResponse.json({ session, syncedParticipantCount });
    }

    if (body.type === "courtMemberPackage") {
      const row = await upsertCourtMemberPackage({
        id: body.id,
        purchaseDate: body.purchaseDate,
        name: body.name,
        venue: body.venue,
        totalHours: Number(body.totalHours ?? 0),
        totalAmount: parseRupiah(body.totalAmount),
        expenseAccountId: body.expenseAccountId,
        notes: body.notes,
        active: body.active ?? true,
      }, user.id);
      return NextResponse.json({ row });
    }

    return NextResponse.json({ error: "Unsupported master data type." }, { status: 400 });
  } catch (error) {
    console.error("[api/master POST]", error);
    return jsonFromError(error);
  }
}

export async function DELETE(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "Invalid master data delete request." }, { status: 400 });
  }

  if (type === "session") {
    await deleteSession(id);
    return NextResponse.json({ ok: true });
  }

  if (type === "account") {
    const data = await getAppData();
    const accountInUse =
      data.participantPayments.some((payment) => payment.accountId === id) ||
      data.expenses.some((expense) => expense.accountId === id) ||
      data.capitalDeposits.some((deposit) => deposit.accountId === id) ||
      data.sessions.some((session) => session.courtExpenseAccountId === id) ||
      data.courtMemberPackages.some((pkg) => pkg.expenseAccountId === id);

    if (accountInUse) {
      return NextResponse.json(
        { error: "Akun sudah dipakai transaksi atau sesi, jadi tidak bisa dihapus." },
        { status: 409 },
      );
    }

    await deleteDocument("accounts", id);
    return NextResponse.json({ ok: true });
  }

  if (type === "courtMemberPackage") {
    const data = await getAppData();
    const packageInUse = data.sessions.some((session) => session.courtMemberPackageId === id);
    if (packageInUse) {
      return NextResponse.json(
        { error: "Paket member sudah dipakai di sesi, jadi tidak bisa dihapus." },
        { status: 409 },
      );
    }
    await deleteDocument("courtMemberPackages", id);
    await deleteDocument("expenses", `court-member-purchase-${id}`);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Invalid master data delete request." }, { status: 400 });
}
