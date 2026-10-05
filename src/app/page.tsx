import { Nav } from "@/components/Nav";
import { DashboardView } from "@/components/DashboardView";
import { getDashboardData } from "@/lib/analytics";
import { periodFromSearchParams } from "@/lib/period";

export const dynamic = "force-dynamic";

export default async function HomePage({
  searchParams,
}: {
  searchParams: {
    period?: string;
    month?: string;
    year?: string;
    from?: string;
    to?: string;
  };
}) {
  const spec = periodFromSearchParams(searchParams);
  const data = await getDashboardData(spec);
  return (
    <>
      <Nav />
      <DashboardView data={data} />
    </>
  );
}
