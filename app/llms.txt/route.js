import { NextResponse } from "next/server";
import { getLlmsText } from "@/lib/siteMetadata";

export const dynamic = "force-static";

export function GET() {
  return new NextResponse(getLlmsText(), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
      "x-robots-tag": "index, follow"
    }
  });
}
