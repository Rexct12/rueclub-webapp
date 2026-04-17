import { NextResponse } from "next/server";
import { exportCollectionCsv } from "@/lib/csv";
import { getSessionUser } from "@/server/auth";
import { getAppData } from "@/server/store";

export async function GET(
  _request: Request,
  context: { params: Promise<{ type: string }> },
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { type } = await context.params;
  const data = await getAppData();
  const csv = exportCollectionCsv(type, data);

  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="rueclub-${type}.csv"`,
    },
  });
}

