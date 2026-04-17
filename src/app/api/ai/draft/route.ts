import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth";
import { draftQuickEntry } from "@/server/ai";
import { getAppData } from "@/server/store";

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as { input?: string };
  if (!body.input) {
    return NextResponse.json({ error: "Input wajib diisi." }, { status: 400 });
  }

  const data = await getAppData();
  const draft = await draftQuickEntry(body.input, data);
  return NextResponse.json({ draft });
}

