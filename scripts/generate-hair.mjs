/**
 * Generates the five hairstyle GLBs in `public/models/hair/`.
 *
 * Why generated and not downloaded: there is no widely-mirrored,
 * licence-clean, directly-downloadable set of separate-hair-piece GLBs that
 * fits these base models. These meshes are authored to match the bundled
 * Quaternius-derived bases (stylised, smooth-shaded) and are ours outright,
 * so there is no licence to comply with.
 *
 * Coordinate frame ("head space"): origin = head centre, +Y up, +Z toward
 * the face, in BASE FILE UNITS (not metres). The bundled bases are authored
 * at ~0.72 m per unit with big stylised skulls (half-width ~0.17 units), so
 * metre-sized hair would bury itself inside the skull — every dimension below
 * is fitted to the measured skull: Rx 0.17, Ry 0.185, Rz 0.175, face plane
 * near +Z. The runtime (`HairAttachment` in AvatarAsset.tsx) places each
 * style at the per-model head anchor (src/lib/avatar-models.ts), so one set
 * of files fits female, male and child bases.
 *
 * Run: `node scripts/generate-hair.mjs`. Re-runnable; overwrites outputs.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Document, NodeIO } from "@gltf-transform/core";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public", "models", "hair");

// Measured skull half-extents from scripts/measure-skull.mjs: the adult bases
// share [0.179, 0.185, 0.177] and the child [0.130, 0.134, 0.128]. The caps are
// cut at these radii plus GROMMET — the margin has to clear the skull, or the
// whole cap renders buried inside it and the avatar looks bald.
const RX = 0.179;
const RY = 0.185;
const RZ = 0.177;
/** Clearance between the skull surface and the inside of the cap, in units. */
const GROMMET = 0.022;

/** Indexed triangle soup builder with smooth (averaged) normals. */
function createBuilder() {
  const positions = [];
  const indices = [];
  return {
    positions,
    indices,
    vert(x, y, z) {
      positions.push(x, y, z);
      return positions.length / 3 - 1;
    },
    tri(a, b, c) {
      indices.push(a, b, c);
    },
    /** Wraps a parametric grid fn(u, v) -> [x, y, z]; skips cells where cut(u, v). */
    grid(nu, nv, fn, cut = null, flip = false) {
      const rows = [];
      for (let j = 0; j <= nv; j++) {
        const row = [];
        for (let i = 0; i <= nu; i++)
          row.push(this.vert(...fn(i / nu, j / nv)));
        rows.push(row);
      }
      for (let j = 0; j < nv; j++) {
        for (let i = 0; i < nu; i++) {
          const u = (i + 0.5) / nu;
          const v = (j + 0.5) / nv;
          if (cut && cut(u, v)) continue;
          const a = rows[j][i];
          const b = rows[j][i + 1];
          const c = rows[j + 1][i];
          const d = rows[j + 1][i + 1];
          if (!flip) (this.tri(a, c, b), this.tri(b, c, d));
          else (this.tri(a, b, c), this.tri(b, d, c));
        }
      }
    },
    computeNormals() {
      const normals = new Array(positions.length).fill(0);
      const sub = (p, q) => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
      const cross = (p, q) => [
        p[1] * q[2] - p[2] * q[1],
        p[2] * q[0] - p[0] * q[2],
        p[0] * q[1] - p[1] * q[0],
      ];
      const at = (i) => [
        positions[i * 3],
        positions[i * 3 + 1],
        positions[i * 3 + 2],
      ];
      for (let t = 0; t < indices.length; t += 3) {
        const [a, b, c] = [
          at(indices[t]),
          at(indices[t + 1]),
          at(indices[t + 2]),
        ];
        const n = cross(sub(b, a), sub(c, a));
        for (const i of [indices[t], indices[t + 1], indices[t + 2]]) {
          normals[i * 3] += n[0];
          normals[i * 3 + 1] += n[1];
          normals[i * 3 + 2] += n[2];
        }
      }
      for (let i = 0; i < normals.length; i += 3) {
        const l = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
        normals[i] /= l;
        normals[i + 1] /= l;
        normals[i + 2] /= l;
      }
      return normals;
    },
  };
}

const V3 = (x, y, z) => [x, y, z];

/**
 * Scalp cap: ellipsoid shell over the skull, opened only where the face is.
 *
 * `drop` = how far below the equator the rim falls (radians of polar angle past
 * PI/2); `faceCut` = half-width in radians of azimuth around +Z left open.
 *
 * The hairline matters: a cap that stops high on the forehead reads as a bald
 * avatar from the front, which is exactly what happened when these were first
 * cut at theta > 1.05 (only below ~30 degrees from horizontal). Cutting from
 * theta > 0.80 instead brings the rim down to the natural hairline, so the
 * built-in hair can be hidden entirely and the replacement looks like hair
 * rather than a swim cap perched on the crown.
 */
function scalpCap(b, { drop = 0.35, faceCut = 0.6, fatness = 1 } = {}) {
  // Skirt plus grommet: the hairline sits off the skull surface, not on it.
  const rx = (RX + GROMMET) * fatness;
  const ry = (RY + GROMMET) * fatness;
  const rz = (RZ + GROMMET) * fatness;
  const thetaMax = Math.PI / 2 + drop;
  b.grid(
    40,
    22,
    (u, v) => {
      // Azimuth: 0 at +Z (face), wrapping around the back. Seam lands at the
      // back centre where long styles cover it.
      const phi = u * Math.PI * 2;
      const theta = v * thetaMax;
      const x = Math.sin(theta) * Math.sin(phi) * rx;
      const y = Math.cos(theta) * ry;
      const z = Math.sin(theta) * Math.cos(phi) * rz;
      return V3(x, y, z);
    },
    (u, v) => {
      const phi = u * Math.PI * 2;
      const ang = Math.atan2(Math.sin(phi), Math.cos(phi)); // -PI..PI, 0 at face
      const theta = v * thetaMax;
      return Math.abs(ang) < faceCut && theta > 0.8;
    },
    true,
  );
}

