import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { parseRupiah } from "@/lib/format";
import { getSessionUser } from "@/server/auth";
import { deleteDocument, deleteSession, getAppData, upsertAccount, upsertSession } from "@/server/store";

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
      const session = await upsertSession({
        id: body.id,
        date: body.date,
        time: body.time,
        code: body.code,
        venue: body.venue,
        defaultSlotPrice: parseRupiah(body.defaultSlotPrice),
        courtPrice: parseRupiah(body.courtPrice),
        courtFree: Boolean(body.courtFree),
        courtExpenseAccountId: body.courtExpenseAccountId,
        active: body.active ?? true,
      }, user.id);
      return NextResponse.json({ session });
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
      data.sessions.some((session) => session.courtExpenseAccountId === id);

    if (accountInUse) {
      return NextResponse.json(
        { error: "Akun sudah dipakai transaksi atau sesi, jadi tidak bisa dihapus." },
        { status: 409 },
      );
    }

    await deleteDocument("accounts", id);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Invalid master data delete request." }, { status: 400 });
}
