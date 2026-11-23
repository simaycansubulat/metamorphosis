/* ---------------------------------------------------------------------------
 * scene.js — the daemon's surface in three dimensions.
 *
 * The living field (stains, veins, tissue) is still painted exactly as
 * before, but into a texture that lies on a BOARD. The participant builds on
 * that board with wooden pieces (Jenga proportions, 3 : 1 : 0.6).
 *
 * Nothing in the 3D scene breaks the organic language:
 *   - the board is the field itself; its matter is slightly raised (relief)
 *   - shadows are not black: they bleed into the linen like soot
 *   - the daemon's stains slowly CLIMB the pieces from their foot, with a
 *     tide line, and tissue grows over pieces it has lived with for a while
 *   - pieces it rejects irritate: red scratches, red-walled cells, a shiver
 *   - pieces it accepts settle and lighten, a faint moss in their cells
 *   - every edge is a wobbly ink line, every face slightly uneven
 *
 * World mapping: daemon world (x, y) with x ∈ [0, A], y ∈ [0, 1]
 *   →  3D (X = x − A/2, Y = up, Z = y − 0.5).  Surface texture uv = (x/A, 1 − y).
 * ------------------------------------------------------------------------- */
(function (RUIN) {
  'use strict';

  const MAXB = 160;
  const SHADOW_W = 384, SHADOW_H = 256;
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
  uniform vec3 u_paper, u_paperDeep;
  uniform float u_harmony;
  in vec2 v_uv;
  out vec4 outColor;
  void main() {
    vec3 lo = u_paperDeep * 0.40, hi = mix(u_paperDeep, u_paper, 0.4) * 0.66;
    vec3 col = mix(lo, hi, smoothstep(-0.1, 1.1, v_uv.y));
    col *= 0.93 + 0.1 * (fbm(v_uv * vec2(2.5, 1.5) + 4.0) * 0.5 + 0.5);
    vec2 vc = v_uv - 0.5;
    col *= 1.0 - (0.45 - 0.1 * u_harmony) * dot(vc, vc) * 1.6;
    col *= 0.97 + 0.06 * hash12(floor(gl_FragCoord.xy));
    outColor = vec4(col, 1.0);
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
  uniform vec3 u_inkEdge, u_fog, u_eye;
  in vec2 v_uv;
  in vec3 v_world;
  out vec4 outColor;
  void main() {
    vec4 s = texture(u_surface, v_uv);
    vec3 col = s.rgb;

    // relief lighting from the matter channel
    vec2 tx = 1.0 / vec2(textureSize(u_surface, 0));
    float hL = textureLod(u_surface, v_uv - vec2(tx.x * 1.5, 0.0), 0.7).a;
    float hR = textureLod(u_surface, v_uv + vec2(tx.x * 1.5, 0.0), 0.7).a;
    float hD = textureLod(u_surface, v_uv - vec2(0.0, tx.y * 1.5), 0.7).a;
    float hU = textureLod(u_surface, v_uv + vec2(0.0, tx.y * 1.5), 0.7).a;
    float k = ${RELIEF} * 2.2;
    vec3 n = normalize(vec3(-(hR - hL) * k / (3.0 * tx.x * u_aspect), 1.0, (hU - hD) * k / (3.0 * tx.y)));
    col *= 1.0 + (dot(n, u_light) - u_light.y) * 1.8;

    // the pieces' shadows bleed into the linen like soot
    vec2 wq = v_uv + 0.0035 * vec2(snoise(v_uv * 46.0), snoise(v_uv * 46.0 + 7.3));
    vec2 sh = texture(u_shadow, wq).rg;
    float soot = 0.85 + 0.3 * fbm(v_uv * 22.0 + 3.0);
    float dark = (1.0 - sh.r) * 0.6 * soot + (1.0 - sh.g) * 0.6;
    float hair = smoothstep(0.35, 0.9, snoise(v_uv * vec2(30.0, 380.0)));
    dark += (1.0 - sh.r) * hair * 0.06;
    col *= mix(vec3(1.0), u_inkEdge * 1.2, clamp(dark, 0.0, 0.82));

    float fd = distance(v_world, u_eye);
    col = mix(col, u_fog, smoothstep(1.6, 4.5, fd) * 0.45);
    outColor = vec4(col, 1.0);
  }`;

  /* a piece (or the board's edge, or the ghost of the next piece) */
  const BLOCK_VS = HEAD + `
  layout(location = 0) in vec3 a_pos;
  layout(location = 1) in vec3 a_nrm;
  uniform mat4 u_viewProj;
  uniform vec3 u_center, u_half;
  uniform float u_seed, u_shake, u_time, u_wobble;
  out vec3 v_world, v_local, v_nrm;
  float h13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
  float vn(vec3 x) {
    vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(h13(i), h13(i + vec3(1, 0, 0)), f.x), mix(h13(i + vec3(0, 1, 0)), h13(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(h13(i + vec3(0, 0, 1)), h13(i + vec3(1, 0, 1)), f.x), mix(h13(i + vec3(0, 1, 1)), h13(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  void main() {
    vec3 lp = a_pos * u_half;
    vec3 wp = u_center + lp;
    // hand-made, slightly uneven: displacement depends only on position → no cracks
    float wob = vn(wp * 42.0 + u_seed * 13.0) - 0.5;
    wp += normalize(a_pos) * wob * 0.0026 * u_wobble;
    // a rejected piece shivers
    wp.xz += vec2(sin(u_time * 41.0 + u_seed * 9.0), cos(u_time * 37.0 + u_seed * 5.0)) * u_shake * 0.0011;
    v_world = wp; v_local = a_pos; v_nrm = a_nrm;
    gl_Position = u_viewProj * vec4(wp, 1.0);
  }`;

  const BLOCK_FS = HEAD + RUIN.shaders.NOISE + SCENE + `
  uniform sampler2D u_surface, u_will;
  uniform vec4  u_gridRect;
  uniform vec3  u_center, u_half;
  uniform float u_seed, u_grow, u_mode, u_valid;   // mode: 0 piece · 1 ghost · 2 board edge
  uniform int   u_self;
  uniform vec3  u_paper, u_paperDeep, u_cream, u_ink, u_inkEdge, u_tissue, u_signal, u_washA, u_fog, u_eye;
  in vec3 v_world, v_local, v_nrm;
  out vec4 outColor;
  void main() {
    vec3 n = normalize(v_nrm);
    vec3 wp = v_world;
    vec3 an = abs(n);
    // coordinates on the face and distance to its edges
    vec2 fc, fh;
    if (an.x > 0.5)      { fc = vec2(v_local.z * u_half.z, v_local.y * u_half.y); fh = u_half.zy; }
    else if (an.y > 0.5) { fc = vec2(v_local.x * u_half.x, v_local.z * u_half.z); fh = u_half.xz; }
    else                 { fc = vec2(v_local.x * u_half.x, v_local.y * u_half.y); fh = u_half.xy; }
    vec2 ed = fh - abs(fc);
    float edge = min(ed.x, ed.y);
    float lw = 0.0016 + 0.0011 * snoise(vec2(dot(wp, vec3(53.0, 31.0, 47.0)), u_seed * 7.0));
    float line = 1.0 - smoothstep(lw * 0.35, lw, edge);

    if (u_mode > 0.5 && u_mode < 1.5) {          // ghost: where the next piece would land
      vec3 gc = mix(u_signal, u_cream, u_valid);
      float a = 0.26 + 0.55 * line * (0.6 + 0.4 * step(0.0, sin((fc.x + fc.y) * 260.0)));
      outColor = vec4(mix(gc, u_ink, line * 0.6) * (0.85 + 0.15 * max(dot(n, u_light), 0.0)), a);
      return;
    }

    float ndl = dot(n, u_light);
    if (u_mode > 1.5) {                          // the board's edge: dark linen, inked
      vec3 c = u_paperDeep * 0.55 * (0.82 + 0.18 * max(ndl, 0.0));
      c *= 0.94 + 0.1 * fbm(fc * 30.0);
      c = mix(c, u_ink, line * 0.7);
      outColor = vec4(mix(c, u_fog, smoothstep(1.6, 4.5, distance(wp, u_eye)) * 0.45), 1.0);
      return;
    }

    // --- wood, read as a pale pigment with ink grain --------------------------
    vec3 L = u_half.x >= u_half.y && u_half.x >= u_half.z ? vec3(1, 0, 0) : (u_half.y >= u_half.z ? vec3(0, 1, 0) : vec3(0, 0, 1));
    vec3 P1 = L.x > 0.5 ? vec3(0, 1, 0) : vec3(1, 0, 0);
    vec3 P2 = cross(L, P1);
    float along = dot(wp, L), acr = dot(wp, P1) + dot(wp, P2);
    float g = snoise(vec2(along * 5.0 + u_seed * 3.0, acr * 150.0 + snoise(vec2(along * 9.0, acr * 20.0)) * 1.5));
    vec3 base = mix(u_paper, u_paperDeep, 0.5) * vec3(1.03, 0.97, 0.88);
    base *= 1.0 - smoothstep(0.35, 0.95, g) * 0.14;
    base *= 0.94 + 0.08 * fbm(vec2(along * 14.0, acr * 30.0) + u_seed);

    // --- the field climbs the piece from its foot ---------------------------------
    vec2 buv = boardUV(wp);
    vec4 ground = textureLod(u_surface, buv, 3.5);
    float matter = ground.a;
    float wave = 0.65 + 0.7 * (fbm(vec2(dot(wp.xz, vec2(37.0, 29.0)), wp.y * 30.0) + u_seed) * 0.5 + 0.5);
    float climbH = (0.006 + 0.075 * u_grow * (0.35 + matter)) * wave;
    float climb = 1.0 - smoothstep(climbH - 0.004, climbH + 0.004, wp.y);
    float tide = exp(-pow((wp.y - climbH) / 0.0025, 2.0)) * smoothstep(0.004, 0.02, climbH);
    vec3 col = mix(base, ground.rgb * 0.92, climb * 0.82);
    col *= mix(vec3(1.0), u_inkEdge * 1.3, tide * 0.55);

    // --- the will, read where the piece stands -------------------------------------
    vec2 wx = vec2(wp.x + 0.5 * u_aspect, wp.z + 0.5);
    vec2 gq = (wx - u_gridRect.xy) / (u_gridRect.zw - u_gridRect.xy);
    vec4 will = texture(u_will, gq);
    vec2 ge = min(gq, 1.0 - gq);
    will *= smoothstep(-0.05, 0.04, min(ge.x, ge.y));
    float excess = clamp(will.g, 0.0, 1.0), harmony = clamp(will.b, 0.0, 1.0);

    // --- tissue: cells grow over pieces it has lived with -------------------------------
    vec2 tq = fc * 62.0 + n.xz * 11.0 + n.y * 5.0 + u_seed * 17.0;
    tq += 0.35 * vec2(snoise(tq * 0.3), snoise(tq * 0.3 + 4.0));
    vec4 v1 = voronoi(tq, u_time);
    float e1 = v1.y - v1.x;
    float junction = 1.0 - smoothstep(0.0, 0.3, v1.w - v1.x);
    float wl = 0.03 + 0.07 * junction * junction;
    float membrane = 1.0 - smoothstep(wl * 0.3, wl, e1);
    float tissue = clamp(climb * 0.55 + u_grow * 0.3 * (0.4 + matter) + excess * 0.9 + harmony * 0.25, 0.0, 1.0);
    tissue *= smoothstep(0.2, 0.6, fbm(fc * 9.0 + u_seed) * 0.5 + 0.5 + tissue * 0.6);
    float lum = dot(col, vec3(0.3, 0.59, 0.11));
    vec3 lineCol = mix(u_cream, u_tissue, smoothstep(0.22, 0.42, lum));
    lineCol = mix(lineCol, u_signal * 0.85, excess * 0.8);
    col *= 1.0 - (1.0 - smoothstep(0.0, 0.5, e1)) * 0.1 * tissue;
    col = mix(col, lineCol, membrane * tissue * 0.5);

    // --- rejected: red fibrous scratches; accepted: it settles, a faint moss ---------
    float scratch = smoothstep(0.6, 0.95, snoise(vec2(along * 28.0 + u_time * 0.35, acr * 150.0) + 2.0 * fbm(fc * 5.0 + u_time * 0.05)));
    scratch *= excess * (0.55 + 0.45 * sin(u_time * 5.0 + u_seed * 3.0));
    col = mix(col, u_signal * 0.85, scratch * 0.55 + excess * 0.12);
    col = mix(col, mix(u_cream, u_washA, 0.35), harmony * 0.16);

    // --- light: soft, paper-like; other pieces cast shadows ---------------------------
    vec3 ro = wp + n * 0.0012 + 0.002 * vec3(snoise(wp.xz * 90.0), 0.0, snoise(wp.zx * 90.0 + 3.0));
    float sh = ndl > 0.0 ? rayShadow(ro, u_light, u_self) : 0.0;
    float lit = 0.6 + 0.42 * max(ndl, 0.0) * sh + 0.06 * n.y;
    lit *= 0.78 + 0.22 * smoothstep(0.0, 0.035, wp.y);           // contact with the board
    col *= lit;
    col = mix(col, u_inkEdge * 0.9, (1.0 - sh) * step(0.0, ndl) * 0.06);

    // --- ink: every edge is drawn by hand ---------------------------------------------
    col = mix(col, u_ink, line * 0.82);

    col = mix(col, u_fog, smoothstep(1.6, 4.5, distance(wp, u_eye)) * 0.45);
    outColor = vec4(col, 1.0);
  }`;

  /* ------------------------------------------------------------ meshes */
  function cubeMesh(sub) {
    const pos = [], nrm = [], idx = [];
    const faces = [
      { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] }, { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
      { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] }, { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
      { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] }, { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
    ];
    for (const f of faces) {
      const base = pos.length / 3;
      for (let j = 0; j <= sub; j++) for (let i = 0; i <= sub; i++) {
        const a = (i / sub) * 2 - 1, b = (j / sub) * 2 - 1;
        pos.push(f.n[0] + f.u[0] * a + f.v[0] * b, f.n[1] + f.u[1] * a + f.v[1] * b, f.n[2] + f.u[2] * a + f.v[2] * b);
        nrm.push(...f.n);
      }
      for (let j = 0; j < sub; j++) for (let i = 0; i < sub; i++) {
        const k = base + j * (sub + 1) + i;
        idx.push(k, k + 1, k + sub + 2, k, k + sub + 2, k + sub + 1);
      }
    }
    return { pos: new Float32Array(pos), nrm: new Float32Array(nrm), idx: new Uint16Array(idx) };
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

  /* ------------------------------------------------------------- Scene */
  class Scene {
    constructor(renderer) {
      this.r = renderer;
      const gl = (this.gl = renderer.gl);
      this.progBG = renderer.program(FULL_VS, BG_FS);
      this.progShadow = renderer.program(FULL_VS, SHADOW_FS);
      this.progBoard = renderer.program(BOARD_VS, BOARD_FS);
      this.progBlock = renderer.program(BLOCK_VS, BLOCK_FS);
      this.emptyVAO = gl.createVertexArray();

      // board mesh
      const g = gridMesh(240, 160);
      this.boardVAO = gl.createVertexArray();
      gl.bindVertexArray(this.boardVAO);
      this.buffer(gl.ARRAY_BUFFER, g.uv);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      this.buffer(gl.ELEMENT_ARRAY_BUFFER, g.idx);
      this.boardCount = g.idx.length;

      // piece mesh
      const c = cubeMesh(5);
      this.cubeVAO = gl.createVertexArray();
      gl.bindVertexArray(this.cubeVAO);
      this.buffer(gl.ARRAY_BUFFER, c.pos);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      this.buffer(gl.ARRAY_BUFFER, c.nrm);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
      this.buffer(gl.ELEMENT_ARRAY_BUFFER, c.idx);
      this.cubeCount = c.idx.length;
      gl.bindVertexArray(null);

      this.boxData = new Float32Array(MAXB * 4 * 2);
      this.texBoxes = renderer.floatTex(MAXB, 2, gl.RGBA32F, gl.RGBA);
      this.shadow = renderer.memoryTarget(SHADOW_W, SHADOW_H);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadow.fb);
      gl.clearColor(1, 1, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      this.blocks = [];
      this.ghost = null;
      this.liftIndex = -1;
      this.dirty = true;
      this.light = V.norm([-0.5, 0.9, -0.35]);

      // camera: orbit around the board
      this.cam = { yaw: 0.0, pitch: 0.92, dist: 2.0, yawT: 0.0, pitchT: 0.92, distT: 2.0 };
      this.top = false;
    }

    buffer(target, data) {
      const gl = this.gl, b = gl.createBuffer();
      gl.bindBuffer(target, b);
      gl.bufferData(target, data, gl.STATIC_DRAW);
      return b;
    }

    setBlocks(list) { this.blocks = list; this.dirty = true; }

    /* ---- camera ------------------------------------------------------------ */
    orbit(dyaw, dpitch) {
      const c = this.cam;
      this.top = false;
      c.yawT += dyaw;
      c.pitchT = Math.max(0.18, Math.min(1.5, c.pitchT + dpitch));
    }
    zoom(f) { const c = this.cam; c.distT = Math.max(0.8, Math.min(3.6, c.distT * f)); }
    toggleTop() {
      const c = this.cam;
      this.top = !this.top;
      if (this.top) { this._before = { yaw: c.yawT, pitch: c.pitchT, dist: c.distT }; c.yawT = Math.round(c.yawT / (Math.PI * 2)) * Math.PI * 2; c.pitchT = 1.5; c.distT = 1.75; }
      else if (this._before) { c.yawT = this._before.yaw; c.pitchT = this._before.pitch; c.distT = this._before.dist; }
    }

    updateCamera(dt, aspectView) {
      const c = this.cam, k = 1 - Math.exp(-dt * 7);
      c.yaw += (c.yawT - c.yaw) * k; c.pitch += (c.pitchT - c.pitch) * k; c.dist += (c.distT - c.dist) * k;
      // the narrow screen: back off so the whole board stays in view
      const fit = Math.max(1, 1.25 / Math.max(0.4, aspectView));
      const d = c.dist * fit;
      const target = [0, 0.03, 0];
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

    /** A ray from the camera through a point on the canvas (client coords). */
    ray(clientX, clientY, rect) {
      const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
      const ny = 1 - ((clientY - rect.top) / rect.height) * 2;
      const t = Math.tan(this.fov / 2), B = this.basis;
      const dir = V.norm(V.add(B.fwd, V.add(V.mul(B.right, nx * t * this.aspectView), V.mul(B.up, ny * t))));
      return { o: this.eye.slice(), d: dir };
    }

    /** What lies under the pointer: a piece (with the face normal) or the board. */
    pick(clientX, clientY, rect) {
      if (!this.eye) return null;
      const { o, d } = this.ray(clientX, clientY, rect);
      let best = null;
      this.blocks.forEach((b, i) => {
        let tN = -Infinity, tF = Infinity, axis = 0, sign = 1;
        for (let k = 0; k < 3; k++) {
          const lo = b.c[k] - b.h[k], hi = b.c[k] + b.h[k];
          if (Math.abs(d[k]) < 1e-9) { if (o[k] < lo || o[k] > hi) { tN = Infinity; break; } continue; }
          let t1 = (lo - o[k]) / d[k], t2 = (hi - o[k]) / d[k], s = -1;
          if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; s = 1; }
          if (t1 > tN) { tN = t1; axis = k; sign = s; }
          tF = Math.min(tF, t2);
        }
        if (tN < tF && tN > 0 && (!best || tN < best.t)) {
          const n = [0, 0, 0]; n[axis] = sign;
          best = { kind: 'block', index: i, t: tN, point: V.add(o, V.mul(d, tN)), normal: n };
        }
      });
      if (d[1] < 0) {
        const t = -o[1] / d[1];
        const p = V.add(o, V.mul(d, t));
        const A = this.r.aspect;
        const onBoard = Math.abs(p[0]) <= A / 2 && Math.abs(p[2]) <= 0.5;
        if (onBoard && (!best || t < best.t)) best = { kind: 'board', t, point: p, normal: [0, 1, 0] };
      }
      return best;
    }

    /* ---- drawing ---------------------------------------------------------------- */
    uploadBoxes() {
      const gl = this.gl, n = Math.min(MAXB, this.blocks.length);
      for (let i = 0; i < n; i++) {
        const b = this.blocks[i];
        // row 0 = centers, row 1 = halves
        this.boxData[i * 4] = b.c[0]; this.boxData[i * 4 + 1] = b.c[1]; this.boxData[i * 4 + 2] = b.c[2]; this.boxData[i * 4 + 3] = b.seed;
        const r1 = MAXB * 4 + i * 4;
        this.boxData[r1] = b.h[0]; this.boxData[r1 + 1] = b.h[1]; this.boxData[r1 + 2] = b.h[2]; this.boxData[r1 + 3] = 0;
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
      // ease the dropped pieces down (display only)
      let moving = false;
      for (const b of this.blocks) if (b.drop > 0) { b.drop = Math.max(0, b.drop - (dt || 0.016) * 5); moving = true; }
      if (this.dirty) {
        this.uploadBoxes();
        // soft shadows of the pieces (cached: only when the construction changes)
        gl.bindVertexArray(this.emptyVAO);
        gl.disable(gl.DEPTH_TEST);
        gl.useProgram(this.progShadow.p);
        this.bindScene(this.progShadow, time);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadow.fb);
        gl.viewport(0, 0, SHADOW_W, SHADOW_H);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        this.dirty = false;
      }

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, r.canvas.width, r.canvas.height);
      this.updateCamera(dt || 0.016, r.canvas.width / r.canvas.height);
      const fog = [c.paperDeep[0] * 0.5, c.paperDeep[1] * 0.5, c.paperDeep[2] * 0.5];

      // background
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      gl.bindVertexArray(this.emptyVAO);
      gl.useProgram(this.progBG.p);
      gl.uniform3fv(this.progBG.u.u_paper, c.paper);
      gl.uniform3fv(this.progBG.u.u_paperDeep, c.paperDeep);
      gl.uniform1f(this.progBG.u.u_harmony, harmony);
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
      gl.uniform3fv(u.u_fog, fog);
      gl.uniform3fv(u.u_eye, this.eye);
      gl.bindVertexArray(this.boardVAO);
      gl.drawElements(gl.TRIANGLES, this.boardCount, gl.UNSIGNED_INT, 0);

      // pieces
      P = this.progBlock; u = P.u;
      gl.useProgram(P.p);
      this.bindScene(P, time);
      gl.uniformMatrix4fv(u.u_viewProj, false, this.viewProj);
      gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, r.surface.tex); gl.uniform1i(u.u_surface, 5);
      gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, r.texWill); gl.uniform1i(u.u_will, 4);
      const R = RUIN.will.rect(r.aspect);
      gl.uniform4f(u.u_gridRect, R.x0, R.y0, R.x1, R.y1);
      for (const k of ['paper', 'paperDeep', 'cream', 'ink', 'inkEdge', 'tissue', 'signal', 'washA']) gl.uniform3fv(u['u_' + k], c[k]);
      gl.uniform3fv(u.u_fog, fog);
      gl.uniform3fv(u.u_eye, this.eye);
      gl.bindVertexArray(this.cubeVAO);

      // the board's edge
      const A = r.aspect;
      this.drawBox(u, [0, -0.0305, 0], [A / 2, 0.03, 0.5], { mode: 2, seed: 0.3, wobble: 0 });

      const now = performance.now() / 1000;
      const W = RUIN.will, will = r.willData;
      this.blocks.forEach((b, i) => {
        // a rejected piece shivers: read the excess under its centre
        let shake = 0;
        if (will) {
          const g = W.worldToGrid(b.c[0] + A / 2, b.c[2] + 0.5, A);
          const ci = Math.floor(g.gx), cj = Math.floor(g.gy);
          if (ci >= 0 && cj >= 0 && ci < W.COLS && cj < W.ROWS) shake = will[(cj * W.COLS + ci) * 4 + 1] / 255;
        }
        const lift = b.drop * b.drop * 0.08;
        this.drawBox(u, [b.c[0], b.c[1] + lift, b.c[2]], b.h, {
          mode: 0, seed: b.seed, self: i, shake: shake * shake,
          grow: Math.min(1, (now - b.born) / 45),
        });
      });

      // ghost of the next piece, or the mark on the piece about to be lifted
      const lifted = this.blocks[this.liftIndex];
      if (this.ghost || lifted) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(false);
        if (this.ghost) this.drawBox(u, this.ghost.c, this.ghost.h, { mode: 1, seed: 1.7, valid: this.ghost.valid ? 1 : 0, wobble: 0.4 });
        if (lifted) this.drawBox(u, lifted.c, lifted.h.map((v) => v + 0.002), { mode: 1, seed: 2.3, valid: 0, wobble: 0.4 });
        gl.depthMask(true);
        gl.disable(gl.BLEND);
      }
      gl.bindVertexArray(null);
      return moving;
    }

    drawBox(u, c, h, o) {
      const gl = this.gl;
      gl.uniform3f(u.u_center, c[0], c[1], c[2]);
      gl.uniform3f(u.u_half, h[0], h[1], h[2]);
      gl.uniform1f(u.u_seed, o.seed || 0);
      gl.uniform1f(u.u_mode, o.mode || 0);
      gl.uniform1f(u.u_valid, o.valid ?? 1);
      gl.uniform1f(u.u_grow, o.grow || 0);
      gl.uniform1f(u.u_shake, o.shake || 0);
      gl.uniform1f(u.u_wobble, o.wobble ?? 1);
      gl.uniform1i(u.u_self, o.self ?? -1);
      gl.drawElements(gl.TRIANGLES, this.cubeCount, gl.UNSIGNED_SHORT, 0);
    }
  }

  RUIN.Scene = Scene;
  RUIN.scene = { MAXB };
})((window.RUIN = window.RUIN || {}));
