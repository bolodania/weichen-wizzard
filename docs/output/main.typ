// SAP Document Template — main.typ
// All content comes from content.typ; metadata from metadata.typ.

#import "style.typ": *
#import "cover.typ": sap-cover

// ─── Metadata ─────────────────────────────────────────────────────────────────
#import "metadata.typ": doc-title, doc-subtitle, doc-customer, doc-version, doc-date

// ─── Cover Page ───────────────────────────────────────────────────────────────
#sap-cover(
  title:    doc-title,
  subtitle: doc-subtitle,
  customer: doc-customer,
  version:  doc-version,
  date:     doc-date,
)

// ─── Document Setup ───────────────────────────────────────────────────────────
#set document(title: doc-title, author: "SAP")

#set page(
  paper: "a4",
  margin: (top: 2cm, bottom: 3.5cm, left: 2cm, right: 2cm),
  footer: [
    #set par(spacing: 0.66em, justify: true)
    #set text(size: 9pt, font: font-regular, fill: sap-gray)
    Confidential

    #doc-title – Version #doc-version – #doc-date
    #h(1fr)
    #context counter(page).display("1 / 1", both: true)

    #set text(size: 5pt, font: font-regular, fill: sap-gray)
    © #datetime.today().year() SAP SE or an SAP affiliate company. All rights reserved.
  ],
  numbering: "1",
)

#set text(font: font-regular, size: body-size, fill: sap-black, lang: "en")
#set par(justify: true, leading: 0.65em, spacing: 0.9em)
#set list(marker: ([•], [-], [◦]))

// ─── Heading Styles ───────────────────────────────────────────────────────────
#set heading(numbering: "1.1.1")

// Prevent headings near bottom of page (< 20% space remaining)
#show heading: it => {
  block(breakable: false, height: 20%)
  v(-20%, weak: true)
  it
}

#show heading.where(level: 1): it => block(below: 1.5em)[
  #set text(font: font-regular, weight: "bold", size: h1-size, fill: sap-black)
  #it
]
#show heading.where(level: 2): it => block(below: 1.2em)[
  #set text(font: font-regular, weight: "medium", size: h2-size, fill: sap-black)
  #it
]
#show heading.where(level: 3): it => block(below: 1em)[
  #set text(font: font-regular, weight: "medium", size: h3-size, fill: sap-black)
  #it
]
#show heading.where(level: 4): it => block(below: 0.8em)[
  #set text(font: font-regular, weight: "medium", size: 11pt, fill: sap-black)
  #it
]

// ─── Code Blocks ─────────────────────────────────────────────────────────────
#show raw.where(block: true): it => {
  block(
    width: 100%,
    fill: rgb("#F5F6F7"),
    stroke: (left: 3pt + sap-blue, rest: 0.5pt + sap-border),
    inset: 10pt,
    radius: 2pt,
    text(font: font-mono, size: 9pt)[#it],
  )
}

#show raw.where(block: false): it => {
  box(
    fill: rgb("#F5F6F7"),
    stroke: 0.5pt + sap-border,
    inset: (x: 3pt, y: 1pt),
    radius: 2pt,
    text(font: font-mono, size: 9pt)[#it],
  )
}

// ─── Default Table Style ──────────────────────────────────────────────────────
// Applied to native Typst tables (e.g. from markdown conversion)
#show table: it => {
  set text(size: small-size)
  set table(
    stroke: (x, y) => (
      left:  if x > 0 { 0.5pt + sap-border } else { none },
      right: none,
      top:   if y > 0 { 0.5pt + sap-border } else { none },
      bottom: none,
    ),
    fill: (x, y) => if y == 0 { sap-white } else if calc.rem(y, 2) == 0 { sap-gray-lt } else { sap-white },
    inset: (x: 8pt, y: 6pt),
    align: left,
  )
  it
}

// ─── TOC Page ─────────────────────────────────────────────────────────────────
#pagebreak()
#counter(page).update(1)

#v(6mm)
#text(size: h1-size, font: font-regular, weight: "bold")[Table of Contents]
#v(4mm)

#outline(
  title: none,
  depth: 3,
  indent: 1em,
  target: heading.where(numbering: "1.1.1"),
)

#pagebreak()

// ─── Content ──────────────────────────────────────────────────────────────────
#include "content.typ"
