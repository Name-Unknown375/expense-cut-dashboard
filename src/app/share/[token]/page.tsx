import { Nav } from "@/components/Nav";
import { DashboardView } from "@/components/DashboardView";
import { getDashboardData } from "@/lib/analytics";
import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function SharePage({
  params,
}: {
  params: { token: string };
}) {
  const share = await prisma.shareLink.findFirst({
    where: { token: params.token, active: true },
  });
  if (!share) notFound();

  const data = await getDashboardData();
  return (
    <>
      <Nav readOnly />
      <DashboardView data={data} readOnly />
    </>
  );
}
