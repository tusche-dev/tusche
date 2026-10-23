import { Composition } from 'remotion';
import { Demo, DURATION, FPS } from './Demo.tsx';

export const Root = () => (
  <Composition
    id="Demo"
    component={Demo}
    durationInFrames={DURATION}
    fps={FPS}
    width={1920}
    height={1080}
  />
);
