import { ensureSeeded } from "../src/lib/seed";

async function main() {
  await ensureSeeded();
  console.log("Seed complete");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
