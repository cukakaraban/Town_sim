import { TensorBasis, Vec2 } from '../model/types';
import { Noise2D } from './rng';
import { dot } from './geom';

export interface TensorMatrix {
  a: number; // T00
  b: number; // T01 (= T10)
}

export function encodeTensor(theta: number, scale = 1): TensorMatrix {
  const twoT = 2 * theta;
  return {
    a: scale * Math.cos(twoT),
    b: scale * Math.sin(twoT),
  };
}

export function tensorMagnitude(t: TensorMatrix): number {
  return Math.hypot(t.a, t.b);
}

export function evaluateBasisTensor(
  basis: TensorBasis,
  p: Vec2,
  noise?: Noise2D
): TensorMatrix {
  if (basis.kind === 'grid') {
    let angle = basis.angle;
    if (basis.warpStrength > 0 && noise) {
      const freq = basis.noiseFreq ?? 0.008;
      angle += noise.fbm(p.x * freq, p.y * freq, 2) * basis.warpStrength;
    }
    return encodeTensor(angle, basis.strength);
  }

  const dx = p.x - basis.center.x;
  const dy = p.y - basis.center.y;
  const r = Math.hypot(dx, dy);
  if (r < 1e-4) {
    return encodeTensor(basis.angle, basis.strength * 0.25);
  }

  let theta = Math.atan2(dy, dx);
  if (basis.kind === 'curved_radial') {
    // Gentle spiral/curved radial for post-war estates
    theta += 0.38 * Math.sin(r / Math.max(40, basis.size));
  }
  if (basis.warpStrength > 0 && noise) {
    theta += noise.fbm(p.x * 0.011, p.y * 0.011, 2) * basis.warpStrength;
  }
  return encodeTensor(theta, basis.strength);
}

/**
 * Evaluates the blended tensor field at point p using decaying Gaussian weights:
 * w_i = exp(-d * |p - c_i|^2), normalised by sum of weights.
 */
export function evaluateTensorField(
  bases: readonly TensorBasis[],
  p: Vec2,
  noise?: Noise2D
): TensorMatrix {
  if (bases.length === 0) return { a: 1, b: 0 };

  let sumA = 0;
  let sumB = 0;
  let weightSum = 0;

  for (let i = 0; i < bases.length; i++) {
    const basis = bases[i];
    const dx = p.x - basis.center.x;
    const dy = p.y - basis.center.y;
    const distSq = dx * dx + dy * dy;
    const w = Math.exp(-basis.decay * distSq);
    if (w < 1e-7) continue;

    const t = evaluateBasisTensor(basis, p, noise);
    sumA += t.a * w;
    sumB += t.b * w;
    weightSum += w;
  }

  if (weightSum < 1e-9) {
    return evaluateBasisTensor(bases[0], p, noise);
  }

  return {
    a: sumA / weightSum,
    b: sumB / weightSum,
  };
}

/**
 * Extracts major or minor unit eigen-direction at point p.
 * Keeps direction continuity by flipping when dot(prev, v) < 0.
 * Returns null if |T| < 1e-4 (degenerate point).
 */
export function sampleTensorDirection(
  bases: readonly TensorBasis[],
  p: Vec2,
  family: 'major' | 'minor',
  prevDir: Vec2 | null,
  noise?: Noise2D
): Vec2 | null {
  const t = evaluateTensorField(bases, p, noise);
  const mag = tensorMagnitude(t);
  if (mag < 1e-4) return null;

  let theta = 0.5 * Math.atan2(t.b, t.a);
  if (family === 'minor') {
    theta += Math.PI * 0.5;
  }

  let dir: Vec2 = { x: Math.cos(theta), y: Math.sin(theta) };
  if (prevDir && dot(prevDir, dir) < 0) {
    dir = { x: -dir.x, y: -dir.y };
  }
  return dir;
}

/**
 * Single RK4 integration step of fixed stepSize (e.g. 3 m).
 */
export function rk4Step(
  bases: readonly TensorBasis[],
  p: Vec2,
  stepSize: number,
  family: 'major' | 'minor',
  prevDir: Vec2,
  noise?: Noise2D
): { nextPos: Vec2; nextDir: Vec2 } | null {
  const k1 = sampleTensorDirection(bases, p, family, prevDir, noise);
  if (!k1) return null;

  const p2 = { x: p.x + k1.x * (stepSize * 0.5), y: p.y + k1.y * (stepSize * 0.5) };
  const k2 = sampleTensorDirection(bases, p2, family, k1, noise);
  if (!k2) return null;

  const p3 = { x: p.x + k2.x * (stepSize * 0.5), y: p.y + k2.y * (stepSize * 0.5) };
  const k3 = sampleTensorDirection(bases, p3, family, k2, noise);
  if (!k3) return null;

  const p4 = { x: p.x + k3.x * stepSize, y: p.y + k3.y * stepSize };
  const k4 = sampleTensorDirection(bases, p4, family, k3, noise);
  if (!k4) return null;

  const vx = (k1.x + 2 * k2.x + 2 * k3.x + k4.x) / 6;
  const vy = (k1.y + 2 * k2.y + 2 * k3.y + k4.y) / 6;
  const vLen = Math.hypot(vx, vy);
  if (vLen < 1e-6) return null;

  const nextDir = { x: vx / vLen, y: vy / vLen };
  return {
    nextPos: {
      x: p.x + nextDir.x * stepSize,
      y: p.y + nextDir.y * stepSize,
    },
    nextDir,
  };
}
