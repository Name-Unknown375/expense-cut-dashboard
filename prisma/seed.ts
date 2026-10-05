import { prisma } from "../src/lib/db";
import { ensureSeeded, seedSampleTransactions } from "../src/lib/seed";

async function main() {
  if (process.env.TURSO_DATABASE_URL) {
    console.log("Skipping demo transactions — Turso holds real spend.");
    await ensureSeeded();
    return;
  }
  await ensureSeeded();
  const n = await prisma.transaction.count();
  if (n === 0) {
    await seedSampleTransactions();
    console.log("Loaded local demo transactions");
  } else {
    console.log("Transactions already present — demo not loaded");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
