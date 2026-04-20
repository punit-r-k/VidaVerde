import { NextResponse } from "next/server";
import { getLlmsText } from "@/lib/siteMetadata";

export const dynamic = "force-static";

export function GET() {
  return new NextResponse(getLlmsText(), {
    headers: {
      "content-type": "text/plain; charset=utf-8"
    }
  });
}
