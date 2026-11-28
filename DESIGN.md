# Rukn — interface design system

This document can be imported into Google Stitch as the design context for future screens. The production implementation lives in `web/src/studio-theme.css` and React components under `web/src/`.

## Product and direction

Rukn is a private Arabic RTL workspace for the shop owner and sales agents. The main jobs are recording an order, following Darb Assabil shipping, seeing payment and commission, and acting on notifications. Design for a phone first, then a desktop dashboard. Show real operational information before decoration. Keep the original Rukn wordmark.

## Visual language

- Warm ivory background `#f5f2ec`; paper surfaces `#fffcf8`; soft inset surfaces `#f8f4ed`.
- Charcoal brown `#292721` for main text and dark panels. Muted copy `#777167`.
- Bronze `#a17c48` for emphasis, with `#795a34` for solid buttons and links.
- Positive status `#496e58`; warning and failure `#9b5c47`.
- Fine border `#e6ded2`; shadows are short and subtle. Avoid blue, glass effects, neon, ornamental 3D objects, and excessive gradients.
- IBM Plex Sans Arabic. Use Arabic sentence case, clear numerals, and no all-caps UI labels.

## Layout and components

- Desktop: 250 px dark navigation rail, 70 px top bar, content up to 1320 px, generous whitespace.
- Mobile: compact 64 px top bar, five actions in a fixed bottom navigation, central new-order action, 14 px page margins.
- Overview: a compact dark masthead with current work counts and a prominent new-order button; then metric cards, state shortcuts, daily review, activity, and recent orders.
- Order lists: customer and status first, then location, order code, product, date, and amount. Use direct row opening. Filters scroll horizontally on narrow screens.
- Order form: numbered sections for customer, destination, products, and payment; each input has a visible label, clear focus, and sufficient touch target. Keep the final amount and submit action visible at the end.
- Wallet and team: ledger-like money hierarchy, with earned, paid, and due clearly distinct. Never infer a commission before delivery.
- Notifications: brief title, explanation, source state, and one clear action.

## Interaction and accessibility

- RTL throughout. Phone numbers, SKUs, and tracking codes keep LTR direction where shown.
- Minimum 42 px touch targets where practical, visible keyboard focus, descriptive button labels.
- Motion uses a short 180–260 ms ease; it confirms navigation and feedback rather than delaying content. Respect `prefers-reduced-motion`.
- Avoid horizontal scrolling at 320–390 px viewport widths. Preserve normal vertical scrolling inside forms and drawers.
