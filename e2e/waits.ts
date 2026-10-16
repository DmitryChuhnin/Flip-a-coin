/**
 * Longest wait for a toss to land. A frame moves a flight on by at most `MAX_FRAME_STEP_S`, 0.1 s,
 * so under 10 fps a flight takes longer than its own time: at 2 fps the longest flight,
 * `MAX_SIMULATED_S` = 6 s, takes 30 s.
 */
export const LANDING_MS = 40_000;
