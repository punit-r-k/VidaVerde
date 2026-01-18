import { NextResponse } from "next/server";
import { getInventoryMap } from "@/lib/stock";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const inventory = await getInventoryMap();
  return NextResponse.json(inventory, {
    headers: {
      "Cache-Control": "no-store"
    }
  });
}
