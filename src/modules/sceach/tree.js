// Seeded wind-bent hawthorn + tobar ring, merged into ONE BufferGeometry (docs/DESIGN.md §10.7).
// Tree is generated in a local frame: +X = leeward (away from the loch), +Y = up, +Z = lateral.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const DEG = Math.PI / 180;

// Per branch level (0 = trunk … 5 = twigs). "depth 5" = five levels of children below the trunk.
// Everything is grown directly in metres: branch lengths are limited by the crown envelope, so the
// silhouette is a wind-sheared hawthorn dome without any post-scaling.
const LEVELS = 5;
const LEN = [1.5, 1.25, 0.95, 0.72, 0.52, 0.34];
const SEGS = [4, 3, 3, 2, 2, 2]; // polyline kinks → gnarled angular turns
const TUB = [14, 9, 6, 4, 3, 2]; // tubular segments per branch
const GNARL = [0.26, 0.34, 0.44, 0.52, 0.58, 0.66];
// Fork spread, in radians from the parent tangent. Hawthorn forks wide and irregularly, so the side
// children get a broad random band and every so often a near-right-angle elbow (WIDE).
const SPREAD = [0, 0.95, 0.92, 0.95, 1.0, 1.02];
const WIDE = [0, 0.3, 0.34, 0.34, 0.26, 0.2]; // chance of an extra-wide fork
// Chance of 3 children (else 2). A branching process this deep has a long tail: at 0.5/0.46 a
// run of twos on the first two levels left ~86 branches and a crown you could see through
// (seeds 42, 99). Raising the two levels that dominate the count lifts the floor without
// changing the dense seeds much — the crown envelope, not this, sets the silhouette.
const P3 = [0.75, 0.62, 0.56, 0.44, 0.38];
const OUT = [0, 0.1, 0.34, 0.42, 0.46, 0.4];
const WIND = [0.04, 0.05, 0.06, 0.05, 0.04, 0.03];
const UP = [0.35, 0.3, 0.14, 0.02, -0.06, -0.12];
// Radius at the tip of a branch as a fraction of its own base: a limb loses half its girth over its
// own length, and the taper is front-loaded (see the pow(u, 0.72) in the tube loop), so the outer
// half of every limb is thin wood carrying thorns — not a length of garden hose.
const TAPER = [0.5, 0.48, 0.46, 0.44, 0.42, 0.3];
const THORNS = [0, 2, 2, 2, 1, 0]; // spurs generated per branch, by level
// Fraction of a shoot's length over which it tapers out of its parent's girth (junction blend).
const JOIN_U = 0.22;
const RMIN = 0.011; // floor on tube radius: ~1 px of diameter at the default camera (§3.5)

// Crown envelope (local metres): centre on the lean axis, wind-clipped on the loch (windward, −X) side.
// Top = CROWN.y + ryUp = 4.6; apex x = 0.36 + 0.2·1.67 ≈ 4.6·tan 8°.
const CROWN = { x: 0.3, y: 2.93, shear: 0.24, rxLee: 2.2, rxWind: 1.95, ryUp: 1.67, ryDown: 1.62, rz: 2.2 };

function crownCx(y) {
  return CROWN.x + CROWN.shear * (y - CROWN.y);
}
function envelope(p) {
  const dx = p.x - crownCx(p.y);
  const dy = p.y - CROWN.y;
  const rx = dx >= 0 ? CROWN.rxLee : CROWN.rxWind;
  const ry = dy >= 0 ? CROWN.ryUp : CROWN.ryDown;
  // wind-carved lumps so the dome never reads as a lollipop
  const az = Math.atan2(p.z, dx);
  const el = Math.atan2(dy, Math.hypot(dx, p.z));
  const lump = 1 + 0.1 * Math.sin(3 * az + 1.3) * Math.cos(2 * el) + 0.07 * Math.sin(5 * az - 0.4 + 2 * el);
  const q = (dx / rx) ** 2 + (dy / ry) ** 2 + (p.z / CROWN.rz) ** 2;
  return q / (lump * lump);
}
/** Sway weight: 0 on the trunk, → 1 at the outer twigs. Position based, so it is continuous across joins. */
export function swayWeight(x, y, z) {
  const d = Math.hypot(x - 0.2, (y - 1.5) * 1.2, z);
  const w = Math.min(1, Math.max(0, (d - 0.6) / 2.2));
  return Math.pow(w, 1.3);
}

function hash3(x, y, z) {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

function addAttr(geo, name, value) {
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n);
  if (typeof value === 'function') for (let i = 0; i < n; i++) arr[i] = value(i);
  else arr.fill(value);
  geo.setAttribute(name, new THREE.BufferAttribute(arr, 1));
}

/**
 * @returns {{ geometry, anchors, twigs, crown: THREE.Vector3, apex: THREE.Vector3, basis: THREE.Matrix4, stats }}
 *   anchors: [{ pos: Vector3 (world), local: Vector3, sway }], ≥ 60 twig tips
 *   twigs:   [{ pos: Vector3 (world), sway, level }] points along the outer branches (blossom, foliage)
 */
