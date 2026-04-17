import { readFile } from "node:fs/promises";
import {
  mapCapitalRow,
  mapExpenseRow,
  mapParticipantRow,
  parseCsv,
} from "../src/lib/importers";
import {
  createCapitalDeposit,
  createExpense,
  createParticipantPayment,
  getAppData,
} from "../src/server/store";

type Args = {
  participants?: string;
  expenses?: string;
  capital?: string;
};

function parseArgs() {
  const args: Args = {};
  const tokens = process.argv.slice(2);

  for (let index = 0; index < tokens.length; index += 2) {
    const key = tokens[index]?.replace(/^--/, "") as keyof Args;
    const value = tokens[index + 1];
    if (key && value && key in { participants: true, expenses: true, capital: true }) {
      args[key] = value;
    }
  }

  return args;
}

async function importFile(path: string, mapper: (row: Record<string, string | undefined>) => unknown) {
  const content = await readFile(path, "utf8");
  const rows = parseCsv(content);
  return rows.map(mapper);
}

async function main() {
  const args = parseArgs();
  const data = await getAppData();
  const context = { accounts: data.accounts, sessions: data.sessions };
  const userId = process.env.IMPORT_USER_ID ?? "import-script";

  if (args.participants) {
    const rows = await importFile(args.participants, (row) => mapParticipantRow(row, context));
    for (const row of rows) {
      await createParticipantPayment(row as never, userId);
    }
    console.log(`Imported ${rows.length} participant rows.`);
  }

  if (args.expenses) {
    const rows = await importFile(args.expenses, (row) => mapExpenseRow(row, context));
    for (const row of rows) {
      await createExpense(row as never, userId);
    }
    console.log(`Imported ${rows.length} expense rows.`);
  }

  if (args.capital) {
    const rows = await importFile(args.capital, (row) => mapCapitalRow(row, context));
    for (const row of rows) {
      await createCapitalDeposit(row as never, userId);
    }
    console.log(`Imported ${rows.length} capital rows.`);
  }

  if (!args.participants && !args.expenses && !args.capital) {
    console.log("No files provided. Use --participants, --expenses, or --capital.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

