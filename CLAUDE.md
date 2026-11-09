# Flowers: 3D bouquet builder

A local demo to find out how hard it is to build a website where people assemble a flower bouquet themselves. It runs locally only, with no hosting, backend, accounts or checkout. Prioritise how it looks and feels to use over production concerns.

## Status

Built and running locally: the stage (renderer, HDRI, lighting, backdrop, quality tiers with an automatic frame-time downgrade), camera rig, five generated varieties, the bouquet (starter bouquet of 17, spring-driven explode and reassemble, drag, add and remove, raffia twine at the binding point), Pointer Events input and the UI (catalogue panel on wide screens, bottom sheet on narrow). The bouquet is framed in the area the UI leaves free. `npm run verify` drives the real app with real mouse input and simulated touch (CDP), not a physical device. Real touch feel and phone frame rates are untested; all browser checks so far ran on software rendering, which is slow (0.3 to 1 s per frame), so smoothness is unjudged.

## What it must do

- Render the bouquet live in real 3D and view it from any angle.
- Explode the bouquet so each flower can be seen separately, and reassemble it. This is the signature interaction, so it must feel great.
- Pick a flower, then move it by touching and dragging, or remove it.
- Add flowers from a catalogue.
- Work with both touch and mouse.

## Stack

- Vite, TypeScript and vanilla Three.js (npm `three`, 0.187 at the time of writing). Use React Three Fiber only if the user asks for it.
- Playwright for browser checks, added when the project is scaffolded.

Commands: `npm run dev`, `npm run build`, `npm run typecheck`, `npx vitest run` (unit tests), `npm run verify` (Playwright walkthrough on its own non-reloading dev server, port 5175, screenshots in `.verify/`, `--filter=name` to run one scenario, fails on console errors or failed checks). Playwright is installed.

## Design decisions

- **Flowers are generated in code** from petal, stem and leaf parts, so the catalogue stays consistent in style and new varieties are cheap. Stylised is fine, but they must not look like plastic. Do not mix in downloaded models without asking the user.
- **Rendering:** physically based petals with sheen and backlit translucency, HDRI image-based lighting, soft shadows, ambient occlusion and subtle depth of field.
- **Explosion and assembly:** spring physics with small per-flower delays and some rotation, so stems fan out and settle organically. Motion must stay interruptible: reversing mid-animation or grabbing a moving flower should not jump.
- **Input:** dragging a flower moves it straight away, and tapping it selects it and shows Remove. In the assembled bouquet, moving a flower needs a short press first, so a quick swipe orbits instead. Dragging empty space orbits the camera, and pinching zooms. Use Pointer Events so touch and mouse share one code path.
- **Bouquet shape:** the app opens on a ready-made bouquet. Dragged flowers stay in a believable arrangement, with stems converging at the binding point, and moves made while exploded carry through to reassembly.
- **Catalogue:** start with 4-5 distinct varieties, for example rose, tulip, daisy, peony and a filler such as eucalyptus.
- **Mood:** airy florist studio, with soft daylight, a warm paper-toned backdrop and editorial type, branded as Jonučių gėlės (olive #6d6a49 line-art rose lockup; transparent assets in public/brand/).
- **Environment map:** a CC0 HDRI bundled in the project and served locally, not fetched at runtime.
- **Performance:** target smooth frame rates on a mid-range phone. Share geometry and materials or use instancing across flowers, and make the expensive effects easy to scale down. Fake petal translucency in the shader rather than using `MeshPhysicalMaterial` transmission.
- **Saving:** bouquets don't persist between page loads.

## Verifying changes

Check changes in a real browser, not just with the type checker. Screenshots can't show motion, so for animation and drag work also step through the states (assembled, mid-explosion, exploded, mid-drag) and check the console for errors. Say so plainly if something could only be checked by eye or needs testing on a physical touch device.

Testing is on desktop PC for now, using simulated touch and throttling. Treat real touch feel and phone frame rates as untested, and report them that way.

## Skills

- `.claude/skills/threejs-*`: third-party Three.js reference, copied from CloudAI-X/threejs-skills (MIT, commit `0e18186`). It is written for r186, so check against the installed version if an API seems off. Treat these as vendored files and don't edit them.
- `frontend-design` plugin: for the catalogue and the interface around the 3D view.
