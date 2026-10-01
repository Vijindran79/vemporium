# GLB pipeline

How to author an avatar `.glb` the fitting room can parametrically resize, and
how to serve it.

## The rule that matters

**Do not let the code scale the whole mesh.** A uniform
`scale={[waist, 1, hips]}` on the root stretches the head, neck and arms along
with the torso, and renders anyone whose bust and hip differ as a barrel.

Instead the app scales **bones**, each normalised against the rig's rest pose.
So the rest pose must be a real, well-proportioned body — and its proportions
are what the shopper sees at their own reference measurements.

## Rest pose

Export the rig matching `RIG_REST` in `src/lib/rig.ts`:

| Measurement | Rest value |
| --- | --- |
| Height | 170 cm |
| Bust **or** chest | 90 cm (one shared value) |
| Waist | 70 cm |
| Hip | 95 cm |

There is deliberately only one rest girth. A rig is one mesh with one rest
pose, so it cannot have two. An earlier version used 96cm for menswear and
90cm for womenswear against the same rig, which quietly made a 110cm chest and
a 110cm bust scale differently.

## Bone names

Matched case-insensitively, first match wins. **Mixamo naming works as-is**
(`mixamorig:Hips`, `mixamorig:Spine`, …), so a retargeted Mixamo base needs no
renaming.

| Role | Matches | Responds to |
| --- | --- | --- |
| `hips` | `hips`, `pelvis` | hip girth, height |
| `spine` | `spine`, `waist` | waist depth |
| `chest` | `chest`, `torso`, `bust` | bust/chest girth |
| `shoulder` | `shoulder`, `clavicle` | bust/chest girth |
| `arm` | `upperarm`, `arm` | girth, height |
| `thigh` | `thigh`, `leg`, `upleg` | hip girth, height |

Missing bones are skipped, so a partial rig still works — ship a torso+legs
rig and the arms simply will not resize.

Scaling is applied to the **bone**, not the mesh, so children inherit the
transform and the skeleton stays connected.

## Export settings

```
Format:        glTF Binary (.glb)
Compression:   Draco  — mesh
Textures:      KTX2 / Basis — ~1/8 the size of PNG/JPEG
Skinning:      enabled, bind pose = the rest pose above
Materials:     name them anything; skin colour is applied by traversing
               every material, not by matching a name
Units:         metres (1 unit = 1 m)
```

Every scale term in `rig.ts` is written as `1 + (ratio - 1) * k`, so a body
matching the rest pose returns exactly `1.0` on every axis. A bare constant
multiplier deforms the rest pose instead of scaling it.

## Serving

Point `Product.modelAssetUrl` at the asset, or pass `modelUrl` to
`FittingRoomCanvas`. The app degrades safely at every step:

- no URL → procedural body
- URL 404s → procedural body (error boundary, not a blank canvas)
- loads but has no recognised bones → procedural body, unchanged

`preloadAvatar(url)` warms the `useGLTF` cache — call it on product hover so
the model is resident before the shopper opens the studio.

### Target budgets

| Asset | Target | Notes |
| --- | --- | --- |
| Base body `.glb` | < 1.5 MB | Draco + KTX2, one LOD |
| Garment `.glb` | < 400 KB | fabric detail is mostly normal-mapped |
| First paint | < 2.5 s mobile | PRD requirement; dpr already capped at 2 |

## Garment models

`GarmentMesh` still generates its drape procedurally from the same
`AvatarMetrics`, which is what keeps hems correctly placed against a changing
body. A garment `.glb` is an *overlay* on that shell, not a replacement: author
it against the rest pose above and let the shell own length and flare.

`Product.drapingProfile` (`{ pleatCount, flare, hemDrop }`) carries per-garment
overrides and is already in the schema.
