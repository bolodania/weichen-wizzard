// SAP Document Cover Page
// Uses bundled SVG assets and 72 Brand font

#import "style.typ": font-regular, sap-gray

#let sap-cover(
  title:    "Document Title",
  subtitle: "",
  customer: "",
  version:  "1.0",
  date:     "",
) = {
  page(
    margin: (top: 2cm, bottom: 2cm, left: 2cm, right: 2cm),
    header: none,
    footer: grid(
      columns: (auto, 1fr),
      align: (left, left),
      image("graphics/SAP_R_grad_scrn.svg", width: 1.75cm),
    ),
  )[
    // Blue pattern — top of cover page
    #place(
      top,
      image("graphics/pattern_blue.svg", width: 17cm, height: 5.5cm, fit: "cover"),
    )

    #align(left)[
      #v(6.5cm)

      // "Document" label
      #text(size: 14pt, font: font-regular, weight: "medium", fill: black)[Document]

      #v(1.5em)

      // Version and date line
      #text(size: 11pt, font: font-regular, weight: "medium")[
        Version #version \
        #date
      ]

      #v(1.5em)

      // Subtitle (if provided)
      #if subtitle != "" {
        text(size: 11pt, font: font-regular, fill: sap-gray)[#subtitle]
        v(0.75em)
      }

      // Main title
      #text(size: 28pt, font: font-regular, weight: "bold")[#title]

      // Customer name
      #if customer != "" {
        v(0.5em)
        text(size: 18pt, font: font-regular, weight: "medium")[#customer]
      }
    ]
  ]
}
