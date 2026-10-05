# Flip a Coin

A casual mobile-first browser game: a 3D coin lies on a table, and a tap tosses it. Built with
three.js, TypeScript and Vite. The production build is served from `/flip-a-coin/`.

Dice are available behind a temporary URL parameter until the game has its own selector:
`?item=d4`, `d6`, `d8`, `d10`, `d12` or `d20`. A missing or unknown value gives the coin.

## Requirements

Node.js 24 (see `.nvmrc`).

## Commands

```sh
npm ci                          # install dependencies
npm run dev                     # dev server with hot reload
npx playwright install chromium # once, before the first `npm run check`
npm run check                   # typecheck, lint, format check, unit tests, build + e2e tests
```

Separate steps: `npm run typecheck`, `npm run lint`, `npm run format`, `npm test`,
`npm run build`, `npm run preview`, `npm run test:e2e` (builds, then runs Playwright against the
preview server).

## Layout

- `src/main.ts`: entry point; WebGL2 check, render loop, pause while the tab is hidden.
- `src/game.ts`: toss states (`loading`, `idle`, `flying`, `result`, `error`), tap and Space/Enter
  input, result announcement and the rolled number caption, camera moves. Exposes
  `data-toss-state`, `data-toss-count` and `data-item` on `<body>`.
- `src/items.ts`: the tossable items (coin and dice), the `?item=` selector, announcements.
- `src/scene/createScene.ts`: renderer, camera, resize handling.
- `src/scene/studio.ts`: the lilac studio backdrop, lights and the environment map.
- `src/scene/contactShadow.ts`: the soft spot under the body that stands in for a shadow map.
- `src/scene/camera.ts`: camera views: the close-up on a resting body, a view that fits a set of
  points for any aspect ratio, and the wide view of the whole table;
  `src/scene/shots.ts` moves the camera between them on launch and landing.
- `src/coin/`: coin dimensions, convex hull, faces and symmetries (`coinSpec.ts`) and the
  procedural three.js mesh (`coinMesh.ts`).
- `src/dice/`: d4 to d20 shapes, numbering, faces and rest poses (`dieSpec.ts`) and the mesh with
  a number texture atlas (`dieMesh.ts`).
- `src/math/`: quaternions (`quat.ts`), convex faces and chamfering (`polyhedron.ts`), rotation
  groups of point sets (`symmetry.ts`).
- `src/random.ts`: uniform integers from `crypto.getRandomValues`.
- `src/physics/`: Rapier world for one toss (`simulate.ts`) and the recorded frame format
  (`frames.ts`).
- `src/toss/`: body definition and validation (`body.ts`), launch profiles, toss planning with rejection and fallback (`planToss.ts`), face
  remapping by shape symmetry (`faces.ts`), playback (`playback.ts`). `engine.ts` is the lazily
  loaded entry for the physics chunk.
- `docs/decisions.md`: design decisions and the alternatives they rule out.
- `e2e/`: Playwright tests on a mobile Chromium profile.
