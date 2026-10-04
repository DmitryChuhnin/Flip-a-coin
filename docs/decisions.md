# Decisions

Choices with a non-obvious alternative. Each entry says what was chosen and why the alternative
does not work.

## Outcome comes from a crypto RNG, not from the physics

`planToss` picks the side with `randomInt` over `crypto.getRandomValues` (rejection sampling, no
modulo bias) before anything is simulated. Physics only draws the flight. Letting the simulated
landing decide would make the odds depend on the model: hull shape, mass distribution, solver
tolerances and launch ranges. Close to fair for a symmetric coin, measurably uneven for shapes such as imperfect dice.
`Math.random` is not used for outcomes.

## The drawn coin is turned by a symmetry of its shape

After the simulation, `remapRotation` picks a rotation R from the coin's symmetry group (rotations
that map the convex hull onto itself) that brings the chosen face to where the landed face is. The
coin is drawn at `body · R`, so the silhouette, the contact with the table and the shadow at rest
match the simulated body exactly.

R is eased in during the part of the flight where the coin center is higher than its own radius,
around the axis closest to the current spin. Applying R from the first frame would visibly flip the
resting coin before it leaves the table; easing it in while airborne reads as a slightly faster
spin and cannot intersect the table.

## Prerecorded animations are not used

A fixed set of baked flights repeats visibly after a few tosses, and every flight would have to
start from one fixed rest pose. Each toss is simulated from where the coin lies.

## A coin resting on its edge is rejected and re-simulated

A coin has two outcomes, so a rest pose tilted more than 10° (leaning on its edge or against a
wall) is not a result. `planToss` rejects it, as well as a flight that has not settled after 6 s
simulated, and simulates again with a new launch. After three rejections it plays a trajectory
precomputed at startup, moved to where the coin lies and remapped to the chosen side.

## Physics world scale

Gravity is 20 units/s² rather than 9.81 with the coin about 1.2 units across. At a realistic scale
a toss would leave the frame; the tuned value gives an apex of about 3 units and a flight of about
one second.

## Rapier wasm is a separate file in production

`@dimforge/rapier3d-compat` ships its wasm inlined as base64, which runs unchanged in Node for unit
tests but gzips poorly. A build-only plugin in `vite.config.ts` moves the blob into a `.wasm` asset
that the same `init()` fetches. The build fails if a Rapier update moves the entry file or changes the inlined call.
The physics chunk is loaded with a dynamic import, so the scene renders before it arrives.
