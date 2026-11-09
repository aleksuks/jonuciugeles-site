# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Local customers around Teleičiai (Kauno r.) who want flowers: someone dropping in for a bouquet today, someone ordering one for a date or an occasion, someone who needs it delivered, and people planning an event who need a special order.

## Product Purpose
The storefront website for Jonučių gėlės, a flower shop. It tells visitors what the shop does, where it is and when it is open, and lets them send a bouquet order or enquiry. Success: a visitor calls, visits, or sends an order through the form.

## Positioning
A local florist whose site carries a live, generated 3D bouquet that assembles, ties and loosens as the visitor moves through the page; the bouquet is decoration and brand, not a product configurator.

## Operating Context
Visitors are mostly on phones. Orders are confirmed by the shop personally (phone or email), there is no checkout or payment online.

## Capabilities and Constraints
- Language: Lithuanian only (`lang="lt"`).
- Offer (confirmed): bouquets every day in the shop (walk-in), bouquets to order, delivery, special orders for events. The shop does NOT decorate on site at events.
- Hours (confirmed): Mon to Fri 7:30 to 20:00, Sat 8:00 to 20:00, Sun 9:00 to 18:00.
- Address: Artojų g. 12, Teleičiai, Kauno r. Phone as given: +3706706022 (looks one digit short for a Lithuanian number; to confirm).
- Contact form stores enquiries in Supabase when configured (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`); not live yet.
- Future domain: jonuciugeles.lt (if the project goes ahead).
- Undecided: delivery area and price, contact email, prices.

## Brand Commitments
Name Jonučių gėlės; olive #6d6a49 line-art rose lockup (transparent PNGs in `public/brand/`). Flowers in the 3D view are generated in code, never downloaded models.

## Evidence on Hand
No photographs yet: the client will supply real photos of the flowers and the shop. No reviews, prices or customer quotes exist; do not invent them.

## Product Principles
- Say plainly what the shop sells, where it is and when it is open.
- Calling or sending an order is always one tap away.
- The 3D bouquet supports the page; it never blocks scrolling, reading or ordering.
- Only confirmed facts on the page.
