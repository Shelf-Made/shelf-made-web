import { describe, it, expect } from 'vitest';
import { FollowCamera } from './FollowCamera';

describe('scrolling out of first person', () => {
  it('adds up small steps out (a slow trackpad, a gentle pinch), and a step back in starts again', () => {
    const cam = new FollowCamera(16 / 9);
    cam.setFirstPerson(true);
    // A pinch out a little at a time: nothing for the first few steps, then back to the camera behind.
    const steps: ('in' | 'out' | null)[] = [];
    for (let i = 0; i < 12 && !steps.includes('out'); i++) steps.push(cam.zoom(1.005));
    expect(steps.indexOf('out')).toBeGreaterThan(3);
    cam.setFirstPerson(false); cam.setFirstPerson(true);
    // Out, then in again before it added up: still through the eyes.
    for (let i = 0; i < 6; i++) expect(cam.zoom(1.005)).toBe(null);
    expect(cam.zoom(0.99)).toBe(null);
    for (let i = 0; i < 6; i++) expect(cam.zoom(1.005)).toBe(null);
    cam.setFirstPerson(false); cam.setFirstPerson(true);
    // A notch of the wheel, or the zoom-out key, leaves at once.
    expect(cam.zoom(Math.exp(100 * 0.0011))).toBe('out');
    expect(cam.zoom(1.3)).toBe('out');
  });
});
