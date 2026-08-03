
struct Blade {
  data0 : vec4f,
  data1 : vec4f,
  data2 : vec4f,
  data3 : vec4f,
};
struct CullParams {
  eye : vec3f,
  blade_count : u32,
  view_proj : mat4x4f,
  lod0_max : f32,
  lod1_max : f32,
  far_max : f32,
  _pad1 : f32,
};
struct DrawIndirect {
  vertexCount : u32,
  instanceCount : atomic<u32>,
  firstVertex : u32,
  firstInstance : u32,
};

// Group 0: blades READ-ONLY only. Group 1: writable LOD + draws (never alias blades).
@group(0) @binding(0) var<storage, read> blades_ro : array<Blade>;
@group(0) @binding(1) var<uniform> cull : CullParams;

@group(1) @binding(0) var<storage, read_write> lod0 : array<u32>;
@group(1) @binding(1) var<storage, read_write> lod1 : array<u32>;
@group(1) @binding(2) var<storage, read_write> lod2 : array<u32>;
@group(1) @binding(3) var<storage, read_write> draws : array<DrawIndirect, 3>;

@compute @workgroup_size(256)
fn cull_lod(@builtin(global_invocation_id) id : vec3u) {
  let i = id.x;
  if (i >= cull.blade_count) { return; }
  let pos = blades_ro[i].data0.xyz;
  if (blades_ro[i].data1.y < 0.04) { return; }

  let dist = length(pos - cull.eye);
  if (dist > cull.far_max) { return; }

  // FPV look-down: testing only tip at +1.55 puts the sample behind the neck
  // cam and culled the whole blade → hard grass cut across the screen.
  // Keep near blades; farther ones use base OR tip frustum test.
  if (dist > 2.8) {
    let base = pos + vec3f(0.0, 0.25, 0.0);
    let tip = pos + vec3f(0.0, 1.05, 0.0);
    let cb = cull.view_proj * vec4f(base, 1.0);
    let ct = cull.view_proj * vec4f(tip, 1.0);
    var ok = false;
    if (cb.w > 0.04) {
      let nb = cb.xyz / cb.w;
      if (abs(nb.x) <= 1.45 && abs(nb.y) <= 1.45 && nb.z >= -0.05 && nb.z <= 1.05) {
        ok = true;
      }
    }
    if (!ok && ct.w > 0.04) {
      let nt = ct.xyz / ct.w;
      if (abs(nt.x) <= 1.45 && abs(nt.y) <= 1.45 && nt.z >= -0.05 && nt.z <= 1.05) {
        ok = true;
      }
    }
    if (!ok) { return; }
  }

  let noise = fract(f32(i) * 0.12345) * 2.0 - 1.0;
  let nd = dist + noise * dist * 0.04;
  // Aggressive thin outside the HQ bubble (geometry density only — same blade shader)
  if (nd >= cull.lod1_max) {
    let keep = fract(f32(i) * 0.754877666 + f32(i / 97u) * 0.312);
    let dens = select(0.22, 0.09, nd > cull.lod1_max * 1.35);
    if (keep > dens) { return; }
  }

  if (nd < cull.lod0_max) {
    let slot = atomicAdd(&draws[0].instanceCount, 1u);
    lod0[slot] = i;
  } else if (nd < cull.lod1_max) {
    let slot = atomicAdd(&draws[1].instanceCount, 1u);
    lod1[slot] = i;
  } else {
    let slot = atomicAdd(&draws[2].instanceCount, 1u);
    lod2[slot] = i;
  }
}
