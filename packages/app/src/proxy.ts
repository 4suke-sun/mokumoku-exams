import { type NextRequest, NextResponse } from "next/server";
import { isOriginVerified, ORIGIN_VERIFY_HEADER } from "@/lib/origin-verify.ts";

// CloudFront を通らないアクセス(Function URL への直接のアクセス)を、すべての経路で断る
export function proxy(request: NextRequest) {
  if (
    !isOriginVerified(
      process.env.ORIGIN_VERIFY_VALUE,
      request.headers.get(ORIGIN_VERIFY_HEADER),
      process.env.NODE_ENV === "production",
    )
  ) {
    return new NextResponse(null, { status: 403 });
  }
  return NextResponse.next();
}
