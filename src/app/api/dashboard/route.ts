import { NextResponse } from "next/server";
import { getDashboardData } from "@/lib/analytics";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const month = searchParams.get("month") ?? undefined;
  const data = await getDashboardData(month);
  return NextResponse.json(data);
}
