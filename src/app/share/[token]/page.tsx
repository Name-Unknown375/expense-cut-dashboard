import { Nav } from "@/components/Nav";
import { DashboardView } from "@/components/DashboardView";
import { getDashboardData } from "@/lib/analytics";
import { prisma } from "@/lib/db";
import { periodFromSearchParams } from "@/lib/period";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function SharePage({
  params,
  searchParams,
}: {
  params: { token: string };
  searchParams: { period?: string; month?: string; year?: string; from?: string; to?: string };
}) {
  const share = await prisma.shareLink.findFirst({
    where: { token: params.token, active: true },
  });
  if (!share) notFound();

  const data = await getDashboardData(periodFromSearchParams(searchParams));
  return (
    <>
      <Nav readOnly />
      <p className="mx-auto max-w-6xl px-4 pt-4 text-sm text-[var(--muted)]">
        Read-only · {data.period.label}
      </p>
      <DashboardView data={data} readOnly />
    </>
  );
}
