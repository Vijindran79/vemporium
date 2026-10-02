/**
 * Measures the head-joint-weighted vertices of a bundled base, per material.
 *
 * Answers the one question the hair generator needs and that eyeballing a
 * screenshot cannot: where exactly is the skull, how big is it, and how far
 * does the built-in hair extend beyond it. Run it when swapping a base model
 * and update src/lib/avatar-models.ts from the output.
 *
 *   node scripts/measure-skull.mjs [model.glb ...]
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const files = process.argv.slice(2);

for (const file of files.length
  ? files
  : [
      "public/models/female_base.glb",
      "public/models/male_base.glb",
      "public/models/child_base.glb",
    ]) {
  const buf = readFileSync(file);
  const gltf = await new GLTFLoader().parseAsync(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    "",
  );
  gltf.scene.updateMatrixWorld(true);

  console.log(`\n=== ${file} ===`);
  gltf.scene.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    // Skeleton.update() populates boneMatrices from the bones' current world
    // matrices; without it every transform below is identity, which is why an
    // earlier version of this script reported NaN for every measurement.
    o.skeleton.update();
    const sk = o.skeleton;
    const headJoint = sk.bones.findIndex((b) => /^head$/i.test(b.name));
    if (headJoint < 0) return;

    const pos = o.geometry.attributes.position;
    const si = o.geometry.attributes.skinIndex;
    const sw = o.geometry.attributes.skinWeight;
    const m = new THREE.Matrix4();
    const v = new THREE.Vector3();
    const t = new THREE.Vector3();
    const acc = new THREE.Vector3();
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    let n = 0;

    for (let i = 0; i < pos.count; i++) {
      let best = -1;
      let bw = -1;
      for (let k = 0; k < 4; k++) {
        const w = sw.getComponent(i, k);
        if (w > bw) {
          bw = w;
          best = si.getComponent(i, k);
        }
      }
      if (best !== headJoint) continue;

      v.fromBufferAttribute(pos, i);
      acc.set(0, 0, 0);
      for (let k = 0; k < 4; k++) {
        const w = sw.getComponent(i, k);
        if (!w) continue;
        m.fromArray(sk.boneMatrices, si.getComponent(i, k) * 16);
        t.copy(v).applyMatrix4(m).multiplyScalar(w);
        acc.add(t);
      }
      acc.applyMatrix4(o.matrixWorld);
      for (let a = 0; a < 3; a++) {
        // Read each component into a local before extending the bounds. Comparing
        // Math.min against `acc[a]` directly looks equivalent but is not: acc is
        // mutated again by the next loop iteration, and the earlier version of
        // this script reported NaN for every material as a result.
        const value = acc.getComponent(a);
        lo[a] = Math.min(lo[a], value);
        hi[a] = Math.max(hi[a], value);
      }
      n++;
    }

    const centre = lo.map((l, a) => +((l + hi[a]) / 2).toFixed(4));
    const half = lo.map((l, a) => +((hi[a] - l) / 2).toFixed(4));
    const name = (o.material?.name ?? "?").padEnd(6, ".");
    console.log(
      `${name} verts=${String(n).padStart(5)} centre=[${centre}] half=[${half}]`,
    );
  });
}
