---
name: Pantio
description: Internal sales-warehouse dashboard; a soft pastel sales desk over the dbt gold models.
colors:
  ground: "#eef1f2"
  ground-wash-blue: "#d4e5f2"
  ground-wash-pink: "#f5dcd7"
  ground-wash-green: "#d7eedd"
  surface: "rgb(255 255 255 / 0.74)"
  surface-2: "rgb(255 255 255 / 0.6)"
  line: "rgb(17 17 16 / 0.09)"
  ink: "#121211"
  ink-2: "#5a5a56"
  ink-3: "#6e6e69"
  deep-teal: "#173847"
  year-teal: "#1f4a5e"
  harbour-blue: "#1d5b7b"
  field-blue: "#bad6ec"
  field-green: "#bde4c9"
  field-yellow: "#f1e39a"
  field-coral: "#f1b2a5"
  average-red: "#d65f53"
  gauge-mint: "#7fd6c2"
  gauge-butter: "#f4e59c"
  series-teal: "#5cb39e"
  series-mustard: "#e3c64e"
  series-salmon: "#e78a76"
  series-mist: "#a9bfd3"
  pos: "#1b7342"
  pos-bg: "#d9eedf"
  neg: "#b2362b"
  neg-bg: "#f6dedb"
  warn: "#8a5a00"
  warn-bg: "#f5e7c4"
typography:
  display:
    fontFamily: "Urbanist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "34px"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Urbanist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "27px"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Urbanist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.45
  body:
    fontFamily: "Urbanist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "Urbanist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "12.5px"
    fontWeight: 500
    lineHeight: 1.45
  micro:
    fontFamily: "Urbanist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "11.5px"
    fontWeight: 400
    lineHeight: 1.45
rounded:
  chip: "6px"
  cell: "7px"
  row: "8px"
  control: "10px"
  tooltip: "12px"
  popover: "16px"
  kpi: "18px"
  card: "20px"
  pill: "999px"
spacing:
  hairline: "2px"
  tight: "6px"
  gutter: "14px"
  card-y: "18px"
  card-x: "20px"
  page-x: "28px"
  rail-clearance: "104px"
components:
  button:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "38px"
  button-hover:
    backgroundColor: "{colors.surface-2}"
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.ground}"
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "38px"
  nav-item:
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "8px 15px"
  nav-item-active:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.ground}"
  segmented-option-active:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "6px 15px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "18px 20px"
  kpi-card-revenue:
    backgroundColor: "{colors.field-blue}"
    textColor: "#10202c"
    rounded: "{rounded.kpi}"
    padding: "16px 18px 14px"
  year-card:
    backgroundColor: "{colors.year-teal}"
    textColor: "#f1f7f9"
    rounded: "{rounded.card}"
    padding: "18px 20px"
  tooltip:
    backgroundColor: "{colors.deep-teal}"
    textColor: "#f4f4f2"
    rounded: "{rounded.tooltip}"
    padding: "10px 12px"
  delta-chip-up:
    backgroundColor: "{colors.pos-bg}"
    textColor: "{colors.pos}"
    rounded: "{rounded.chip}"
    padding: "2px 6px"
  status-low:
    backgroundColor: "{colors.warn-bg}"
    textColor: "{colors.warn}"
    rounded: "{rounded.chip}"
    padding: "1px 7px"
  rail:
    backgroundColor: "{colors.deep-teal}"
    rounded: "{rounded.pill}"
    padding: "8px 6px"
---

# Design System: Pantio

## Overview

**Creative North Star: "The Pastel Sales Desk"**

A calm, airy analyst's desk: a pale wash of blue, blush and mint sits behind translucent white cards, and the numbers carry the weight. Colour is used as field, not as accent: each KPI owns a whole pastel card (blue, green, yellow, coral) rather than a coloured chip on a grey card. One dark teal anchor, the year-to-date card, gives the page its centre of gravity, and the same deep teal returns in the tool rail, the tooltip and the active month bar so the darks read as one family.

The signature move is the hatched year: past months are diagonally hatched, translucent capsules; the month in focus fills solid with a teal gradient, gets a white cap, and raises a dark tooltip. Future months are dashed outlines. Everything is rounded, pill-shaped controls and softly lifted cards; nothing is boxed in with hard borders. Density is moderate: the whole month reads in the first viewport, with detail (heatmap, category mix, stores, stock) below.

