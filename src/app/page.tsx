import { FinanceWorkspace } from "@/components/FinanceWorkspace";
import { buildDashboardReport } from "@/lib/reports";
import { requireUser } from "@/server/auth";
import { backendLabel, getAppData } from "@/server/store";

export default async function Home() {
  const user = await requireUser();
  const data = await getAppData();
  const report = buildDashboardReport(data);

  return (
    <FinanceWorkspace
      userName={user.name}
      data={data}
      report={report}
      backend={backendLabel()}
    />
  );
}

