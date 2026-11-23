/* ---------------------------------------------------------------------------
 * scene.js — the daemon's surface in three dimensions, and its body.
 *
 * The living field (stains, veins, tissue) is still painted exactly as
 * before, but into a texture that lies on a BOARD. Out of that board the
 * daemon grows its own PIECES (growth.js): irregular, sharp-faceted, organic
 * forms, different every session.
 *
 * Nothing in the 3D scene breaks the language:
 *   - the board is the field itself; its matter is slightly raised (relief)
 *   - the field's pattern continues onto the pieces, folded up their sides,
 *     so stains, veins and cells wrap over every facet
 *   - shadows are not black: they bleed into the linen like soot
 *   - only the sharp folds are inked, with a wobbling hand-drawn line
 *   - freshly grown matter is pale; pieces it rejects irritate (red
 *     scratches, a shiver); pieces it accepts settle, with a faint moss
 *
 * World mapping: daemon world (x, y) with x ∈ [0, A], y ∈ [0, 1]
 *   →  3D (X = x − A/2, Y = up, Z = y − 0.5).  Surface texture uv = (x/A, 1 − y).
 * ------------------------------------------------------------------------- */
(function (RUIN) {
  'use strict';

  const MAXB = 160;
  const SHADOW_W = 576, SHADOW_H = 384;
  const RELIEF = 0.006;

  /* ------------------------------------------------------------ math */
  const V = {
    sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
    mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  };
  function perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
  }
  function lookAt(eye, target, up) {
    const z = V.norm(V.sub(eye, target)), x = V.norm(V.cross(up, z)), y = V.cross(z, x);
    return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -V.dot(x, eye), -V.dot(y, eye), -V.dot(z, eye), 1]);
  }
  function mat4mul(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
    return o;
  }

  /* --------------------------------------------------------- shaders */
  const HEAD = `#version 300 es
  precision highp float;
  precision highp int;
  precision highp sampler2D;
  `;

  const SCENE = `
  uniform sampler2D u_boxes;   // MAXB x 2 : (center.xyz, seed) (half.xyz, -)
  uniform int   u_nbox;
  uniform vec3  u_light;
  uniform float u_time;
  uniform float u_aspect;      // board width in world units

  float hash13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
  float vnoise3(vec3 x) {
    vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  float sdBox(vec3 p, vec3 b) { vec3 q = abs(p) - b; return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0); }
  float sceneSDF(vec3 p) {
    float d = 1e5;
    for (int i = 0; i < ${MAXB}; i++) {
      if (i >= u_nbox) break;
      vec4 c = texelFetch(u_boxes, ivec2(i, 0), 0);
      vec4 h = texelFetch(u_boxes, ivec2(i, 1), 0);
      d = min(d, sdBox(p - c.xyz, h.xyz));
    }
    return d;
  }
  // a ray toward the light: is any other piece in the way?
  float rayShadow(vec3 ro, vec3 rd, int self) {
    float lit = 1.0;
    for (int i = 0; i < ${MAXB}; i++) {
      if (i >= u_nbox) break;
      if (i == self) continue;
      vec4 c = texelFetch(u_boxes, ivec2(i, 0), 0);
      vec4 h = texelFetch(u_boxes, ivec2(i, 1), 0);
      vec3 m = 1.0 / rd;
      vec3 t1 = (c.xyz - h.xyz - ro) * m, t2 = (c.xyz + h.xyz - ro) * m;
      vec3 tn = min(t1, t2), tf = max(t1, t2);
      float tN = max(max(tn.x, tn.y), tn.z), tF = min(min(tf.x, tf.y), tf.z);
      if (tF > 0.0 && tN < tF && tN > 0.0005) lit = min(lit, 0.0);
    }
    return lit;
  }
  vec4 voronoi(vec2 x, float t) {
    vec2 n = floor(x), fr = fract(x);
    float F1 = 8.0, F2 = 8.0, F3 = 8.0, id = 0.0;
    for (int j = -1; j <= 1; j++)
      for (int i = -1; i <= 1; i++) {
        vec2 g = vec2(float(i), float(j));
        vec2 o = hash22(n + g);
        vec2 site = 0.5 + 0.42 * sin(t * 0.12 + 6.2831 * o);
        vec2 r = g + site - fr;
        float d = dot(r, r);
        if (d < F1) { F3 = F2; F2 = F1; F1 = d; id = hash12(n + g); }
        else if (d < F2) { F3 = F2; F2 = d; }
        else if (d < F3) F3 = d;
      }
    return vec4(sqrt(F1), sqrt(F2), id, sqrt(F3));
  }
  vec2 boardUV(vec3 p) { return vec2((p.x + 0.5 * u_aspect) / u_aspect, 0.5 - p.z); }
  `;

  const FULL_VS = HEAD + `
  out vec2 v_uv;
  void main() {
    vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
    v_uv = p * 0.5 + 0.5;
    gl_Position = vec4(p, 0.999, 1.0);
  }`;

  /* soft shadows + ambient occlusion of the pieces on the board (cached) */
  const SHADOW_FS = HEAD + RUIN.shaders.NOISE + SCENE + `
  in vec2 v_uv;
  out vec4 outColor;
  void main() {
    vec3 p = vec3(v_uv.x * u_aspect - 0.5 * u_aspect, 0.0, 0.5 - v_uv.y);
    float res = 1.0, t = 0.004;
    for (int i = 0; i < 32; i++) {
      float h = sceneSDF(p + u_light * t);
      res = min(res, 20.0 * h / t);
      t += clamp(h, 0.003, 0.05);
      if (res < 0.005 || t > 1.4) break;
    }
    float occ = 0.0, sca = 1.0;
    for (int k = 1; k <= 5; k++) {
      float hk = 0.014 * float(k);
      occ += (hk - sceneSDF(p + vec3(0.0, hk, 0.0))) * sca;
      sca *= 0.75;
    }
    float ao = clamp(1.0 - 2.6 * occ / 0.07, 0.0, 1.0);
    outColor = vec4(clamp(res, 0.0, 1.0), ao, 0.0, 1.0);
  }`;

  const BG_FS = HEAD + RUIN.shaders.NOISE + `
  uniform vec3 u_ground;
  in vec2 v_uv;
  out vec4 outColor;
  void main() {
    outColor = vec4(u_ground, 1.0);
  }`;

  /* over everything: a soft falloff and paper grain (multiplied) */
  const VIGNETTE_FS = HEAD + RUIN.shaders.NOISE + `
  uniform float u_harmony;
  in vec2 v_uv;
  out vec4 outColor;
  void main() {
    vec2 vc = v_uv - 0.5;
    float v = 1.0 - (0.42 - 0.1 * u_harmony) * pow(dot(vc, vc) * 1.8, 1.2);
    v *= 0.975 + 0.05 * hash12(floor(gl_FragCoord.xy));
    outColor = vec4(vec3(v), 1.0);
  }`;

  /* the board: the field itself, a little raised where there is matter */
  const BOARD_VS = HEAD + `
  layout(location = 0) in vec2 a_uv;
  uniform mat4 u_viewProj;
  uniform sampler2D u_surface;
  uniform float u_aspect;
  out vec2 v_uv;
  out vec3 v_world;
  void main() {
    float h = textureLod(u_surface, a_uv, 1.5).a * ${RELIEF};
    vec3 p = vec3(a_uv.x * u_aspect - 0.5 * u_aspect, h, 0.5 - a_uv.y);
    v_uv = a_uv; v_world = p;
    gl_Position = u_viewProj * vec4(p, 1.0);
  }`;

  const BOARD_FS = HEAD + RUIN.shaders.NOISE + SCENE + `
  uniform sampler2D u_surface, u_shadow;
  uniform vec3 u_inkEdge, u_fog, u_eye, u_ground;
  in vec2 v_uv;
  in vec3 v_world;
  out vec4 outColor;

  // how close the nearest piece is (its footprint), 0..1
  float nearPieces(vec2 p) {
    float near = 0.0;
    for (int i = 0; i < ${MAXB}; i++) {
      if (i >= u_nbox) break;
      vec4 c = texelFetch(u_boxes, ivec2(i, 0), 0);
      vec4 h = texelFetch(u_boxes, ivec2(i, 1), 0);
      vec2 q = max(abs(p - c.xz) - h.xz, 0.0);
      float reach = 0.07 + 0.55 * h.y;             // taller pieces send their veins further
      near = max(near, exp(-length(q) / reach));
    }
    return near;
  }

  void main() {
    vec4 s = texture(u_surface, v_uv);
    // a calm, clean ground; the field only shows as a few veins where pieces are born
    vec3 col = u_ground;
    float near = nearPieces(v_world.xz);
    // an organic, ragged border: the field spreads out from the pieces like a stain
    float edgeN = fbm(v_uv * 7.0 + 2.0) * 0.5 + 0.5 + 0.25 * snoise(v_uv * 40.0);
    float field = smoothstep(0.18, 0.5, near * (0.7 + 0.6 * edgeN));
    // beyond it, the longest veins still run out a little further
    float runner = s.a * smoothstep(0.06, 0.25, near) * smoothstep(0.4, 0.8, s.a);
    float show = max(field, runner);
    col = mix(col, s.rgb, show);

    // relief lighting from the matter channel
    vec2 tx = 1.0 / vec2(textureSize(u_surface, 0));
    float hL = textureLod(u_surface, v_uv - vec2(tx.x * 1.5, 0.0), 0.7).a;
    float hR = textureLod(u_surface, v_uv + vec2(tx.x * 1.5, 0.0), 0.7).a;
    float hD = textureLod(u_surface, v_uv - vec2(0.0, tx.y * 1.5), 0.7).a;
    float hU = textureLod(u_surface, v_uv + vec2(0.0, tx.y * 1.5), 0.7).a;
    float k = ${RELIEF} * 2.2;
    vec3 n = normalize(vec3(-(hR - hL) * k / (3.0 * tx.x * u_aspect), 1.0, (hU - hD) * k / (3.0 * tx.y)));
    col *= 1.0 + (dot(n, u_light) - u_light.y) * 1.8 * show;

    // the pieces' shadows bleed into the linen like soot
    vec2 wq = v_uv + 0.0035 * vec2(snoise(v_uv * 46.0), snoise(v_uv * 46.0 + 7.3));
    vec2 sh = texture(u_shadow, wq).rg;
    float soot = 0.85 + 0.3 * fbm(v_uv * 22.0 + 3.0);
    float dark = (1.0 - sh.r) * 0.6 * soot + (1.0 - sh.g) * 0.6;
    float hair = smoothstep(0.35, 0.9, snoise(v_uv * vec2(30.0, 380.0)));
    dark += (1.0 - sh.r) * hair * 0.06;
    col *= mix(vec3(1.0), u_inkEdge * 1.2, clamp(dark, 0.0, 0.82));

    // no edge, no slab: the ground simply continues
    vec2 ed = min(v_uv, 1.0 - v_uv) * vec2(u_aspect, 1.0);
    col = mix(u_ground, col, smoothstep(0.0, 0.1, min(ed.x, ed.y)));
    outColor = vec4(col, 1.0);
  }`;

  /* a piece of the daemon's body (or the board's edge) */
  const PIECE_VS = HEAD + `
  layout(location = 0) in vec3 a_pos;
  layout(location = 1) in vec3 a_nrm;
  layout(location = 2) in vec3 a_bary;
  layout(location = 3) in vec3 a_crease;
  uniform mat4 u_viewProj;
  uniform vec3 u_anchor, u_scale;
  uniform float u_yaw, u_seed, u_shake, u_time;
  out vec3 v_world, v_nrm, v_bary, v_crease;
  void main() {
    float c = cos(u_yaw), s = sin(u_yaw);
    vec3 lp = a_pos * u_scale;
    vec3 rp = vec3(c * lp.x + s * lp.z, lp.y, -s * lp.x + c * lp.z);
    vec3 n = normalize(a_nrm / max(u_scale, vec3(0.05)));
    v_nrm = vec3(c * n.x + s * n.z, n.y, -s * n.x + c * n.z);
    vec3 wp = u_anchor + rp;
    wp.xz += vec2(sin(u_time * 41.0 + u_seed * 9.0), cos(u_time * 37.0 + u_seed * 5.0)) * u_shake * 0.0012 * step(0.001, wp.y);
    v_world = wp; v_bary = a_bary; v_crease = a_crease;
    gl_Position = u_viewProj * vec4(wp, 1.0);
  }`;

  const PIECE_FS = HEAD + RUIN.shaders.NOISE + SCENE + `
  uniform sampler2D u_surface, u_will;
  uniform vec4  u_gridRect;
  uniform float u_seed, u_g, u_mode;     // mode: 0 piece · 2 board edge
  uniform int   u_self;
  uniform vec3  u_paperDeep, u_cream, u_ink, u_inkEdge, u_signal, u_washA, u_washB, u_tissue, u_fog, u_eye;
  in vec3 v_world, v_nrm, v_bary, v_crease;
  out vec4 outColor;
  vec2 mirror(vec2 uv) { return 1.0 - abs(1.0 - mod(uv, 2.0)); }
  void main() {
    vec3 n = normalize(v_nrm);
    vec3 wp = v_world;
    float ndl = dot(n, u_light);

    // ink on the sharp folds only (crease edges), drawn by hand
    float line = 0.0;
    vec3 bw = fwidth(v_bary);
    float wob = 1.1 + 0.7 * snoise(vec2(dot(wp, vec3(61.0, 37.0, 43.0)), u_seed));
    for (int k = 0; k < 3; k++) {
      if (v_crease[k] < 0.5) continue;
      float d = v_bary[k] / max(bw[k], 1e-5);
      line = max(line, 1.0 - smoothstep(wob * 0.5, wob, d));
    }

    if (u_mode > 1.5) {                      // the board's edge: dark linen, inked
      vec3 c = u_paperDeep * 0.55 * (0.82 + 0.18 * max(ndl, 0.0));
      c *= 0.94 + 0.1 * fbm(wp.xy * 30.0 + wp.zy * 30.0);
      c = mix(c, u_ink, line * 0.6);
      outColor = vec4(mix(c, u_fog, smoothstep(1.6, 4.5, distance(wp, u_eye)) * 0.45), 1.0);
      return;
    }

    // --- the ground's pattern, continued onto the piece -----------------------------
    // top faces see the surface right beneath them; side faces read it as if the
    // surface were folded up the piece, so stains and tissue wrap over the folds
    vec3 tw = pow(abs(n), vec3(4.0)); tw /= tw.x + tw.y + tw.z;
    float lift = wp.y * 1.15;
    vec2 uvY = boardUV(wp);
    vec2 uvX = mirror(boardUV(vec3(wp.x + sign(n.x) * lift, 0.0, wp.z)));
    vec2 uvZ = mirror(boardUV(vec3(wp.x, 0.0, wp.z + sign(n.z) * lift)));
    vec4 sY = texture(u_surface, uvY), sX = texture(u_surface, uvX), sZ = texture(u_surface, uvZ);
    vec4 pat = sX * tw.x + sY * tw.y + sZ * tw.z;
    vec3 col = pat.rgb;
    // the piece is made of the same pigment: where the ground beneath is bare,
    // its own wash shows through
    float wn = fbm(wp.xz * 7.0 + wp.y * 5.0 + u_seed) * 0.5 + 0.5;
    vec3 washCol = mix(u_washA, u_washB, wn);
    col = mix(col, col * washCol * 1.25, 0.55 * (1.0 - pat.a));

    // --- the ground's tissue grows over every facet: cells, junctions, nuclei ----------
    vec2 q = tw.y > max(tw.x, tw.z) ? wp.xz : (tw.x > tw.z ? vec2(wp.z, wp.y) : vec2(wp.x, wp.y));
    q += 0.012 * vec2(fbm(q * 14.0 + u_seed), fbm(q * 14.0 - u_seed));
    vec4 v1 = voronoi(q * 32.0 + u_seed, u_time);
    vec4 v2 = voronoi(q * 85.0 + 13.0 + u_seed, u_time * 1.3);
    float e1 = v1.y - v1.x, e2 = v2.y - v2.x;
    float junction = 1.0 - smoothstep(0.0, 0.32, v1.w - v1.x);
    float w1 = 0.03 + 0.03 * (0.5 + 0.5 * snoise(q * 20.0)) + 0.09 * junction * junction;
    float mem = max(1.0 - smoothstep(w1 * 0.3, w1, e1), (1.0 - smoothstep(0.02, 0.07, e2)) * 0.6);
    float nucleus = step(0.72, v1.z) * exp(-pow((v1.x - 0.16) / 0.03, 2.0));
    mem = clamp(mem + nucleus * 0.7, 0.0, 1.0);
    col *= 1.0 - (1.0 - smoothstep(0.0, 0.5, e1)) * 0.14;          // cells bulge
    float lum = dot(col, vec3(0.3, 0.59, 0.11));
    vec3 wallCol = mix(u_cream, u_tissue, smoothstep(0.22, 0.42, lum));
    col = mix(col, wallCol, mem * 0.55);

    // each facet catches the pigment a little differently: sharp, mineral
    vec3 fn = floor(n * 9.0 + 0.5);
    col *= 0.9 + 0.14 * hash12(fn.xz + fn.y * 7.0 + u_seed);
    col *= mix(vec3(1.0), u_inkEdge * 1.35, 0.06 + pat.a * 0.14);

    // freshly grown matter is pale, like new tissue
    col = mix(col, u_cream, (1.0 - u_g) * 0.4);

    // --- the will, read where the piece stands --------------------------------------
    vec2 wx = vec2(wp.x + 0.5 * u_aspect, wp.z + 0.5);
    vec2 gq = (wx - u_gridRect.xy) / (u_gridRect.zw - u_gridRect.xy);
    vec4 will = texture(u_will, gq);
    vec2 ge = min(gq, 1.0 - gq);
    will *= smoothstep(-0.05, 0.04, min(ge.x, ge.y));
    float excess = clamp(will.g, 0.0, 1.0), harmony = clamp(will.b, 0.0, 1.0);
    vec2 sq = vec2(dot(wp.xz, vec2(0.8, 0.6)) * 30.0 + u_time * 0.35, wp.y * 150.0);
    float scratch = smoothstep(0.6, 0.95, snoise(sq + 2.0 * fbm(wp.xz * 9.0 + u_time * 0.05)));
    scratch *= excess * (0.55 + 0.45 * sin(u_time * 5.0 + u_seed * 3.0));
    col = mix(col, u_signal * 0.85, scratch * 0.55 + excess * 0.14);
    col = mix(col, mix(u_cream, u_washA, 0.35), harmony * 0.14);

    // --- light: crisp facets, other pieces cast shadows -----------------------------------
    vec3 ro = wp + n * 0.0015;
    float sh = ndl > 0.0 ? rayShadow(ro, u_light, u_self) : 0.0;
    float lit = 0.5 + 0.55 * max(ndl, 0.0) * sh + 0.08 * n.y;
    lit *= 0.75 + 0.25 * smoothstep(0.0, 0.03, wp.y);
    col *= lit;

    col = mix(col, u_ink, line * 0.75);
    col = mix(col, u_fog, smoothstep(1.6, 4.5, distance(wp, u_eye)) * 0.45);
    outColor = vec4(col, 1.0);
  }`;

  /* ------------------------------------------------------------ meshes */
  // Each piece is a box roughly the size of its plan, subdivided and then
  // deformed: tapered, bent, swollen by noise, its corners pulled in and every
  // vertex knocked a little → irregular, sharp-faceted, organic. Triangles are
  // kept separate (flat facets) and every fold sharper than ~35° is marked
  // so the shader can ink it.
  const KINDS = {
    post:  (r) => ({ top: r.float(0.55, 0.9), tp: 1.4, tip: 0.06, bend: r.float(-0.12, 0.12), bulge: 0.14, jit: 0.12, corner: r.float(0.18, 0.35), f: 18 }),
    shard: (r) => ({ top: r.float(0.04, 0.18), tp: 1.1, tip: 0.25, bend: r.float(-0.2, 0.2), bulge: 0.12, jit: 0.14, corner: r.float(0.2, 0.4), f: 20 }),
    slab:  (r) => ({ top: r.float(0.8, 0.95), tp: 1, tip: 0.02, bend: 0, bulge: 0.1, jit: 0.1, corner: r.float(0.25, 0.45), f: 16, sag: r.float(-0.25, 0.25) }),
    knot:  (r) => ({ top: r.float(0.45, 0.75), tp: 1.2, tip: 0.08, bend: r.float(-0.1, 0.1), bulge: 0.28, jit: 0.16, corner: r.float(0.3, 0.5), f: 24 }),
    box:   () => ({ top: 1, tp: 1, tip: 0, bend: 0, bulge: 0, jit: 0, corner: 0, f: 1 }),
  };

  function pieceGeometry(kind, size, seed) {
    const rng = new RUIN.Random(seed >>> 0);
    const noise = RUIN.createNoise3D(rng);
    const K = KINDS[kind](rng);
    const [sx, sy, sz] = size;
    const seg = (d) => (kind === 'box' ? 1 : Math.max(1, Math.min(5, Math.round(d / 0.026))));
    const nx = seg(sx), ny = seg(sy), nz = seg(sz);
    const tipX = rng.float(-1, 1) * K.tip, tipZ = rng.float(-1, 1) * K.tip;
    const md = Math.min(sx, sz, kind === 'slab' ? sy * 1.6 : 9);
    const verts = new Map();
    const P = [];
    const vid = (a, b, c) => {
      const k = a + ',' + b + ',' + c;
      if (verts.has(k)) return verts.get(k);
      const u = a / nx - 0.5, v = b / ny, w = c / nz - 0.5;
      let x = u * sx, y = v * sy, z = w * sz;
      if (kind !== 'box') {
        const t = Math.pow(v, K.tp);
        const taper = 1 + (K.top - 1) * t;
        x *= taper; z *= taper;
        x += (tipX * sx + K.bend * sy) * t * t; z += tipZ * sz * t * t;
        if (K.sag) y += K.sag * sy * (1 - 4 * u * u) * (v > 0 ? 1 : 0.6);
        // organic corners: vertical edges and top rims are pulled in
        const ex = Math.abs(u) > 0.49, ez = Math.abs(w) > 0.49;
        if (ex && ez) { x *= 1 - K.corner * 0.5; z *= 1 - K.corner * 0.5; }
        if ((ex || ez) && v > 0.99) y -= K.corner * Math.min(sy, md) * 0.35;
        // swelling
        const nb = noise(x * K.f + seed % 97, y * K.f, z * K.f);
        x *= 1 + K.bulge * nb; z *= 1 + K.bulge * nb;
        // sharp knocks
        const j = K.jit * md;
        x += rng.float(-j, j); z += rng.float(-j, j);
        if (v > 0) y += rng.float(-j, j) * 0.6;
        y = Math.max(0, y);
      }
      const id = P.length / 3;
      P.push(x, y, z);
      verts.set(k, id);
      return id;
    };
    const tris = [];
    const quad = (a, b, c, d) => { tris.push([a, b, c], [a, c, d]); };
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      quad(vid(i, j, nz), vid(i + 1, j, nz), vid(i + 1, j + 1, nz), vid(i, j + 1, nz));           // +z
      quad(vid(i + 1, j, 0), vid(i, j, 0), vid(i, j + 1, 0), vid(i + 1, j + 1, 0));               // -z
    }
    for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) {
      quad(vid(nx, j, nz - k), vid(nx, j, nz - k - 1), vid(nx, j + 1, nz - k - 1), vid(nx, j + 1, nz - k)); // +x
      quad(vid(0, j, k), vid(0, j, k + 1), vid(0, j + 1, k + 1), vid(0, j + 1, k));               // -x
    }
    for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
      quad(vid(i, ny, nz - k), vid(i + 1, ny, nz - k), vid(i + 1, ny, nz - k - 1), vid(i, ny, nz - k - 1)); // +y
      quad(vid(i, 0, k), vid(i + 1, 0, k), vid(i + 1, 0, k + 1), vid(i, 0, k + 1));               // -y
    }
    // face normals (outward, from the piece's axis)
    const cy = sy * 0.5;
    const normals = tris.map(([a, b, c]) => {
      const A = [P[a * 3], P[a * 3 + 1], P[a * 3 + 2]], B = [P[b * 3], P[b * 3 + 1], P[b * 3 + 2]], C = [P[c * 3], P[c * 3 + 1], P[c * 3 + 2]];
      let n = V.norm(V.cross(V.sub(B, A), V.sub(C, A)));
      const m = [(A[0] + B[0] + C[0]) / 3, (A[1] + B[1] + C[1]) / 3 - cy, (A[2] + B[2] + C[2]) / 3];
      if (V.dot(n, m) < 0) n = V.mul(n, -1);
      return n;
    });
    // creases: edges whose two faces fold sharply
    const edges = new Map();
    tris.forEach((t, f) => { for (let e = 0; e < 3; e++) { const a = t[(e + 1) % 3], b = t[(e + 2) % 3]; const k = a < b ? a + '_' + b : b + '_' + a; (edges.get(k) || edges.set(k, []).get(k)).push(f); } });
    const crease = tris.map((t, f) => [0, 1, 2].map((e) => {
      const a = t[(e + 1) % 3], b = t[(e + 2) % 3];
      const L = edges.get(a < b ? a + '_' + b : b + '_' + a);
      const o = L.find((g) => g !== f);
      return o == null || V.dot(normals[f], normals[o]) < 0.62 ? 1 : 0;
    }));
    const n = tris.length * 3;
    const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), bary = new Float32Array(n * 3), cr = new Float32Array(n * 3);
    tris.forEach((t, f) => {
      for (let k = 0; k < 3; k++) {
        const o = (f * 3 + k) * 3;
        pos.set([P[t[k] * 3], P[t[k] * 3 + 1], P[t[k] * 3 + 2]], o);
        nrm.set(normals[f], o);
        bary[o + k] = 1;
        cr.set(crease[f], o);
      }
    });
    return { pos, nrm, bary, cr, count: n };
  }

  /* ------------------------------------------------------------- Scene */
  class Scene {
    constructor(renderer) {
      this.r = renderer;
      const gl = (this.gl = renderer.gl);
      this.progBG = renderer.program(FULL_VS, BG_FS);
      this.progVig = renderer.program(FULL_VS, VIGNETTE_FS);
      this.progShadow = renderer.program(FULL_VS, SHADOW_FS);
      this.progBoard = renderer.program(BOARD_VS, BOARD_FS);
      this.progPiece = renderer.program(PIECE_VS, PIECE_FS);
      this.emptyVAO = gl.createVertexArray();

      const g = gridMesh(240, 160);
      this.boardVAO = gl.createVertexArray();
      gl.bindVertexArray(this.boardVAO);
      this.buffer(gl.ARRAY_BUFFER, g.uv);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      this.buffer(gl.ELEMENT_ARRAY_BUFFER, g.idx);
      this.boardCount = g.idx.length;
      gl.bindVertexArray(null);


      this.boxData = new Float32Array(MAXB * 4 * 2);
      this.texBoxes = renderer.floatTex(MAXB, 2, gl.RGBA32F, gl.RGBA);
      this.shadow = renderer.memoryTarget(SHADOW_W, SHADOW_H);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadow.fb);
      gl.clearColor(1, 1, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      this.growth = null;       // set by main.js
      this.meshes = new Map();  // piece id → mesh
      this.seenVersion = -1;
      this.shadowT = 0;
      this.nbox = 0;
      this.light = V.norm([-0.5, 0.9, -0.35]);

      this.cam = { yaw: 0.0, pitch: 0.78, dist: 1.8, yawT: 0.35, pitchT: 0.78, distT: 1.5 };
      this.top = false;
      this.drift = true;
    }

    buffer(target, data) {
      const gl = this.gl, b = gl.createBuffer();
      gl.bindBuffer(target, b);
      gl.bufferData(target, data, gl.STATIC_DRAW);
      return b;
    }

    mesh(geo) {
      const gl = this.gl, vao = gl.createVertexArray(), bufs = [];
      gl.bindVertexArray(vao);
      [geo.pos, geo.nrm, geo.bary, geo.cr].forEach((d, i) => {
        bufs.push(this.buffer(gl.ARRAY_BUFFER, d));
        gl.enableVertexAttribArray(i);
        gl.vertexAttribPointer(i, 3, gl.FLOAT, false, 0, 0);
      });
      gl.bindVertexArray(null);
      return { vao, bufs, count: geo.count };
    }

    /** keep one mesh per living piece */
    syncMeshes() {
      const G = this.growth;
      if (!G || G.version === this.seenVersion) return;
      this.seenVersion = G.version;
      const alive = new Set(G.pieces.map((p) => p.id + ':' + p.seed));
      for (const [k, m] of this.meshes) if (!alive.has(k)) {
        this.gl.deleteVertexArray(m.vao); m.bufs.forEach((b) => this.gl.deleteBuffer(b)); this.meshes.delete(k);
      }
      for (const p of G.pieces) {
        const k = p.id + ':' + p.seed;
        if (!this.meshes.has(k)) this.meshes.set(k, this.mesh(pieceGeometry(p.kind, p.size, p.seed)));
      }
    }

    /* ---- camera ------------------------------------------------------------ */
    orbit(dyaw, dpitch) {
      const c = this.cam;
      this.top = false;
      c.yawT += dyaw;
      c.pitchT = Math.max(0.12, Math.min(1.5, c.pitchT + dpitch));
    }
    zoom(f) { const c = this.cam; c.distT = Math.max(0.6, Math.min(3.6, c.distT * f)); }
    toggleTop() {
      const c = this.cam;
      this.top = !this.top;
      if (this.top) { this._before = { yaw: c.yawT, pitch: c.pitchT, dist: c.distT }; c.yawT = Math.round(c.yawT / (Math.PI * 2)) * Math.PI * 2; c.pitchT = 1.5; c.distT = 1.75; }
      else if (this._before) { c.yawT = this._before.yaw; c.pitchT = this._before.pitch; c.distT = this._before.dist; }
    }

    updateCamera(dt, aspectView) {
      const c = this.cam, k = 1 - Math.exp(-dt * 7);
      // left alone, it turns very slowly around its body
      if (!this.top && this.drift) c.yawT += dt * 0.012;
      c.yaw += (c.yawT - c.yaw) * k; c.pitch += (c.pitchT - c.pitch) * k; c.dist += (c.distT - c.dist) * k;
      const fit = Math.max(1, 1.25 / Math.max(0.4, aspectView));
      const d = c.dist * fit;
      const target = [0, 0.05, 0];
      const eye = [target[0] + d * Math.sin(c.yaw) * Math.cos(c.pitch), target[1] + d * Math.sin(c.pitch), target[2] + d * Math.cos(c.yaw) * Math.cos(c.pitch)];
      this.fov = 0.62;
      this.eye = eye;
      this.view = lookAt(eye, target, [0, 1, 0]);
      this.proj = perspective(this.fov, aspectView, 0.02, 20);
      this.viewProj = mat4mul(this.proj, this.view);
      const fwd = V.norm(V.sub(target, eye));
      const right = V.norm(V.cross(fwd, [0, 1, 0]));
      this.basis = { fwd, right, up: V.cross(right, fwd) };
      this.aspectView = aspectView;
    }

    ray(clientX, clientY, rect) {
      const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
      const ny = 1 - ((clientY - rect.top) / rect.height) * 2;
      const t = Math.tan(this.fov / 2), B = this.basis;
      const dir = V.norm(V.add(B.fwd, V.add(V.mul(B.right, nx * t * this.aspectView), V.mul(B.up, ny * t))));
      return { o: this.eye.slice(), d: dir };
    }

    /** the point on the board under the pointer (pieces are seen through) */
    pick(clientX, clientY, rect) {
      if (!this.eye) return null;
      const { o, d } = this.ray(clientX, clientY, rect);
      if (d[1] >= 0) return null;
      const t = -o[1] / d[1];
      const p = V.add(o, V.mul(d, t));
      const A = this.r.aspect;
      if (Math.abs(p[0]) > A / 2 || Math.abs(p[2]) > 0.5) return null;
      return { point: p };
    }

    /* ---- drawing ---------------------------------------------------------------- */
    uploadBoxes() {
      const gl = this.gl, list = this.growth ? this.growth.pieces : [];
      let n = 0;
      for (const p of list) {
        if (n >= MAXB) break;
        if (p.g < 0.03) continue;
        const b = this.growth.bounds(p);
        this.boxData[n * 4] = (b.x0 + b.x1) / 2; this.boxData[n * 4 + 1] = (b.y0 + b.y1) / 2; this.boxData[n * 4 + 2] = (b.z0 + b.z1) / 2; this.boxData[n * 4 + 3] = 0;
        const r1 = MAXB * 4 + n * 4;
        this.boxData[r1] = (b.x1 - b.x0) / 2; this.boxData[r1 + 1] = (b.y1 - b.y0) / 2 * 0.95; this.boxData[r1 + 2] = (b.z1 - b.z0) / 2; this.boxData[r1 + 3] = 0;
        p._box = n;
        n++;
      }
      gl.bindTexture(gl.TEXTURE_2D, this.texBoxes);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, MAXB, 2, gl.RGBA, gl.FLOAT, this.boxData);
      this.nbox = n;
    }

    bindScene(P, time) {
      const gl = this.gl, u = P.u;
      gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, this.texBoxes); gl.uniform1i(u.u_boxes, 6);
      gl.uniform1i(u.u_nbox, this.nbox | 0);
      gl.uniform3fv(u.u_light, this.light);
      gl.uniform1f(u.u_time, time);
      gl.uniform1f(u.u_aspect, this.r.aspect);
    }

    draw(time, dt, harmony) {
      const gl = this.gl, r = this.r, c = r.colors;
      this.syncMeshes();
      const pieces = this.growth ? this.growth.pieces : [];
      // the body moves while it grows: shadows follow at ~8 Hz
      this.shadowT -= dt || 0.016;
      const growing = pieces.some((p) => p.g > 0.001 && p.g < 0.999) || this._lastCount !== pieces.length;
      if (this.shadowT <= 0 && (growing || this._wasGrowing)) {
        this._wasGrowing = growing;
        this._lastCount = pieces.length;
        this.shadowT = 0.18;
        this.uploadBoxes();
        gl.bindVertexArray(this.emptyVAO);
        gl.disable(gl.DEPTH_TEST);
        gl.useProgram(this.progShadow.p);
        this.bindScene(this.progShadow, time);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadow.fb);
        gl.viewport(0, 0, SHADOW_W, SHADOW_H);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, r.canvas.width, r.canvas.height);
      this.updateCamera(dt || 0.016, r.canvas.width / r.canvas.height);
      const ground = [0, 1, 2].map((k) => c.paper[k] * 0.78 + c.paperDeep[k] * 0.22);
      const fog = ground;

      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      gl.bindVertexArray(this.emptyVAO);
      gl.useProgram(this.progBG.p);
      gl.uniform3fv(this.progBG.u.u_ground, ground);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.clear(gl.DEPTH_BUFFER_BIT);

      // board
      let P = this.progBoard, u = P.u;
      gl.useProgram(P.p);
      this.bindScene(P, time);
      gl.uniformMatrix4fv(u.u_viewProj, false, this.viewProj);
      gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, r.surface.tex); gl.uniform1i(u.u_surface, 5);
      gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D, this.shadow.tex); gl.uniform1i(u.u_shadow, 7);
      gl.uniform3fv(u.u_inkEdge, c.inkEdge);
      gl.uniform3fv(u.u_ground, ground);
      gl.uniform3fv(u.u_eye, this.eye);
      gl.bindVertexArray(this.boardVAO);
      gl.drawElements(gl.TRIANGLES, this.boardCount, gl.UNSIGNED_INT, 0);

      // the board's edge and the pieces
      P = this.progPiece; u = P.u;
      gl.useProgram(P.p);
      this.bindScene(P, time);
      gl.uniformMatrix4fv(u.u_viewProj, false, this.viewProj);
      gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, r.surface.tex); gl.uniform1i(u.u_surface, 5);
      gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, r.texWill); gl.uniform1i(u.u_will, 4);
      const R = RUIN.will.rect(r.aspect);
      gl.uniform4f(u.u_gridRect, R.x0, R.y0, R.x1, R.y1);
      for (const k of ['paperDeep', 'cream', 'ink', 'inkEdge', 'signal', 'washA', 'washB', 'tissue']) gl.uniform3fv(u['u_' + k], c[k]);
      gl.uniform3fv(u.u_fog, fog);
      gl.uniform3fv(u.u_eye, this.eye);


      const A = r.aspect, W = RUIN.will, will = r.willData;
      for (const p of pieces) {
        if (p.g < 0.003) continue;
        const m = this.meshes.get(p.id + ':' + p.seed);
        if (!m) continue;
        let shake = 0;
        if (will) {
          const g = W.worldToGrid(p.pos[0] + A / 2, p.pos[2] + 0.5, A);
          const ci = Math.floor(g.gx), cj = Math.floor(g.gy);
          if (ci >= 0 && cj >= 0 && ci < W.COLS && cj < W.ROWS) shake = will[(cj * W.COLS + ci) * 4 + 1] / 255;
        }
        // it rises out of the surface: thin at first, then filling out
        const e = p.g, w = 0.35 + 0.65 * e;
        this.drawMesh(u, m, p.pos, [w, Math.max(0.001, e), w], p.yaw, { seed: p.seed % 1000 / 100, g: e, shake: shake * shake, self: p._box ?? -1 });
      }

      // soft falloff and grain over the whole view
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.DST_COLOR, gl.ZERO);
      gl.bindVertexArray(this.emptyVAO);
      gl.useProgram(this.progVig.p);
      gl.uniform1f(this.progVig.u.u_harmony, harmony);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.disable(gl.BLEND);
      gl.bindVertexArray(null);
    }

    drawMesh(u, m, anchor, scale, yaw, o) {
      const gl = this.gl;
      gl.uniform3f(u.u_anchor, anchor[0], anchor[1], anchor[2]);
      gl.uniform3f(u.u_scale, scale[0], scale[1], scale[2]);
      gl.uniform1f(u.u_yaw, yaw);
      gl.uniform1f(u.u_seed, o.seed || 0);
      gl.uniform1f(u.u_mode, o.mode || 0);
      gl.uniform1f(u.u_g, o.g ?? 1);
      gl.uniform1f(u.u_shake, o.shake || 0);
      gl.uniform1i(u.u_self, o.self ?? -1);
      gl.bindVertexArray(m.vao);
      gl.drawArrays(gl.TRIANGLES, 0, m.count);
    }
  }

  function gridMesh(nx, ny) {
    const uv = [], idx = [];
    for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) uv.push(i / nx, j / ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * (nx + 1) + i;
      idx.push(k, k + nx + 1, k + 1, k + 1, k + nx + 1, k + nx + 2);
    }
    return { uv: new Float32Array(uv), idx: new Uint32Array(idx) };
  }

  RUIN.Scene = Scene;
  RUIN.scene = { MAXB, pieceGeometry };
})((window.RUIN = window.RUIN || {}));
