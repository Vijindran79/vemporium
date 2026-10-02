/**
 * Derives `public/models/child_base.glb` from `female_base.glb`.
 *
 * Why a derivative and not a download: there is no widely-mirrored,
 * licence-clean, directly-downloadable rigged child model. The female base
 * (Quaternius, CC0) is scaled to child stature with an enlarged head, which
 * is what actually reads as "child" (children have proportionally larger
 * heads, ~1:6 head-to-body vs ~1:7.5 adult).
 *
 * Transform (bind pose, commutes because both are uniform scales):
 *   - whole model x CHILD_SCALE (0.76): 1.065u -> ~0.81u (~129cm against a
 *     170cm adult reference)
 *   - Head joint x HEAD_SCALE (1.25) about its own origin: grows the skull,
 *     face and built-in hair together, so nothing detaches
 *
 * Run: `node scripts/derive-child.mjs` (reads/writes public/models/).
 * Re-run after replacing female_base.glb.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "public", "models", "female_base.glb");
const DST = join(ROOT, "public", "models", "child_base.glb");

const CHILD_SCALE = 0.76;
const HEAD_SCALE = 1.25;

const buf = readFileSync(SRC);
if (buf.subarray(0, 4).toString() !== "glTF") throw new Error("not a GLB");
const jsonLen = buf.readUInt32LE(12);
const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8"));
const binOff = 20 + jsonLen + 8;
const binLen = buf.readUInt32LE(20 + jsonLen + 4);
const bin = buf.subarray(binOff, binOff + binLen);

const fit = json.nodes.find((n) => n.name === "__fit");
if (!fit || !fit.scale) throw new Error("__fit node not found");
fit.scale = fit.scale.map((s) => s * CHILD_SCALE);

const head = json.nodes.find((n) => n.name === "Head");
if (!head) throw new Error("Head node not found");
head.scale = [HEAD_SCALE, HEAD_SCALE, HEAD_SCALE];

// Re-encode: header + JSON chunk (space-padded) + BIN chunk (zero-padded).
const jsonBytes = Buffer.from(JSON.stringify(json), "utf8");
const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
const binPad = (4 - (bin.length % 4)) % 4;
const out = Buffer.alloc(
  12 + 8 + jsonBytes.length + jsonPad + 8 + bin.length + binPad,
);
out.write("glTF", 0);
out.writeUInt32LE(2, 4);
out.writeUInt32LE(out.length, 8);
let o = 12;
out.writeUInt32LE(jsonBytes.length + jsonPad, o);
out.write("JSON", o + 4);
jsonBytes.copy(out, o + 8);
out.fill(0x20, o + 8 + jsonBytes.length, o + 8 + jsonBytes.length + jsonPad);
o += 8 + jsonBytes.length + jsonPad;
out.writeUInt32LE(bin.length + binPad, o);
out.write("BIN\x00", o + 4);
Buffer.from(bin).copy(out, o + 8);
writeFileSync(DST, out);

console.log(`wrote ${DST} (${out.length} bytes)`);
// Model-space anchor for hair (see src/lib/avatar-models.ts HEAD_ANCHOR.child):
// female anchor scaled by CHILD_SCALE, then pushed out from the scaled head
// joint by (HEAD_SCALE - 1) of its joint-relative offset... instead the exact
// value: joint scales too, so anchor_child = joint_child + (anchor - joint) * HEAD_SCALE * CHILD_SCALE.
const FEMALE_ANCHOR = [0.078, 0.86, -0.15];
const FEMALE_JOINT = [0.0137, 1.1951, -0.0856];
const jointChild = FEMALE_JOINT.map((v) => v * CHILD_SCALE);
const anchorChild = jointChild.map(
  (j, i) => j + (FEMALE_ANCHOR[i] - FEMALE_JOINT[i]) * HEAD_SCALE * CHILD_SCALE,
);
console.log(
  "child HEAD_ANCHOR = [" +
    anchorChild.map((v) => v.toFixed(4)).join(", ") +
    "]",
);
console.log("child approx height = " + (1.065 * CHILD_SCALE).toFixed(3));
