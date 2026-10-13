# PriceTrace

<!-- impeccable:product-schema 1 -->

## Platform

web

## Product Purpose

PriceTrace explores and compares observed prices with their source and observation date. It distinguishes receipt facts, public observations, standard product families, exact sale specifications, seller mappings, and restaurant menus.

## Users and Operating Context

The implemented workflows support people comparing products and restaurant menus, inspecting seller history, and estimating a shopping basket. Authenticated identity details and administrator review tools have separate access boundaries. Audience demographics are not established.

## Capabilities and Constraints

- Next.js App Router, React, strict TypeScript, CSS Modules, static export at `/PriceTrace`, and a Capacitor wrapper.
- Existing query-string navigation, product filters, Nutrition details, source provenance, approval gates, cart persistence, and authentication remain intact.
- Prices are observations, not live quotes or stock guarantees. Unknown facts remain unknown.
- No source fact, canonical identity, database schema, or approval contract changes in the visual redesign.
- Existing catalog pagination, retry, and account isolation are preserved.

## Brand Commitments

The user specifies Cinematic Data Instrument: a near-black mineral surface, restrained PriceTrace green, a spatial first impression, and quiet working views. Avoid generic SaaS patterns, purple-blue gradients, excessive glow, nested cards, and meaningless particles.

## Evidence on Hand

Validated public receipt and official-catalog projections are already in the repository. The new observation visual derives from the existing ProductGroup identity and its own records. No invented prices, usage statistics, partnerships, or testimonials.

## Accessibility and Inclusion

Mobile usability, keyboard operation, visible focus, reduced motion, readable dates and prices outside graphics, and complete service access without animation are required.

## Decision Source

Captured from the user's explicit brief, repository AGENTS.md, and current code. The user delegates design decisions and explicitly asks to continue through implementation without a design-choice interview.