/** Full ellipsoid (bun, knot, beads). */
function ellipsoid(b, center, radii, nu = 20, nv = 14) {
  b.grid(
    nu,
    nv,
    (u, v) => {
      const phi = u * Math.PI * 2;
      const theta = v * Math.PI;
      return V3(
        center[0] + Math.sin(theta) * Math.sin(phi) * radii[0],
        center[1] + Math.cos(theta) * radii[1],
        center[2] + Math.sin(theta) * Math.cos(phi) * radii[2],
      );
    },
    null,
    true,
  );
}

/** Torus around Y (turban band, hair tie). */
function torusY(b, R, r, y, tilt = 0, nu = 28, nv = 12) {
  b.grid(
    nu,
    nv,
    (u, v) => {
      const a = u * Math.PI * 2;
      const t = v * Math.PI * 2;
      const x = (R + r * Math.cos(t)) * Math.sin(a);
      const z = (R + r * Math.cos(t)) * Math.cos(a);
      let yv = y + r * Math.sin(t);
      // Tilt about X so the band sits asymmetric like a wrapped pagdi.
      const z2 = z * Math.cos(tilt) - (yv - y) * Math.sin(tilt);
      yv = y + z * Math.sin(tilt) + (yv - y) * Math.cos(tilt);
      return V3(x, yv, z2);
    },
    null,
    true,
  );
}

const STYLES = {
  // Chin-length bob: cap with a deeper rim, no extras.
  short: (b) => scalpCap(b, { drop: 0.55, faceCut: 0.7 }),
  // Long fall down the back: cap + curved curtain sheet (double-sided).
  long: (b) => {
    scalpCap(b, { drop: 0.3, faceCut: 0.7 });
    b.grid(
      18,
      16,
      (u, v) => {
        const x = (u - 0.5) * (0.24 + v * 0.08);
        const y = 0.1 - v * 0.6;
        // Bow outward as it falls so it clears the neck/shoulders.
        const z =
          -0.16 - Math.sin(v * Math.PI * 0.5) * 0.14 - Math.abs(u - 0.5) * 0.05;
        return V3(x, y, z);
      },
      null,
      false,
    );
  },
  // Top bun: cap + gathered sphere high on the back of the crown.
  bun: (b) => {
    scalpCap(b, { drop: 0.3, faceCut: 0.7 });
    ellipsoid(b, [0, 0.16, -0.21], [0.095, 0.1, 0.095]);
  },
  // Three-strand-look braid: alternating offset beads tapering down the back.
  braid: (b) => {
    scalpCap(b, { drop: 0.3, faceCut: 0.7 });
    const segs = 8;
    for (let i = 0; i < segs; i++) {
      const t = i / (segs - 1);
      const x = (i % 2 === 0 ? 1 : -1) * 0.026 * (1 - t * 0.5);
      const y = 0.0 - t * 0.48;
      const z = -0.2 - Math.sin(t * Math.PI * 0.55) * 0.08;
      const r = 0.048 * (1 - t * 0.55);
      ellipsoid(b, [x, y, z], [r * 1.15, r * 0.9, r], 12, 8);
    }
    ellipsoid(b, [0, -0.5, -0.25], [0.02, 0.03, 0.02], 8, 6); // tie bead
  },
  // Turban/pagdi: full wrap dome + tilted band + front knot. Covers the whole
  // skull (no face cut) — reads instantly as headwear, not hair.
  turban: (b) => {
    // Pagdi wraps the whole skull, so it needs real volume over the cap's own
    // grommet: a fat multiplier rather than the tight cap radii.
    scalpCap(b, { drop: 0.75, faceCut: 0.0, fatness: 1.24 });
    torusY(b, 0.19, 0.048, 0.05, 0.35);
    ellipsoid(b, [0.055, 0.16, 0.15], [0.054, 0.064, 0.054]);
  },
};

async function main() {
  const io = new NodeIO();
  for (const [name, build] of Object.entries(STYLES)) {
    const b = createBuilder();
    build(b);
    const normals = b.computeNormals();
    const doc = new Document();
    const buffer = doc.createBuffer();
    const posAcc = doc
      .createAccessor()
      .setType("VEC3")
      .setArray(new Float32Array(b.positions))
      .setBuffer(buffer);
    const nrmAcc = doc
      .createAccessor()
      .setType("VEC3")
      .setArray(new Float32Array(normals))
      .setBuffer(buffer);
    const idxAcc = doc
      .createAccessor()
      .setType("SCALAR")
      .setArray(new Uint32Array(b.indices))
      .setBuffer(buffer);
    const mat = doc
      .createMaterial("Hair")
      .setBaseColorFactor([1, 1, 1, 1])
      .setRoughnessFactor(0.55)
      .setMetallicFactor(0)
      .setDoubleSided(true);
    const prim = doc
      .createPrimitive()
      .setAttribute("POSITION", posAcc)
      .setAttribute("NORMAL", nrmAcc)
      .setIndices(idxAcc)
      .setMaterial(mat);
    const mesh = doc.createMesh(name).addPrimitive(prim);
    doc.createNode(name).setMesh(mesh);
    doc.createScene("scene").addChild(doc.getRoot().listNodes()[0]);
    const out = join(OUT, `${name}.glb`);
    writeFileSync(out, Buffer.from(await io.writeBinary(doc)));
    console.log(
      `wrote ${name}.glb (${b.positions.length / 3} verts, ${b.indices.length / 3} tris)`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