export function buildTree({ rng, radialSegments, base, lee, heightAt, tobar, tobarRadius, height = 4.6, leanDeg = 8 }) {
  const t0 = performance.now();
  const branches = [];
  const tmp = new THREE.Vector3();
  const kick = new THREE.Vector3();
  const outward = new THREE.Vector3();
  const axisA = new THREE.Vector3();
  const axisB = new THREE.Vector3();
  const vScale = height / (CROWN.y + CROWN.ryUp);

  function pointAlong(pts, f, out) {
    const segF = f * (pts.length - 1);
    const i = Math.min(pts.length - 2, Math.floor(segF));
    return out.copy(pts[i]).lerp(pts[i + 1], segF - i);
  }
  function dirAlong(pts, f, out) {
    const segF = f * (pts.length - 1);
    const i = Math.min(pts.length - 2, Math.floor(segF));
    return out.subVectors(pts[i + 1], pts[i]).normalize();
  }
  /** Distance from p along d until the envelope value exceeds `limit` (0 if p is already outside). */
  function reach(p, d, limit, maxLen) {
    if (envelope(p) > limit) return 0;
    const step = Math.max(0.03, maxLen / 24);
    let s = 0;
    while (s < maxLen) {
      tmp.copy(p).addScaledVector(d, s + step);
      if (envelope(tmp) > limit) break;
      s += step;
    }
    return Math.min(s, maxLen);
  }

  /**
   * The clean taper curve of branch `b` at u ∈ [0,1]: no fork collar, no bark ripple. This is the
   * girth a parent actually has at a split, and it is what the child shoot is handed (`rJoin`), so
   * a junction is continuous by construction on every seed.
   */
  function branchRadiusClean(b, u) {
    const tipRatio = Math.min(0.95, b.r1 / Math.max(b.r0, 1e-4));
    let r = b.r0 * Math.pow(tipRatio, Math.pow(u, 0.72));
    if (b.level === 0) r *= 1 + 0.9 * Math.max(0, 1 - u / 0.16) ** 2; // root flare
    return r;
  }

  /**
   * Radius of branch `b` at parameter u ∈ [0,1]. Front-loaded taper (§10.7 "gnarled"): a hawthorn
   * limb sheds most of its girth in its first third, so the outer half is thin thorny wood rather
   * than a constant-diameter hose. Knots swell the limb where a child shoot leaves it — but only
   * as a shallow collar of wood:
   *  - collars take the strongest, never the product. Two forks 0.06 apart used to multiply into a
   *    ×2 sphere, which is what made seed 7 a bollard with beads threaded on it.
   *  - a shoot leaves its parent at exactly the parent's girth (`rJoin`) and tapers out of it over
   *    the first JOIN_U of its length, so the junction is a knuckle, never a step.
   * Both together guarantee a junction never widens past the parent's own girth.
   */
  function branchRadius(b, u) {
    let r = branchRadiusClean(b, u);
    let collar = 0;
    for (let fi = 0; fi < b.forks.length; fi++) {
      const dfk = (u - b.forks[fi]) / 0.085;
      collar = Math.max(collar, Math.exp(-dfk * dfk));
    }
    r *= 1 + 0.17 * collar;
    if (b.rJoin > 0 && u < JOIN_U) {
      const w = 1 - u / JOIN_U;
      r = Math.max(r, r + (b.rJoin - r) * (w * w * (3 - 2 * w)));
    }
    // Outer twigs thinner than a pixel at the default camera do not render as fine wood, they
    // render as nothing — and a whole outer lobe then reads as blossom floating free of the tree.
    // 1.1 cm of radius is ~1 px of diameter at 20 m, 1280×800: the thinnest wood that still draws.
    return Math.max(r, RMIN) * (1 + 0.16 * Math.sin(u * 9.3 + b.level * 2.1 + b.pts[0].y * 5.7));
  }

  /**
   * The trunk keeps to its 8° lean axis (§10.7): gnarled kinks, but no drift of the whole crown.
   * The first two segments are pinned to the axis within 1.4 cm, so the bole always leaves the
   * ground leaning away from the loch — the wind-bent read cannot be lost to a lucky kick on some
   * seed. Higher up the band opens to 13 cm so the bole still kinks.
   */
  function pinTrunk(pts) {
    const tl = Math.tan(leanDeg * DEG);
    for (let i = 0; i < pts.length; i++) {
      const q = pts[i];
      const yy = Math.max(0, q.y);
      const allow = i <= 2 ? 0.014 : Math.min(0.13, 0.014 + 0.058 * (i - 2));
      q.x = tl * yy + THREE.MathUtils.clamp(q.x - tl * yy, -allow, allow);
      q.z = THREE.MathUtils.clamp(q.z, -allow, allow);
    }
  }

  function steer(d, p, level) {
    outward.set(p.x - crownCx(p.y), (p.y - CROWN.y) * 0.35, p.z);
    if (outward.lengthSq() > 1e-6) d.addScaledVector(outward.normalize(), OUT[level]);
    d.x += WIND[level];
    d.y += UP[level];
    return d.normalize();
  }

  function grow(start, dir, level, r0, lenHint, rJoin = 0) {
    const segs = SEGS[level];
    const d = dir.clone();
    const limit = level === LEVELS ? 1.1 + 0.12 * rng() : 0.9 + 0.14 * rng();
    // The bole gets a tight length band: a hawthorn that forks at 0.8 m reads as a shrub, and the
    // §10.7 silhouette wants a visible leaning trunk under the crown on every seed.
    let want = (lenHint ?? LEN[level]) * (level === 0 ? 0.94 + 0.24 * rng() : 0.78 + 0.44 * rng());
    if (level >= 2) {
      if (envelope(start) > limit) {
        // started outside the skin (low on a limb): turn back into the crown and stay short
        outward.set(crownCx(start.y) - start.x, CROWN.y - start.y, -start.z).normalize();
        d.lerp(outward, 0.45).normalize();
        want *= 0.6;
      } else {
        let r = reach(start, steer(d.clone(), start, level), limit, want);
        if (r < want * 0.35) {
          // too close to the skin: bend along the surface instead of poking out
          outward.set(start.x - crownCx(start.y), start.y - CROWN.y, start.z).normalize();
          d.addScaledVector(outward, -d.dot(outward) * 1.1).normalize();
          r = Math.max(r, reach(start, d, limit, want));
        }
        want = Math.max(Math.min(want, r), level === LEVELS ? 0.12 : 0.18);
      }
    }
    const pts = [start.clone()];
    const p = start.clone();
    for (let s = 0; s < segs; s++) {
      kick.set(rng() * 2 - 1, (rng() * 2 - 1) * 0.6, rng() * 2 - 1).multiplyScalar(GNARL[level]);
      d.add(kick);
      steer(d, p, level);
      if (level === 0) {
        d.y = Math.max(d.y, 0.8);
        d.normalize();
      }
      p.addScaledVector(d, want / segs);
      pts.push(p.clone());
    }
    if (level === 0) pinTrunk(pts);
    const r1 = Math.max(0.004, r0 * TAPER[level]);
    const br = { pts, r0, r1, level, forks: [], rJoin };
    branches.push(br);
    if (level >= LEVELS) return;

    const pd = new THREE.Vector3();
    const sp = new THREE.Vector3();
    if (level === 0) {
      // low fork: 2–3 main limbs reaching for points spread through the crown
      const n = rng() < P3[0] ? 3 : 2;
      const az0 = rng() * Math.PI * 2;
      for (let c = 0; c < n; c++) {
        const az = az0 + (c * Math.PI * 2) / n + (rng() - 0.5) * 0.7;
        const el = (0.25 + 0.5 * rng()) * Math.PI * 0.5;
        const tx = crownCx(CROWN.y) + Math.cos(az) * Math.cos(el) * (Math.cos(az) > 0 ? CROWN.rxLee : CROWN.rxWind) * 0.5;
        const ty = CROWN.y + Math.sin(el) * CROWN.ryUp * 0.45 - 0.15;
        const tz = Math.sin(az) * Math.cos(el) * CROWN.rz * 0.5;
        // Side forks are spread deterministically along the bole; two of them landing 0.06 apart
        // used to stack their collars into a bead (seed 7's "bollard").
        const f = c === n - 1 ? 1 : 0.55 + (0.42 * (c + 0.22 + 0.56 * rng())) / (n - 1);
        br.forks.push(f);
        pointAlong(pts, f, sp);
        dirAlong(pts, Math.min(f, 0.999), pd);
        const cd = new THREE.Vector3(tx, ty, tz).sub(sp);
        const L = cd.length();
        cd.normalize();
        // the limb leaves at the girth the bole actually has here, then tapers out of it
        const rAt = branchRadiusClean(br, f);
        const cr = rAt * (c === n - 1 ? 0.76 : 0.6 + 0.1 * rng());
        grow(sp.clone().addScaledVector(pd, -rAt * 0.4), cd, 1, cr, L * (0.75 + 0.2 * rng()), rAt);
      }
      return;
    }
    const n = rng() < P3[level] ? 3 : 2;
    const az0 = rng() * Math.PI * 2;
    for (let c = 0; c < n; c++) {
      // the last child continues from the tip (sympodial hawthorn growth); others branch off the
      // side, spread deterministically so two collars never merge into a bead
      const f = c === n - 1 ? 1 : 0.34 + (0.56 * (c + 0.2 + 0.6 * rng())) / (n - 1);
      br.forks.push(f);
      pointAlong(pts, f, sp);
      dirAlong(pts, Math.min(f, 0.999), pd);
      axisA.set(0, 1, 0);
      if (Math.abs(pd.y) > 0.9) axisA.set(1, 0, 0);
      axisA.cross(pd).normalize();
      axisB.crossVectors(pd, axisA).normalize();
      const az = az0 + (c * Math.PI * 2) / n + (rng() - 0.5) * 0.9;
      // the continuation shoot only kinks; a side shoot leaves wide, and now and then at an elbow
      let spread = SPREAD[level] * (c === n - 1 ? 0.2 + 0.4 * rng() : 0.62 + 0.62 * rng());
      if (c !== n - 1 && rng() < WIDE[level]) spread = Math.min(1.45, spread * 1.5);
      const cd = pd
        .clone()
        .multiplyScalar(Math.cos(spread))
        .addScaledVector(axisA, Math.sin(spread) * Math.cos(az))
        .addScaledVector(axisB, Math.sin(spread) * Math.sin(az))
        .normalize();
      // the girth the parent actually has here (not a straight-line guess, which over-reads the
      // front-loaded taper by up to 15% and left the shoot standing proud of its own parent)
      const rAt = branchRadiusClean(br, f);
      const cr = rAt * (c === n - 1 ? 0.8 : 0.58 + 0.12 * rng());
      // start slightly inside the parent so joins never show a gap
      grow(sp.clone().addScaledVector(pd, -rAt * 0.5), cd, level + 1, cr, undefined, rAt);
    }
  }

  const trunkDir = new THREE.Vector3(Math.sin(leanDeg * DEG), Math.cos(leanDeg * DEG), (rng() - 0.5) * 0.1).normalize();
  grow(new THREE.Vector3(0, -0.12, 0), trunkDir, 0, 0.25, 1.3);

  // Crown fill. Three things go wrong on their own seeds. A branching process five levels deep has a
  // long tail, so some seeds come out with ~86 branches — a bole, two bare shoots and nothing to
  // hang a rag on (9, 42, 99). A low fork can throw its limbs into two lobes with a bare metre
  // between them, which at the climax flowers into a white clot that reads as a second little tree
  // floating beside the first (7). And the growth rules steer OUT and slightly UP, so when a seed
  // does run thin it runs thin at the TOP: seed 7 kept its wood in one low leeward lobe and left the
  // upper crown to two bare whips, which is the one shortfall you cannot miss — a tree reads by the
  // crown standing over its bole, and without it the sceach sank into the night in the right third
  // (§3.7, frame item 7). All three are the same lack: crown that no shoot reached. So instead of
  // forcing the odds at every fork (which would fatten the dense seeds too), find the emptiest place
  // inside the crown and grow a shoot into it from the nearest wood thick enough to carry one — and
  // keep going until the upper half is carried too, not just until the branch count looks healthy.
  {
    const MIN_BRANCHES = 185;
    // Ceiling, so a seed that keeps finding holes cannot grow its way out of the §11.1 budget
    // (≈ 30 triangles a branch at 5 radial segments, 18 at 3). Unassisted growth already reaches 320
    // on its densest seeds, and that is what the budget was measured against; the fill stops at 312
    // and spends its last headroom on level-3 hosts (a shoot off one of those brings ~4 branches
    // with it, where a level-1 host brings ~40), so the filled worst case stays under the grown one.
    const MAX_BRANCHES = 312;
    const DEEP_ONLY = MAX_BRANCHES - 45; // past this, only hosts that add a twig's worth of wood
    const GAP = 1.0;   // metres: no point inside the crown stays further than this from crown wood
    const FILL_R = 0.62;  // a sample this close to crown wood counts as crown that reads
    const UP_MIN = 0.78;  // that fraction of the samples ABOVE the crown centre has to read…
    const ALL_MIN = 0.7;  // …and the crown as a whole keeps its own, lower, floor
    const UP_BIAS = 1.25; // a hole above the centre outranks an equal hole below it
    const sp2 = new THREE.Vector3();
    const pd2 = new THREE.Vector3();
    const tip = new THREE.Vector3();
    let holeRaw = 0;
    // lattice of crown interior samples (local metres)
    const samples = [];
    let upTotal = 0;
    for (let ix = 0; ix < 8; ix++) {
      for (let iy = 0; iy < 8; iy++) {
        for (let iz = 0; iz < 8; iz++) {
          const p = new THREE.Vector3(
            CROWN.x - 2.0 + (4.4 * (ix + 0.5)) / 8,
            CROWN.y - 1.45 + (3.0 * (iy + 0.5)) / 8,
            -2.0 + (4.0 * (iz + 0.5)) / 8,
          );
          if (envelope(p) < 0.8) {
            samples.push(p);
            if (p.y > CROWN.y) upTotal++;
          }
        }
      }
    }
    // Occupancy is kept incrementally: `near[i]` is the squared distance from sample i to the
    // nearest piece of crown wood seen so far, and only the branches grown since the last pass are
    // folded in. The whole fill then costs one census of the tree instead of one per iteration, so
    // a finer lattice and a stricter target are cheaper than the old coarse ones were.
    const near = new Float64Array(samples.length).fill(Infinity);
    const census = new THREE.Vector3();
    let counted = 0;
    const absorb = () => {
      for (; counted < branches.length; counted++) {
        const b = branches[counted];
        if (b.level < LEVELS - 2) continue;
        for (let k = 0; k < 3; k++) {
          pointAlong(b.pts, 0.45 + 0.275 * k, census);
          for (let i = 0; i < samples.length; i++) {
            const d = samples[i].distanceToSquared(census);
            if (d < near[i]) near[i] = d;
          }
        }
      }
    };
    let guard = 0;
    while (guard++ < 60) {
      if (branches.length >= MAX_BRANCHES) break;
      absorb();
      // the emptiest crown sample, the upper crown weighted
      let hole = null;
      let holeD = -1;
      let upFilled = 0;
      let allFilled = 0;
      for (let i = 0; i < samples.length; i++) {
        const p = samples[i];
        const d = near[i];
        const up = p.y > CROWN.y;
        if (d < FILL_R * FILL_R) {
          allFilled++;
          if (up) upFilled++;
        }
        const score = up ? d * UP_BIAS * UP_BIAS : d;
        if (score > holeD) {
          holeD = score;
          hole = p;
          holeRaw = d;
        }
      }
      const upFill = upTotal ? upFilled / upTotal : 1;
      const allFill = allFilled / samples.length;
      const gap = Math.sqrt(Math.max(0, holeRaw));
      if (branches.length >= MIN_BRANCHES && (!hole || (gap <= GAP && upFill >= UP_MIN && allFill >= ALL_MIN))) break;
      // the nearest wood that can carry a shoot toward it
      let host = null;
      let bestScore = -Infinity;
      const minHost = branches.length > DEEP_ONLY ? 3 : 1;
      for (const b of branches) {
        if (b.level < minHost || b.level > 3) continue;
        tip.copy(b.pts[b.pts.length - 1]);
        const reachTo = hole ? tip.distanceTo(hole) : 0;
        // Once the tree has wood enough, lean toward a deeper host: a shoot off a level-1 limb
        // brings four more levels of children with it, and on the seeds that need the most filling
        // a few of those overshoot the budget. Deeper hosts close the last holes a twig at a time —
        // but the reach term still decides, so a hole nothing deep can carry still gets its limb.
        const deep = branches.length >= MIN_BRANCHES ? (4 - b.level) * 0.55 : 0;
        const score = -reachTo * 1.2 + b.r1 * 7 - b.forks.length * 0.5 - deep;
        if (score > bestScore) {
          bestScore = score;
          host = b;
        }
      }
      if (!host || !hole) break;
      const f = 0.42 + 0.46 * rng();
      host.forks.push(f);
      pointAlong(host.pts, f, sp2);
      dirAlong(host.pts, Math.min(f, 0.999), pd2);
      const cd = hole.clone().sub(sp2);
      const L = cd.length();
      if (L < 1e-3) break;
      cd.normalize();
      // keep the fork a fork: never fold the shoot back along its parent
      if (cd.dot(pd2) < -0.2) cd.addScaledVector(pd2, 0.5).normalize();
      const rAt = branchRadiusClean(host, f);
      grow(
        sp2.clone().addScaledVector(pd2, -rAt * 0.5),
        cd,
        host.level + 1,
        rAt * (0.56 + 0.12 * rng()),
        Math.max(0.3, L * (0.8 + 0.3 * rng())),
        rAt,
      );
    }
  }

  // exact apex height (tiny vertical correction only; the envelope already sets the shape)
  let apexY = -Infinity;
  for (const b of branches) for (const q of b.pts) apexY = Math.max(apexY, q.y);
  const sy = THREE.MathUtils.clamp((height * 0.985) / apexY, 0.85, 1.15) * vScale;
  for (const b of branches) for (const q of b.pts) q.y = q.y < 0 ? q.y : q.y * sy;
  // the rescale stretched y without touching x or z, which tilts the bole off its axis: re-pin it
  for (const b of branches) if (b.level === 0) pinTrunk(b.pts);

  // Re-centre the crown over its pickable proxy (§10.7: crown centre ≈ local (0.36, 2.93, 0)) with a
  // height-weighted shear: the trunk base stays put, the wind-streamed crown keeps its shape, and
  // every seed puts the twig mass over the column the proxy covers.
  const shift = { x: 0, z: 0 };
  {
    let cx = 0;
    let cz = 0;
    let n = 0;
    for (const b of branches) {
      if (b.level < LEVELS - 1) continue;
      const q = b.pts[b.pts.length - 1];
      cx += q.x;
      cz += q.z;
      n++;
    }
    if (n) {
      // The crown is wind-streamed, so its mass belongs LEEWARD of the bole — the correction only
      // has to keep it over the pickable column and on the lean axis laterally. The old version
      // yanked the twig centroid onto x = 0.55 with up to 1.5 m of shear: on sparse seeds that
      // pulled the whole crown back across the trunk toward the loch (killing the wind-bent read)
      // and stretched the limbs it sheared into long bare whips.
      shift.x = THREE.MathUtils.clamp(0.8 - cx / n, -0.55, 0.55);
      shift.z = THREE.MathUtils.clamp(-cz / n, -0.55, 0.55);
      for (const b of branches) {
        for (const q of b.pts) {
          const w = THREE.MathUtils.smoothstep(q.y, 1.15, 3.15);
          q.x += shift.x * w;
          q.z += shift.z * w;
        }
      }
    }
  }

  // Containment. Growth is clipped along a straight line by `reach`, but the per-segment kicks and
  // the re-centring shear can still throw a shoot clear of the dome, where it reads as a long bare
  // whip instead of a thorn crown (seeds 3, 5, 7, 9, 42, 99). This pulls stray points horizontally
  // back onto a shell a little outside the crown skin. The map is smooth in space and leaves the
  // bole and the low limbs alone, so a strayed limb bends home; it never kinks.
  {
    const EOUT = 1.3; // how far past the skin (in envelope units) a twig may still poke
    for (const b of branches) {
      for (const q of b.pts) {
        const dx = q.x - crownCx(q.y);
        const dy = (q.y - CROWN.y) / (q.y >= CROWN.y ? CROWN.ryUp : CROWN.ryDown);
        const a2 = EOUT - dy * dy; // horizontal budget left at this height
        const rx = dx >= 0 ? CROWN.rxLee : CROWN.rxWind; // the windward face stays the thinner one
        const h2 = (dx / rx) ** 2 + (q.z / CROWN.rz) ** 2;
        if (a2 <= 0 || h2 <= a2 || h2 < 1e-9) continue;
        const horiz = Math.hypot(dx, q.z);
        const w = THREE.MathUtils.smoothstep(horiz, 0.8, 1.3);
        if (w <= 0) continue;
        const s = 1 + (Math.sqrt(a2 / h2) - 1) * w;
        q.x = crownCx(q.y) + dx * s;
        q.z *= s;
      }
    }
  }

  // Local → world basis
  const ex = lee.clone().setY(0).normalize();
  const ey = new THREE.Vector3(0, 1, 0);
  const ez = new THREE.Vector3().crossVectors(ex, ey).normalize();
  const basis = new THREE.Matrix4().makeBasis(ex, ey, ez).setPosition(base);
  const toWorld = (v, out = new THREE.Vector3()) => out.copy(v).applyMatrix4(basis);

  // Tubes
  const tubes = [];
  let triangles = 0;
  let thornCount = 0;
  const center = new THREE.Vector3();
  for (const b of branches) {
    const curve = new THREE.CatmullRomCurve3(b.pts, false, 'catmullrom', 0.32);
    const tub = TUB[b.level];
    const geo = new THREE.TubeGeometry(curve, tub, 1, radialSegments, false);
    const pos = geo.attributes.position;
    const rad = new Float32Array(pos.count);
    const sway = new Float32Array(pos.count);
    const ring = radialSegments + 1;
    for (let i = 0; i <= tub; i++) {
      center.set(0, 0, 0);
      for (let j = 0; j < radialSegments; j++) {
        center.x += pos.getX(i * ring + j);
        center.y += pos.getY(i * ring + j);
        center.z += pos.getZ(i * ring + j);
      }
      center.multiplyScalar(1 / radialSegments);
      const u = i / tub;
      const r = branchRadius(b, u);
      for (let j = 0; j <= radialSegments; j++) {
        const k = i * ring + j;
        // gnarled burls on the old wood
        const burl = b.level <= 2 ? 1 + 0.24 * (hash3(center.x * 7.1, center.y * 5.3, j % radialSegments) - 0.5) : 1;
        const vx = center.x + (pos.getX(k) - center.x) * r * burl;
        const vy = center.y + (pos.getY(k) - center.y) * r * burl;
        const vz = center.z + (pos.getZ(k) - center.z) * r * burl;
        pos.setXYZ(k, vx, vy, vz);
        rad[k] = r;
        sway[k] = swayWeight(center.x, center.y, center.z);
      }
    }
    // bark uv: x = metres along the branch (for ridges), y = around
    const uv = geo.attributes.uv;
    const blen = curve.getLength();
    for (let k = 0; k < uv.count; k++) uv.setX(k, uv.getX(k) * blen);
    geo.setAttribute('aRad', new THREE.BufferAttribute(rad, 1));
    geo.setAttribute('aSway', new THREE.BufferAttribute(sway, 1));
    addAttr(geo, 'aType', 0);
    // keep TubeGeometry's radial normals (recomputing would crease the uv seam)
    tubes.push(geo);
    triangles += geo.index.count / 3;
  }
  // ---- Thorns. A sceach gheal is defined by its spurs: short, straight, pale, set just past the
  // forks on the young wood. Three flat-shaded faces each, so ~80 of them cost ~250 triangles.
  {
    const ta = new THREE.Vector3();
    const tbv = new THREE.Vector3();
    const td = new THREE.Vector3();
    const tp = new THREE.Vector3();
    const outv = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const tip = new THREE.Vector3();
    const ring3 = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    const e1 = new THREE.Vector3();
    const e2 = new THREE.Vector3();
    const nrm = new THREE.Vector3();
    const pos = [];
    const nor = [];
    const uvs = [];
    const idx = [];
    const rads = [];
    const sways = [];
    for (const b of branches) {
      for (let k = 0; k < THORNS[b.level]; k++) {
        if (b.level >= 4 && rng() > 0.5) continue;
        // just past a fork where there is one, else somewhere along the shoot
        const u =
          b.forks.length && rng() < 0.55
            ? Math.min(0.96, b.forks[Math.floor(rng() * b.forks.length)] + 0.05 + 0.1 * rng())
            : 0.2 + 0.7 * rng();
        pointAlong(b.pts, u, tp);
        dirAlong(b.pts, Math.min(u, 0.999), td);
        ta.set(0, 1, 0);
        if (Math.abs(td.y) > 0.9) ta.set(1, 0, 0);
        ta.cross(td).normalize();
        tbv.crossVectors(td, ta).normalize();
        const az = rng() * Math.PI * 2;
        outv.copy(ta).multiplyScalar(Math.cos(az)).addScaledVector(tbv, Math.sin(az)).normalize();
        const ang = 0.75 + 0.6 * rng(); // 43°–77° off the shoot
        dir.copy(td).multiplyScalar(Math.cos(ang)).addScaledVector(outv, Math.sin(ang)).normalize();
        const rr = branchRadius(b, u);
        const len = (0.085 + 0.075 * rng()) * (b.level <= 2 ? 1.2 : 0.9);
        const r0t = Math.max(0.008, rr * 0.6);
        tip.copy(tp).addScaledVector(dir, len);
        // base triangle in the plane across the thorn, seated a little inside the limb
        ta.set(0, 1, 0);
        if (Math.abs(dir.y) > 0.9) ta.set(1, 0, 0);
        ta.cross(dir).normalize();
        tbv.crossVectors(dir, ta).normalize();
        for (let j = 0; j < 3; j++) {
          const a = (j / 3) * Math.PI * 2 + az;
          ring3[j]
            .copy(tp)
            .addScaledVector(dir, -r0t * 0.6)
            .addScaledVector(ta, Math.cos(a) * r0t)
            .addScaledVector(tbv, Math.sin(a) * r0t);
        }
        const sw = swayWeight(tp.x, tp.y, tp.z);
        for (let j = 0; j < 3; j++) {
          const p0 = ring3[j];
          const p1 = ring3[(j + 1) % 3];
          e1.subVectors(p1, p0);
          e2.subVectors(tip, p0);
          nrm.crossVectors(e1, e2).normalize();
          const base = pos.length / 3;
          for (const q of [p0, p1, tip]) pos.push(q.x, q.y, q.z);
          for (let m = 0; m < 3; m++) {
            nor.push(nrm.x, nrm.y, nrm.z);
            rads.push(r0t);
            sways.push(sw);
          }
          uvs.push(0, 0, len, 0, len * 0.5, 1);
          idx.push(base, base + 1, base + 2);
        }
      }
    }
    if (idx.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      g.setAttribute('aRad', new THREE.Float32BufferAttribute(rads, 1));
      g.setAttribute('aSway', new THREE.Float32BufferAttribute(sways, 1));
      g.setIndex(idx);
      addAttr(g, 'aType', 4);
      tubes.push(g);
      triangles += idx.length / 3;
      thornCount = idx.length / 9;
    }
  }

  const treeGeo = mergeGeometries(tubes, false);
  for (const g of tubes) g.dispose();
  treeGeo.applyMatrix4(basis);

  // Anchors: the outermost twig tips (≥ 60 guaranteed by topping up from level 4)
  const anchors = [];
  const pushTip = (b) => {
    const local = b.pts[b.pts.length - 1].clone();
    anchors.push({ local, pos: toWorld(local), sway: swayWeight(local.x, local.y, local.z), rad: b.r1, limb: 0 });
  };
  for (const b of branches) if (b.level === LEVELS) pushTip(b);
  if (anchors.length < 60) for (const b of branches) if (b.level === LEVELS - 1 && anchors.length < 60) pushTip(b);

  // Reachable limb spots. A real rag tree is tied where a hand reaches: the two or three lowest
  // limbs, on wood thick enough to see the knot against. These join the anchor pool so ribbons
  // cluster there instead of floating off invisible twig tips.
  {
    const lp = new THREE.Vector3();
    for (const b of branches) {
      if (b.level < 1 || b.level > 4) continue;
      for (let k = 0; k < 3; k++) {
        const f = 0.25 + 0.65 * ((k + rng()) / 3);
        pointAlong(b.pts, f, lp);
        if (lp.y < 0.85 || lp.y > 2.95) continue;
        const rr = branchRadius(b, f);
        if (rr < 0.018) continue; // a rag hangs on wood you can see: 3.6 cm of limb, ~2 px at the default camera
        const local = lp.clone();
        anchors.push({ local, pos: toWorld(local), sway: swayWeight(local.x, local.y, local.z), rad: rr, limb: 1 });
      }
    }
  }

  // Twig sample points along outer branches (blossom, haws, foliage)
  const twigs = [];
  for (const b of branches) {
    if (b.level < 3) continue;
    const nS = b.level === 3 ? 2 : 3;
    for (let k = 0; k < nS; k++) {
      const f = 0.35 + 0.65 * ((k + rng()) / nS);
      const local = pointAlong(b.pts, f, new THREE.Vector3());
      twigs.push({ local, pos: toWorld(local), sway: swayWeight(local.x, local.y, local.z), level: b.level });
    }
  }

  // ---- tobar: ring of 9 displaced stones, dark water disc, rill to the shoreline (world space)
  const parts = [treeGeo];
  const ringStones = [];
  const toLoch = new THREE.Vector3(-tobar.x, 0, -tobar.z).normalize();
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2 + (rng() - 0.5) * 0.25;
    const cx = tobar.x + Math.cos(a) * tobarRadius;
    const cz = tobar.z + Math.sin(a) * tobarRadius;
    const sx = 0.13 + 0.06 * rng();
    const sy = 0.08 + 0.05 * rng();
    const sz = 0.11 + 0.05 * rng();
    const g = new THREE.SphereGeometry(1, 8, 5);
    const p = g.attributes.position;
    const seed = rng() * 100;
    for (let i = 0; i < p.count; i++) {
      tmp.fromBufferAttribute(p, i);
      const n1 = hash3(Math.round(tmp.x * 2) + seed, Math.round(tmp.y * 2), Math.round(tmp.z * 2));
      const flat = tmp.y < -0.2 ? 0.6 : 1; // flattened underside, sits in the turf
      tmp.multiplyScalar(0.82 + 0.3 * n1);
      tmp.set(tmp.x * sx, tmp.y * sy * flat, tmp.z * sz);
      p.setXYZ(i, tmp.x, tmp.y, tmp.z);
    }
    g.rotateY(-a + (rng() - 0.5) * 0.6);
    g.rotateZ((rng() - 0.5) * 0.25);
    g.translate(cx, heightAt(cx, cz) + sy * 0.35, cz);
    g.computeVertexNormals();
    addAttr(g, 'aType', 1);
    addAttr(g, 'aRad', 10);
    addAttr(g, 'aSway', 0);
    parts.push(g);
    ringStones.push(g);
    triangles += g.index.count / 3;
  }
  // water disc r 0.45, draped on the ground (+0.03) so a sloping bank never swallows it
  {
    const g = new THREE.CircleGeometry(0.45, 24);
    g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i) + tobar.x;
      const z = p.getZ(i) + tobar.z;
      p.setXYZ(i, x, heightAt(x, z) + 0.03, z);
    }
    g.deleteAttribute('normal');
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(p.count * 3).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    addAttr(g, 'aType', 2);
    addAttr(g, 'aRad', 10);
    addAttr(g, 'aSway', 0);
    parts.push(g);
    triangles += g.index.count / 3;
  }
  // rill: 0.15 m strip from the well rim (r 10.2) to the shoreline (r 9.25), meandering slightly
  {
    const N = 14;
    const start = new THREE.Vector3(tobar.x, 0, tobar.z).addScaledVector(toLoch, tobarRadius * 0.8);
    const rStart = Math.hypot(start.x, start.z);
    const endLen = Math.max(0.2, rStart - 9.15);
    const side = new THREE.Vector3(-toLoch.z, 0, toLoch.x);
    const posArr = [];
    const nrmArr = [];
    const uvArr = [];
    const idx = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const meander = 0.07 * Math.sin(t * Math.PI * 2.2 + 0.6) * Math.sin(t * Math.PI);
      const cx = start.x + toLoch.x * endLen * t + side.x * meander;
      const cz = start.z + toLoch.z * endLen * t + side.z * meander;
      const hw = 0.075 * (1 - 0.35 * t);
      for (const sgn of [-1, 1]) {
        const x = cx + side.x * hw * sgn;
        const z = cz + side.z * hw * sgn;
        posArr.push(x, heightAt(x, z) + 0.02, z);
        nrmArr.push(0, 1, 0);
        uvArr.push(t, sgn < 0 ? 0 : 1);
      }
      if (i < N) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrmArr, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvArr, 2));
    g.setIndex(idx);
    // winding: make the strip face up
    g.computeVertexNormals();
    if (g.attributes.normal.getY(0) < 0) {
      const ia = g.index.array;
      for (let i = 0; i < ia.length; i += 3) {
        const t1 = ia[i + 1];
        ia[i + 1] = ia[i + 2];
        ia[i + 2] = t1;
      }
    }
    const nn = g.attributes.normal;
    for (let i = 0; i < nn.count; i++) nn.setXYZ(i, 0, 1, 0);
    addAttr(g, 'aType', 3);
    addAttr(g, 'aRad', 10);
    addAttr(g, 'aSway', 0);
    parts.push(g);
    triangles += idx.length / 3;
  }

  const geometry = mergeGeometries(parts, false);
  for (const g of parts) g.dispose();
  geometry.computeBoundingSphere();

  const crown = toWorld(new THREE.Vector3(0.36, CROWN.y, 0)); // proxy centre: projects to (1011, 420) at the default camera (§3.5)
  const apex = toWorld(new THREE.Vector3(height * Math.tan(leanDeg * DEG), height, 0));
  return {
    geometry,
    anchors,
    twigs,
    crown,
    apex,
    basis,
    stats: {
      branches: branches.length,
      anchors: anchors.length,
      limbSpots: anchors.filter((a) => a.limb).length,
      twigs: twigs.length,
      thorns: thornCount,
      triangles,
      shift,
      ms: performance.now() - t0,
    },
  };
}
