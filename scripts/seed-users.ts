import { loadEnvConfig } from "@next/env";
import bcrypt from "bcryptjs";
import { slugId } from "../src/lib/domain";
import { upsertUser } from "../src/server/store";

loadEnvConfig(process.cwd());

async function main() {
  const raw = process.env.SEED_USERS ?? "Naufal:123456,Kolega:123456";
  const users = raw.split(",").map((entry) => {
    const [name, pin] = entry.split(":");
    if (!name || !pin) {
      throw new Error(`Invalid user seed entry: ${entry}`);
    }
    return { name: name.trim(), pin: pin.trim() };
  });

  for (const user of users) {
    const pinHash = await bcrypt.hash(user.pin, 12);
    await upsertUser({
      id: slugId(user.name),
      name: user.name,
      role: "admin",
      pinHash,
      active: true,
    });
    console.log(`Seeded user ${user.name}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
