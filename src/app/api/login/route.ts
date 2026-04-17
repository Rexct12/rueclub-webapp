import { NextResponse } from "next/server";
import { createSession, verifyLogin } from "@/server/auth";

export async function POST(request: Request) {
  const body = (await request.json()) as { name?: string; pin?: string };

  if (!body.name || !body.pin) {
    return NextResponse.json({ error: "Nama dan PIN wajib diisi." }, { status: 400 });
  }

  const user = await verifyLogin(body.name, body.pin);
  if (!user) {
    return NextResponse.json({ error: "Nama atau PIN tidak valid." }, { status: 401 });
  }

  await createSession({ id: user.id, name: user.name, role: user.role });
  return NextResponse.json({ ok: true });
}

