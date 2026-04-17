import { NextResponse } from "next/server";
import {
  capitalDepositInputSchema,
  expenseInputSchema,
  participantPaymentInputSchema,
  profitSharingInputSchema,
} from "@/lib/domain";
import { getSessionUser } from "@/server/auth";
import {
  createCapitalDeposit,
  createExpense,
  createParticipantPayment,
  createProfitSharing,
  deleteDocument,
  updateExpense,
  updateParticipantPayment,
  updateProfitSharing,
} from "@/server/store";

const deleteMap = {
  participantPayment: "participantPayments",
  expense: "expenses",
  capitalDeposit: "capitalDeposits",
  profitSharing: "profitSharings",
} as const;

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();

  if (body.type === "participantPayment") {
    const input = participantPaymentInputSchema.parse(body.payload);
    const row = await createParticipantPayment(input, user.id);
    return NextResponse.json({ row });
  }

  if (body.type === "expense") {
    const input = expenseInputSchema.parse(body.payload);
    const row = await createExpense(input, user.id);
    return NextResponse.json({ row });
  }

  if (body.type === "capitalDeposit") {
    const input = capitalDepositInputSchema.parse(body.payload);
    const row = await createCapitalDeposit(input, user.id);
    return NextResponse.json({ row });
  }

  if (body.type === "profitSharing") {
    const input = profitSharingInputSchema.parse(body.payload);
    const row = await createProfitSharing(input, user.id);
    return NextResponse.json({ row });
  }

  return NextResponse.json({ error: "Unsupported transaction type." }, { status: 400 });
}

export async function PUT(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  if (!body.id) {
    return NextResponse.json({ error: "Transaction id wajib diisi." }, { status: 400 });
  }

  if (body.type === "participantPayment") {
    const input = participantPaymentInputSchema.parse(body.payload);
    const row = await updateParticipantPayment(body.id, input, user.id);
    return NextResponse.json({ row });
  }

  if (body.type === "expense") {
    const input = expenseInputSchema.parse(body.payload);
    const row = await updateExpense(body.id, input, user.id);
    return NextResponse.json({ row });
  }

  if (body.type === "profitSharing") {
    const input = profitSharingInputSchema.parse(body.payload);
    const row = await updateProfitSharing(body.id, input, user.id);
    return NextResponse.json({ row });
  }

  return NextResponse.json({ error: "Unsupported transaction type." }, { status: 400 });
}

export async function DELETE(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");
  const id = searchParams.get("id");

  if (!id || !(type && type in deleteMap)) {
    return NextResponse.json({ error: "Invalid delete request." }, { status: 400 });
  }

  await deleteDocument(deleteMap[type as keyof typeof deleteMap], id);
  return NextResponse.json({ ok: true });
}
