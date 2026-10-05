import { Nav } from "@/components/Nav";
import { DashboardView } from "@/components/DashboardView";
import { getDashboardData } from "@/lib/analytics";

export const dynamic = "force-dynamic";

export default async function HomePage({
  searchParams,
}: {
  searchParams: { month?: string };
}) {
  const data = await getDashboardData(searchParams.month);
  return (
    <>
      <Nav />
      <DashboardView data={data} />
    </>
  );
}
