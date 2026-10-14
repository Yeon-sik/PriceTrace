# PriceTrace design assets

## Typeface

- **SUIT Variable**, by SUNN (Sun-typeface), SIL Open Font License 1.1.
- Source: https://github.com/sun-typeface/SUIT/tree/55118d981336d8fce005eb62888c12c0568ef7b0
- Local file: `src/app/fonts/SUIT-Variable.woff2` (624,536 bytes). License retained beside it.
- Self-hosted through `next/font/local`; no runtime request to a font provider. One variable font covers Korean and Latin. `font-display: swap` keeps content readable during loading.

## Interface icons

- **Solar Linear**, by 480 Design, Creative Commons Attribution 4.0.
- Original work: https://www.figma.com/community/file/1166831539721848736
- Distribution: https://icon-sets.iconify.design/solar/
- License: https://creativecommons.org/licenses/by/4.0/
- Twelve existing icon paths embedded in `src/components/Icon.tsx`. SVG attributes converted to JSX; artwork unchanged. Attribution is also visible in the application footer. No external icon requests at runtime.

## Graphics

The home observation instrument is a runtime SVG data graphic drawn from existing public receipt records. It uses existing product grouping and seller identity. Its geometry is a spatial relationship view, not a price axis, probability, or invented observation. Dates and prices remain readable HTML outside the graphic. No generated or stock raster art is used.

## Design skills

Impeccable installed at project scope with `npx impeccable install --providers=codex --scope=project --no-hooks` (skill 4.5.0, engine 0.1.11). Engine binaries are local generated tooling and excluded from Git. Run the official installer to restore a missing binary. No automatic hooks were installed; guidelines were read and applied explicitly.

Eight named MengTo/Skills directories were selectively installed from the official repository with the Codex skill installer. Every named SKILL.md was read. Selection and runtime exclusions are recorded in `.impeccable/surfaces/pricetrace.md`.
