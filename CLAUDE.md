# Jonučių gėlės: florist storefront

Store website for Jonučių gėlės (Artojų g. 12, Teleičiai, Kauno r.), in Lithuanian. Product facts live in PRODUCT.md. The former bouquet builder is now decoration: a generated 3D bouquet on a fixed canvas behind the page that frames itself into the `.stage-slot` in view, gathers and ties on load (new mix each visit, `?seed=` pins one), loosens in the flowers section (`data-stage="exploded"`), turns with scroll, follows the mouse slightly and reacts to buttons. No builder UI, no drag.

## Status

Built: hero, visit (address, hours, open-now), offer, photo slots (empty until the client sends photos, see comments in index.html), order form (Supabase-ready: `supabase/schema.sql`, `.env.example`; without env it says it is not connected), footer, phone action bar. `npm run verify` checks desktop and phone on software rendering; real phone frame rates untested. Live Google reviews need `VITE_GOOGLE_MAPS_KEY` (not set yet; the static 4,6 rating link works without it). Env vars reach the Pages build as GitHub repository Variables. Four colour themes (`data-theme` on html; the 3D backdrop is tuned to each `--ground`). Photos in `public/photos/` (`NN.webp` 800px, `NN-l.webp` 1800px, EXIF stripped). Future domain jonuciugeles.lt (canonical tags set; Pages build uses a sub-path).

## Stack

- Vite, TypeScript and vanilla Three.js (npm `three`, 0.187 at the time of writing). Use React Three Fiber only if the user asks for it.
- Playwright for browser checks, added when the project is scaffolded.

Commands: `npm run dev`, `npm run build`, `npm run typecheck`, `npx vitest run` (unit tests), `npm run verify` (Playwright walkthrough of the page on its own dev server, port 5175, screenshots in `.verify/`, `--filter=name`, fails on console errors or failed checks). Playwright is installed.

## Design decisions

- **Flowers are generated in code** from petal, stem and leaf parts, so the catalogue stays consistent in style and new varieties are cheap. Stylised is fine, but they must not look like plastic. Do not mix in downloaded models without asking the user.
- **Rendering:** physically based petals with sheen and backlit translucency, HDRI image-based lighting, soft shadows, ambient occlusion and subtle depth of field.
- **Explosion and assembly:** spring physics with small per-flower delays and some rotation, so stems fan out and settle organically. Motion must stay interruptible: reversing mid-animation or grabbing a moving flower should not jump.
- **Input:** the canvas never takes pointer input; scrolling and tapping belong to the page.
- **Bouquet shape:** the app opens on a ready-made bouquet. Dragged flowers stay in a believable arrangement, with stems converging at the binding point, and moves made while exploded carry through to reassembly.
- **Mood:** airy florist studio, with soft daylight, a warm paper-toned backdrop and editorial type, branded as Jonučių gėlės (olive #6d6a49 line-art rose lockup; transparent assets in public/brand/).
- **Environment map:** a CC0 HDRI bundled in the project and served locally, not fetched at runtime.
- **Performance:** target smooth frame rates on a mid-range phone. Share geometry and materials or use instancing across flowers, and make the expensive effects easy to scale down. Fake petal translucency in the shader rather than using `MeshPhysicalMaterial` transmission.
- **Copy:** short and plain; no explanations the visitor doesn't need.

## Verifying changes

Check changes in a real browser, not just with the type checker. Screenshots can't show motion, so for animation and drag work also step through the states (assembled, mid-explosion, exploded, mid-drag) and check the console for errors. Say so plainly if something could only be checked by eye or needs testing on a physical touch device.

Testing is on desktop PC for now, using simulated touch and throttling. Treat real touch feel and phone frame rates as untested, and report them that way.

## Skills

- `.claude/skills/threejs-*`: third-party Three.js reference, copied from CloudAI-X/threejs-skills (MIT, commit `0e18186`). It is written for r186, so check against the installed version if an API seems off. Treat these as vendored files and don't edit them.
- `frontend-design`, `impeccable`, `taste-skill`, `emil-design-eng` (user-level skills): page design and motion. The brief overrides taste-skill's place rules where they clash (real address and phone, WebGL bouquet).
