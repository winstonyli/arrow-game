export type Stepper = ReturnType<typeof createStepper>;

export function createStepper(hz = 60, maxSteps = 5) {
  const dt = 1 / hz;
  let acc = 0;
  return {
    dt,
    advance(frameDt: number): number {
      acc += frameDt;
      let n = Math.floor(acc / dt + 1e-9);
      if (n > maxSteps) {
        n = maxSteps;
        acc = 0;
      } else {
        acc -= n * dt;
      }
      return n;
    },
  };
}

export function startLoop(
  stepper: Stepper,
  step: (dt: number) => void,
  render: () => void,
): void {
  let last = performance.now();
  function frame(now: number): void {
    const n = stepper.advance((now - last) / 1000);
    last = now;
    for (let i = 0; i < n; i++) step(stepper.dt);
    render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