Pastel is the default palette (`data-palette="pastel"` on `<html>`). Mono, Ocean and Sage are alternate palettes that reassign the same role tokens; `data-theme="dark"` inverts neutrals while keeping each palette's dark anchors. The tokens in the frontmatter are the Pastel light values.

**Key Characteristics:**
- Pale three-point radial wash ground (blue top-left, blush top-right, mint at the foot), fixed behind the scroll.
- Translucent white cards with a soft two-layer shadow, no borders.
- Whole-card pastel KPI fields with dark same-hue text.
- One deep-teal family for every dark element: year card, rail, tooltip, active bar, top heat cell.
- Pills everywhere: nav, segmented controls, buttons, rail, bars.
- Urbanist Variable throughout, with intermediate weights (450, 550, 650) and tabular numerals on every figure.

## Colors

Soft pastel fields over a misty ground, anchored by one deep teal and kept honest by a separate, muted semantic set for up/down/low.

### Primary
- **Harbour Blue** (`harbour-blue`): the data colour. Base of the active bar gradient (to `#2f84ad` and `#a8d3e9`), first category series, store share bars, densest heatmap step. Its hatch tint (31 91 123 at 26%, 45% on hover) draws the inactive bars.
- **Deep Teal** (`deep-teal`): the chrome dark. Floating tool rail and chart tooltip.
- **Year Teal** (`year-teal`): the year-to-date gauge card, the single dark card on the page. Its gauge arc runs **Gauge Mint** (`gauge-mint`) to **Gauge Butter** (`gauge-butter`).

### Secondary
- **KPI Fields**: **Field Blue** (`field-blue`, Revenue), **Field Green** (`field-green`, Orders), **Field Yellow** (`field-yellow`, Units sold), **Field Coral** (`field-coral`, Stock health). Each card's text is a near-black of its own hue (`#10202c`, `#0f2216`, `#29230a`, `#2e1410`); muted text is that ink at 70%. Delta chips inside a field sit on white at 50%.

### Tertiary
- **Average Red** (`average-red`): the dashed average line across the revenue chart. Its only job.
- **Category series**: Harbour Blue, **Series Teal** (`series-teal`), **Series Mustard** (`series-mustard`), **Series Salmon** (`series-salmon`), **Series Mist** (`series-mist`), in that order, for the category arc and its legend keys.
- **Heat ramp** (six steps, `#e3ebf0` to Harbour Blue): sales-by-time heatmap and its legend.

### Neutral
- **Mist Ground** (`ground`, under the three washes `ground-wash-blue`, `ground-wash-pink`, `ground-wash-green`): page background.
- **Frosted White** (`surface`, 74% white): cards, nav, buttons, pills. **Frosted White 2** (`surface-2`, 60%): hover fills, inline chips, tracks.
- **Ink** (`ink`): text, primary button, active nav pill, focus ring. **Ink 2** (`ink-2`): secondary text. **Ink 3** (`ink-3`): axis labels and heat headers.
- **Hairline** (`line`): table rules, chart grid, list dividers.

### Semantic
- **Positive** (`pos` on `pos-bg`), **Negative** (`neg` on `neg-bg`), **Warning** (`warn` on `warn-bg`): delta chips, status pills, the alert count, stock meters. Never used decoratively.

### Named Rules
**The Field Not Chip Rule.** A KPI's colour is the whole card, with same-hue dark ink on it. Don't put coloured accent chips or stripes on a neutral card.

**The One Dark Family Rule.** Every dark element in a palette shares that palette's anchor hue (deep teal in Pastel, near-black in Mono, navy in Ocean, forest in Sage). No second dark.

**The Palette Is A Role Swap Rule.** New surfaces use the role variables (`--k1..4`, `--h0..5`, `--s1..5`, `--gauge-*`, `--tip-*`, `--rail-bg`, `--bar-active`, `--hatch`, `--avg`), never palette hexes, so Mono, Ocean, Sage and dark all keep working.

## Typography

**Display Font:** Urbanist Variable (with ui-sans-serif, system-ui, sans-serif)
**Body Font:** Urbanist Variable
**Label/Mono Font:** none; figures use `font-variant-numeric: tabular-nums`.

