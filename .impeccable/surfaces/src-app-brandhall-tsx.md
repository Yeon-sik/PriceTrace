---
version: 1
slug: "src-app-brandhall-tsx"
primary_target: "src/app/BrandHall.tsx"
related_targets: ["src/app/BrandHall.module.css","src/app/AdminBrandPanel.tsx","src/app/AdminBrandPanel.module.css"]
---

# PriceTrace Brand Hall

Target: src/app/BrandHall.tsx.
Related targets: src/app/BrandHall.module.css, src/app/AdminBrandPanel.tsx, src/app/AdminBrandPanel.module.css.
Mode: Operate for public brand exploration and deliberate administrator changes.

## Direction contract

THESIS: Let visitors inspect canonical brand identities, explicit parent/child relationships, and the public exact products directly linked to the selected brand. Brand names and aliases help discovery; they do not establish identity or relationships.

OWN-WORLD: Inherit the existing PriceTrace white canvas, SUIT typography, dark readable text, thin neutral dividers, compact controls and green action/selection accents from DESIGN.md. Use the existing controls and shared navigation. This surface extends that system.

STORY: Search by canonical name or alias, or browse root brands and their immediate children. Select a brand, follow its explicit breadcrumb and immediate children, then open its directly linked public exact products. Missing public parent information remains visible as unavailable information.

FIRST VIEWPORT: Show a clear Brand Hall heading, current path and available next actions. The index exposes search and the root list; detail exposes the breadcrumb, brand name and return action. Keep this a working view without a hero.

FORM: A flat list index and brand detail. The index uses three columns on wide screens, two at 760px and one at 520px. The admin surface uses a split list/form workspace and stacks at 760px. Selecting a brand or New Brand on the stacked layout focuses and centers the canonical-name input above the fixed mobile navigation; the desktop split stays in place. The user pinned the existing visual world and composition, so no concept roll, comp or design interview applies.

FINISH: The finish reviewer returned ship after the mobile editor handoff issue was resolved. Preserve the reviewed composition and the local evidence below; later changes must continue to meet the behavior and data boundaries in this brief.

## Feature contract

- Public brand catalog v1 supplies canonical identities and explicit hierarchy. Canonical-name and alias search must identify the matched alias when relevant. Breadcrumbs and immediate-child lists use explicit IDs; absent public parents are not inferred.
- Public exact catalog v5 is a v4 superset with brand_id and immediate-parent metadata. Existing v1-v4 behavior and the strict v4 parser stay unchanged.
- A brand detail lists only exact products directly linked to that brand. Descendant products remain on their own brand pages. Product rows retain the exact content amount, unit, package count and available category.
- Admin changes to canonical identity, aliases and hierarchy use server-admin RPCs. The editor validates inputs, excludes the selected brand and descendants from parent candidates, and reports saving, success and errors. Alias removal requires confirmation. There is no brand hard-delete UI, inferred parent relationship or manufacturer-to-brand mapping.
- Keep loading, empty, missing-brand, missing-parent, error and retry states readable. Abort or disregard stale requests so a previous search or selection cannot overwrite the current result. Keep native controls, visible labels, focus treatment and status/alert announcements.

## Review evidence and limits

The following captures record actual local fixture Chromium sessions:

- .impeccable/review/brand-hall/desktop.png
- .impeccable/review/brand-hall/mobile.png
- .impeccable/review/brand-hall/admin-desktop.png
- .impeccable/review/brand-hall/admin-mobile.png
- .impeccable/review/brand-hall/admin-editor-mobile.png

The mobile editor capture records the focused canonical-name input above the fixed navigation. These are local browser observations. They do not establish hosted Supabase application, hosted deployment, Android device behavior or production data correctness. The surface introduces no new raster asset.

## Maintenance boundary

This brief owns Brand Hall composition and interaction guidance only. DESIGN.md, PRODUCT.md, .impeccable/design.json and the existing pricetrace home surface brief remain unchanged. Broader product or design-context refresh remains outside this feature handoff.
