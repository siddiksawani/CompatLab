import { ImageResponse } from "next/og";

export const alt = "CompatLab: npm loading evidence across Node.js, Bun and Deno";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export default function Image() {
  return new ImageResponse(
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        background: "#f5f7f2",
        color: "#183c31",
        width: "100%",
        height: "100%",
        padding: "80px",
        justifyContent: "space-between",
      }}
    >
      <div style={{ display: "flex", fontSize: 34, fontWeight: 700 }}>CompatLab</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div style={{ display: "flex", fontSize: 72, fontWeight: 700 }}>
          Check your npm package.
        </div>
        <div style={{ display: "flex", fontSize: 34 }}>
          Loading results across Node.js, Bun and Deno.
        </div>
      </div>
      <div style={{ display: "flex", fontSize: 26 }}>
        Compare import and require checks for exact versions.
      </div>
    </div>,
    size,
  );
}