**Character:** One geometric sans with soft round bowls, used across a fine weight range. Hierarchy comes from size and the 450/550/650 steps of the variable axis, not from a second family.

### Hierarchy
- **Display** (600, 34px, 1.1, -0.025em): the page H1 only; 28px under 600px wide. The gauge readout uses the same size at 650, line-height 1.
- **Headline** (600, 27px, 1.15, -0.02em): KPI values (22px on mobile). Category total sits at 30px/650.
- **Title** (600, 15px): card titles and brand name; the year card's subhead steps up to 16px.
- **Body** (400, 14px, 1.45): base text, nav items; tables and controls at 13.5px.
- **Label** (500, 12.5–13px): KPI labels, notes, captions, tooltip text, card sub-lines at 450.
- **Micro** (400–650, 11–11.5px): axis labels, heat headers, chip text, badges.

### Named Rules
**The Tabular Figures Rule.** Every number (KPI values, gauge, axes, tooltips, table cells, deltas) is set with tabular numerals so columns and updates don't jitter.

**The No Uppercase Labels Rule.** Labels stay sentence case at normal tracking; hierarchy is size and weight. The only tracking used is negative, on large figures.

## Layout

Centred column, max 1320px, with 28px side padding on the right and 104px on the left to clear the fixed rail. Header is a three-column grid: brand left, pill nav centred, team and account right. The toolbar repeats that grid: segmented region tabs left, period centred, actions right.

The body is a vertical stack with a 14px rhythm (gap between rows and between cards). Rows: four equal KPI cards; then the year card beside the revenue chart (1 : 2.05); then sales-by-time beside category mix (1.45 : 1); then stores beside stock alerts (same ratio). A sample-data footnote closes the page.

Breakpoints: at 1240px KPIs go 2×2 and team avatars hide; at 1060px nav drops to its own scrollable row, paired rows stack, and the year card lays gauge beside copy; at 860px the rail moves to a horizontal pill at the bottom centre and page padding becomes 16px (104px bottom); at 600px KPI mini-viz, heat legend, share bars and wide table columns hide, and cards pad 16px.

## Elevation & Depth

Hybrid: a translucent card over a tinted wash gives tonal depth, and one soft, low ambient shadow lifts every resting surface. Floating dark elements (rail, tooltip, active bar, popover) get a deeper, offset-downward diffuse shadow. Depth never comes from borders.

### Shadow Vocabulary
- **Resting lift** (`box-shadow: 0 1px 2px rgb(17 17 16 / 0.05), 0 8px 24px -12px rgb(17 17 16 / 0.12)`): cards, KPI cards, nav, buttons, pills. Dark theme: `0 1px 2px rgb(0 0 0 / 0.3)`.
- **Floating dark** (`0 12px 32px -12px rgb(0 0 0 / 0.45)` rail; `0 14px 30px -12px rgb(0 0 0 / 0.5)` tooltip; `0 10px 24px -10px rgb(0 0 0 / 0.45)` active bar): elements that hover above the page.
- **Popover** (`0 16px 40px -12px rgb(0 0 0 / 0.3), 0 0 0 1px var(--line)`): the palette menu.
- **Pressed segment** (`0 1px 2px rgb(17 17 16 / 0.1)`): the selected option inside a segmented control.

### Named Rules
**The Soft Lift Rule.** Resting surfaces share one shadow token. Deeper shadows are reserved for things that float above the layout.

## Shapes

Generously rounded and soft. Cards are 20px, KPI cards 18px, popovers 16px, tooltips 12px, small controls and list rows 8–10px, heat cells 7px, chips 6px, legend keys 3px. Every interactive container that can be a pill is one (999px): nav, nav items, segmented controls, buttons, rail, avatars, sync pill, bars, meters, mini bars. Rules are hairline and only inside cards (table rows, chart grid, alert list). Dashed lines carry meaning: future months, the average line, the divider above a KPI's "See ..." link.

## Components

