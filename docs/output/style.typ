// SAP Horizon Design Language — Colors & Helpers
// Fonts and graphics are bundled in template/fonts/ and template/graphics/

// ─── Colors ───────────────────────────────────────────────────────────────────
#let sap-blue    = rgb("#0070F2")
#let sap-blue-dk = rgb("#0040B0")
#let sap-dark    = rgb("#32363A")
#let sap-gray    = rgb("#7F7F7F")
#let sap-gray-lt = rgb("#ececec")
#let sap-border  = rgb("#D9D9D9")
#let sap-white   = rgb("#FFFFFF")
#let sap-black   = rgb("#000000")
#let sap-green   = rgb("#107E3E")
#let sap-orange  = rgb("#E76500")
#let sap-red     = rgb("#BB0000")

// ─── Fonts ────────────────────────────────────────────────────────────────────
#let font-regular = "72 Brand"
#let font-mono    = "Courier New"

// ─── Sizes ────────────────────────────────────────────────────────────────────
#let body-size  = 11pt
#let small-size = 9pt
#let h1-size    = 18pt
#let h2-size    = 14pt
#let h3-size    = 12pt

// ─── Table helper ─────────────────────────────────────────────────────────────
// Styled table matching the vs-document look: subtle borders, gray alternating rows
#let sap-table(headers: (), rows: (), column-widths: auto) = {
  let col-count = headers.len()
  let cols = if column-widths == auto { (1fr,) * col-count } else { column-widths }

  figure(
    kind: table,
    table(
      columns: cols,
      align: left,
      stroke: (x, y) => (
        left:   if x > 0 { 0.5pt + sap-border } else { none },
        right:  none,
        top:    if y > 0 { 0.5pt + sap-border } else { none },
        bottom: none,
      ),
      fill: (x, y) => if y == 0 { sap-white } else if calc.rem(y, 2) == 0 { sap-gray-lt } else { sap-white },
      inset: (x: 8pt, y: 6pt),
      ..headers.map(h => text(weight: "bold", size: small-size, h)),
      ..rows.flatten().map(cell => text(size: small-size, cell)),
    ),
    caption: none,
  )
}

// ─── Callout helper ───────────────────────────────────────────────────────────
// type: "info" | "warning" | "error" | "success"
#let callout(type: "info", body) = {
  let (accent, icon) = if type == "warning"  { (sap-orange, "⚠") }
    else if type == "error"   { (sap-red,    "✕") }
    else if type == "success" { (sap-green,  "✓") }
    else                      { (sap-blue,   "ℹ") }

  block(
    width: 100%,
    inset: (left: 12pt, right: 10pt, top: 8pt, bottom: 8pt),
    stroke: (left: 3pt + accent),
    fill: rgb("#F5F6F7"),
    radius: 2pt,
    text(size: body-size)[#text(fill: accent, weight: "bold")[#icon ]#body],
  )
}
