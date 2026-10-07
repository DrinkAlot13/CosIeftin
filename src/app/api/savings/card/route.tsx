// A shareable "I saved X lei this month" image, rendered on the fly with next/og.
//
// NO AUTH, AND DELIBERATELY SO. This route only renders whatever number it is given — it does
// not look up anyone's account or savings total itself. The client already fetched its OWN
// total from the authenticated /api/savings/summary before calling this, the same separation
// a generic chart-image renderer has from the data behind it. Rendering is not a second place
// that could leak a DIFFERENT shopper's number: there is no lookup here to get wrong.
import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";

export const runtime = "edge";

export async function GET(req: NextRequest) {
  const bani = Number(req.nextUrl.searchParams.get("bani") ?? 0);
  // Bounded rather than trusted blindly: a bare render route with no auth is exactly the kind
  // of endpoint that gets probed with garbage, and there is no real monthly grocery saving
  // past a few thousand lei — same reasoning as the budget route's own sanity bound.
  const lei = Number.isFinite(bani) && bani > 0 && bani < 10_000_00 ? bani / 100 : 0;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%", height: "100%", display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", background: "#16a34a",
          fontFamily: "system-ui, sans-serif", color: "#fff", padding: 60,
        }}
      >
        <div style={{ fontSize: 32, fontWeight: 600, opacity: 0.9 }}>CosIeftin</div>
        <div style={{ fontSize: 28, marginTop: 40, opacity: 0.85 }}>Am economisit luna asta</div>
        <div style={{ fontSize: 96, fontWeight: 800, marginTop: 8 }}>{lei.toFixed(2).replace(".", ",")} lei</div>
        <div style={{ fontSize: 26, marginTop: 40, opacity: 0.85 }}>comparând prețurile la cumpărături</div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