### Buttons
- **Shape:** full pill (999px), 38px tall, 16px side padding, 13.5px at weight 550, optional 16–17px Lucide icon at 7px gap.
- **Default:** frosted white with the resting lift; hover to Frosted White 2.
- **Primary:** Ink fill with ground-coloured text; hover mixes 14% ground into the ink.
- **Active:** nudges down 1px. **Focus:** 2px ink outline at 2px offset (white on dark surfaces).
- **Icon button:** 36px frosted circle; rail buttons 38px, 70% white icon, 12% white fill on hover or open.

### Chips
- **Delta chip:** 6px radius, 12px/650, arrow plus percentage, semantic colour on its tint.
- **Status pill:** "Out" (negative) and "Low" (warning) at 11.5px/650.
- **Count pill:** full pill, negative tint, beside the stock card title.

### Cards / Containers
- **Corner Style:** 20px (KPI 18px).
- **Background:** Frosted White; KPI cards take their palette field; the year card takes Year Teal.
- **Shadow Strategy:** resting lift (see Elevation).
- **Border:** none.
- **Internal Padding:** 18px 20px (KPI 16px 18px 14px; 16px / 14px on mobile).
- **Header:** title at 15px/600 with an info button and an optional 13px muted sub-figure; controls right-aligned.

### Navigation
- **Top nav:** frosted pill tray with 4px inset; items are pills at 14px/500, hover Frosted White 2, current page solid Ink with a muted count badge.
- **Segmented control:** 6% ink tray, options at 13.5px/500 in Ink 2; the selected option becomes a frosted pill with the pressed-segment shadow. Small variant at 12.5px.
- **Tool rail:** vertical deep-teal pill fixed at the left middle; becomes a horizontal pill at the bottom centre under 860px. Red count badge ringed in the rail colour.

### Hatched Month Bars (signature)
Capsule bars at up to 34px wide inside a 12-month grid. Past months: 135° hatch in the palette tint over a near-clear fill, inset hairline in the same tint, darker on hover. Selected past month: the `--bar-active` gradient, the floating-dark shadow, a white 14px cap with a 3px soft ring, and the dark tooltip (title, then label/value rows with tinted positive/negative). Future months: transparent with a 1.5px dashed hatch outline. A dashed Average Red line with a small frosted label crosses the plot. Bars grow on a 0.5s ease-out.

### Year Gauge (signature)
Dark card holding a 20px-stroke semicircular arc on a 9% track, gradient Gauge Mint to Gauge Butter, tick marks lit up to the value, a ringed knob at the end, and a 34px/650 readout. Copy below: a 16px title with a translucent positive chip, then a 13px paragraph at 44ch.

### Data Tables and Lists
13.5px rows, 10px cell padding, hairline row rules, last rule removed, a 3% ink hover tint. Numeric columns right-aligned with tabular figures; header 12px/500 in Ink 2 with sortable buttons. Inline 5px pill meters show share or stock level.

### Tooltips
Dark (`--tip-bg`), 12px radius for chart tips and 10px for info tips, 12.5px text, muted labels in `--tip-muted`, values in tip-foreground at 600. Info tips fade and rise 3px in 0.15s on hover or focus.

### Motion
State changes 0.15–0.18s; data changes 0.45–0.5s on `cubic-bezier(0.2, 0.8, 0.2, 1)`; KPI palette swaps cross-fade 0.3s. All collapse under `prefers-reduced-motion`.

## Do's and Don'ts

### Do:
- **Do** set colour through role variables (`--k1..4`, `--h0..5`, `--s1..5`, `--tip-*`, `--gauge-*`, `--rail-bg`, `--bar-active`, `--hatch`, `--avg`) so every palette and the dark theme follow.
- **Do** give each KPI a whole pastel field with its own dark ink, and keep one dark anchor card per view.
- **Do** use pills (999px) for nav, segmented controls, buttons and bars; 20px for cards.
- **Do** set every figure in tabular numerals and label sample data as sample data.
- **Do** keep semantic green, red and amber for change and stock status only.
- **Do** use Lucide stroke icons at 16–17px, stroke 1.8.

### Don't:
- **Don't** put coloured accent chips or stripes on grey cards; the colour is the card.
- **Don't** add borders to cards or a second shadow recipe for resting surfaces.
- **Don't** introduce a second typeface or uppercase tracked labels.
- **Don't** hard-code palette hexes in components; they break Mono, Ocean, Sage and dark.
- **Don't** use Average Red for anything but the average line.
