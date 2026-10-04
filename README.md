# Flip a Coin

A casual mobile-first browser game: a 3D coin lies on a table, and a tap tosses it. Built with
three.js, TypeScript and Vite. The production build is served from `/flip-a-coin/`.

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
  input, result announcement, camera dolly. Exposes `data-toss-state` and `data-toss-count` on
  `<body>`.
- `src/scene/createScene.ts`: renderer, table, lights, resize handling.
- `src/scene/camera.ts`: camera placement that keeps the play zone on the table fully in view
  for any aspect ratio; `src/scene/dolly.ts` moves it toward the coin after a toss.
- `src/coin/`: coin dimensions, convex hull, faces and symmetries (`coinSpec.ts`) and the
  procedural three.js mesh (`coinMesh.ts`).
- `src/random.ts`: uniform integers from `crypto.getRandomValues`.
- `src/physics/`: Rapier world for one toss (`simulate.ts`) and the recorded frame format
  (`frames.ts`).
- `src/toss/`: launch profiles, toss planning with rejection and fallback (`planToss.ts`), face
  remapping by shape symmetry (`faces.ts`), playback (`playback.ts`). `engine.ts` is the lazily
  loaded entry for the physics chunk.
- `docs/decisions.md`: design decisions and the alternatives they rule out.
- `e2e/`: Playwright tests on a mobile Chromium profile.
