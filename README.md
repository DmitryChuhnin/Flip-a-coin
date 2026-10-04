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
- `src/scene/createScene.ts`: renderer, table, lights, resize handling.
- `src/scene/camera.ts`: camera placement that keeps the play zone on the table fully in view
  for any aspect ratio.
- `e2e/`: Playwright smoke tests on a mobile Chromium profile.
