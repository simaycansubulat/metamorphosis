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
  const SMAP = 2048;
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
  function ortho(l, r, b, t, n, f) {
    return new Float32Array([2 / (r - l), 0, 0, 0, 0, 2 / (t - b), 0, 0, 0, 0, -2 / (f - n), 0, -(r + l) / (r - l), -(t + b) / (t - b), -(f + n) / (f - n), 1]);
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
  precision highp sampler2DShadow;
  `;

  const SCENE = `
  uniform sampler2D u_boxes;   // MAXB x 2 : (x, bottom, z, yaw) (half x, height, half z, -)
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
  // a real shadow map, cast by the pieces' own meshes; softened with a
  // rotated poisson disc so its edge breathes like soot, not like a stencil
  uniform highp sampler2DShadow u_smap;
  uniform mat4 u_lightVP;
  float shadowAt(vec3 wp, float bias, float radius) {
    vec4 lp = u_lightVP * vec4(wp, 1.0);
    vec3 c = lp.xyz / lp.w * 0.5 + 0.5;
    if (c.x < 0.0 || c.y < 0.0 || c.x > 1.0 || c.y > 1.0 || c.z > 1.0) return 1.0;
    float a = 6.2831 * hash12(wp.xz * 913.0 + wp.y * 71.0);
    mat2 R = mat2(cos(a), sin(a), -sin(a), cos(a));
    float s = 0.0;
    for (int i = 0; i < 12; i++) {
      float r = sqrt((float(i) + 0.5) / 12.0);
      float th = float(i) * 2.39996;
      vec2 o = R * vec2(cos(th), sin(th)) * r * radius / 2048.0;
      s += texture(u_smap, vec3(c.xy + o, c.z - bias));
    }
    return s / 12.0;
  }
  // distance to a piece's footprint, in its own turned frame, with rounded corners
  float footDist(vec2 p, int i, out float h, out float y0) {
    vec4 c = texelFetch(u_boxes, ivec2(i, 0), 0);
    vec4 e = texelFetch(u_boxes, ivec2(i, 1), 0);
    vec2 d = p - c.xz;
    float cs = cos(c.w), sn = sin(c.w);
    vec2 q = vec2(cs * d.x - sn * d.y, sn * d.x + cs * d.y);
    float r = min(e.x, e.z) * 0.85;
    vec2 k = abs(q) - e.xz + r;
    h = e.y; y0 = c.y;
    return length(max(k, 0.0)) + min(max(k.x, k.y), 0.0) - r;
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

  const DEPTH_FS = HEAD + `
  void main() {}`;

  const BG_FS = HEAD + RUIN.shaders.NOISE + `
  uniform vec3 u_ground;
  in vec2 v_uv;
  out vec4 outColor;
  void main() {
    outColor = vec4(u_ground, 0.0);                 // alpha 0: empty space (read by the TOUCH pass)
  }`;

  /* TOUCH: the whole view re-read as light in a dark space (press V to switch).
   * Whatever is not empty ground becomes a halftone grid of light points; its
   * contours become glowing lines; only fire and pigment keep their colour; and
   * every movement leaves a fading trail (feedback of the previous frame). */
  const POST_FS = HEAD + RUIN.shaders.NOISE + `
  uniform sampler2D u_scene, u_prev;
  uniform vec3 u_ground, u_tcol;
  uniform vec2 u_px;
  uniform float u_cell, u_time, u_burst, u_tamt;
  in vec2 v_uv;
  out vec4 outColor;
  float lumOf(vec3 c) { return dot(c, vec3(0.3, 0.59, 0.11)); }
  bool isGuide(float a) { return a > 0.86 && a < 0.94; }
  // how much light a place carries: objects by their own light, the guide piece glowing,
  // the ground only where something marks it
  float lightOf(vec4 s) {
    if (isGuide(s.a)) return 0.55 + 0.4 * (0.5 + 0.5 * sin(u_time * 4.0));
    if (s.a > 0.75) return mix(0.16 + 0.55 * lumOf(s.rgb), 0.18 + 0.62 * lumOf(s.rgb), u_tamt);
    if (s.a > 0.25) return clamp(length(s.rgb - u_ground) * 1.1 - 0.16, 0.0, 1.0) * 0.35 * (1.0 - 0.7 * u_tamt);
    return 0.0;
  }
  vec2 flow(vec2 p, float t) {
    return vec2(snoise(p * 2.2 + vec2(0.0, t * 0.07)), snoise(p * 2.2 + vec2(5.2, -t * 0.06)));
  }
  void main() {
    float t = u_time;
    vec2 aspect = vec2(u_px.y / u_px.x, 1.0);
    vec2 uv = v_uv + 0.004 * flow(v_uv * aspect, t);
    float v = 0.0, hot = 0.0, guide = 0.0;
    vec3 hue = vec3(0.0);
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 o = vec2(float(i), float(j)) * u_px * mix(3.5, 2.4, u_tamt);   // soft masses of light, not boxes
      vec4 s = texture(u_scene, uv + o);
      float w = (i == 0 && j == 0) ? 2.0 : 1.0;
      v += lightOf(s) * w;
      if (isGuide(s.a)) guide += w;
      float mx = max(s.r, max(s.g, s.b)), mn = min(s.r, min(s.g, s.b));
      float h = smoothstep(0.45, 0.8, (mx - mn) / max(mx, 1e-3)) * step(0.25, s.a) * (isGuide(s.a) ? 0.0 : 1.0);
      hot += h * w; hue += s.rgb / max(mx, 1e-3) * h * w;
    }
    v /= 10.0; hot /= 10.0; guide /= 10.0; hue /= max(hot * 10.0, 1e-3);
    float solid = step(0.75, texture(u_scene, uv).a);
    // its reach: light gathered from far around (where tendrils may grow)
    float reach = 0.0;
    for (int k = 0; k < 8; k++) {
      float a = float(k) * 0.7854 + t * 0.05, r = (k % 2 == 0 ? 30.0 : 64.0);
      reach += lightOf(texture(u_scene, uv + vec2(cos(a), sin(a)) * u_px * r));
    }
    reach = max(reach / 8.0 * 1.6, v);
    // tendrils: thin nervous threads of light writhing out of every form
    vec2 q = v_uv * aspect * 3.2;
    q += 0.35 * vec2(snoise(q * 0.9 + vec2(t * 0.32, 0.0)), snoise(q * 0.9 + vec2(4.0, -t * 0.27)));
    q += 0.018 * vec2(snoise(q * 7.0 + t * 5.0), snoise(q * 7.0 - t * 4.3 + 9.0)) * (1.0 + 2.0 * u_burst);
    float r1 = 1.0 - abs(snoise(q + vec2(0.0, t * 0.16)));
    float r2 = 1.0 - abs(snoise(q * 2.3 + 11.0 - vec2(t * 0.22, 0.0)));
    float r3 = 1.0 - abs(snoise(q * 5.1 + 23.0 + vec2(0.0, t * 0.3)));
    float threads = pow(r1, 9.0) + 0.8 * pow(r2, 12.0) * smoothstep(0.8, 0.97, r1 + 0.12) + 0.5 * pow(r3, 16.0);
    threads *= 0.75 + 0.25 * snoise(q * 3.0 + t * 0.6);
    float grow = smoothstep(0.03 - 0.02 * u_burst, 0.35 - 0.2 * u_burst, reach) * (0.6 + 0.4 * snoise(q * 0.5 + t * 0.09));
    float wisp = smoothstep(0.08, 0.5, reach) * 0.22 * (0.5 + 0.5 * snoise(q * 1.4 - t * 0.12));
    float pulse = pow(0.5 + 0.5 * snoise(vec2(t * 1.3, 7.0)), 3.0);
    v *= 0.85 + 0.45 * pulse + 1.4 * u_burst;
    v += reach * u_burst * 0.9;
    float smoke = 1.0 - u_tamt * (0.3 + 0.35 * solid);               // in a game the threads stay mostly around the form
    v = max(v, (threads * grow * (1.1 + 0.5 * pulse + u_burst) + wisp) * smoke);
    // trails: last frame's light, blurred, drifting, fading like smoke
    vec2 fuv = (v_uv - 0.5) * 0.9985 + 0.5 + 0.0035 * flow(v_uv * aspect * 1.2, t * 1.6) + vec2(0.0, -0.0006);
    vec2 bl = u_px * 2.0;
    float pv = (texture(u_prev, fuv).a * 2.0 + texture(u_prev, fuv + vec2(bl.x, 0.0)).a + texture(u_prev, fuv - vec2(bl.x, 0.0)).a
              + texture(u_prev, fuv + vec2(0.0, bl.y)).a + texture(u_prev, fuv - vec2(0.0, bl.y)).a) / 6.0;
    v = max(v, pv * mix(0.95, 0.91, u_tamt) - 0.008);
    // grain: every grain of the screen is lit or not, more often where there is more light
    float gate = smoothstep(0.04, 0.12, max(reach, pv));
    vec2 g = floor(gl_FragCoord.xy / u_cell);
    float n = hash12(g + vec2(floor(t * 20.0) * 17.0, floor(t * 20.0) * 31.0));
    float haze = (0.05 + 0.08 * (0.5 + 0.5 * snoise(vec2(t * 0.05, 3.0))) + 0.3 * u_burst * smoothstep(0.0, 0.25, reach)) * smoothstep(0.06, 0.3, reach);
    float p = (haze + (1.0 - haze) * pow(clamp((v - 0.045) / 0.955, 0.0, 1.0), 0.85)) * gate;
    float on = step(n, p);
    float lvl = (0.32 + 0.68 * clamp(v * 1.3, 0.0, 1.0)) * (0.75 + 0.25 * hash12(g * 1.7 + floor(t * 20.0)));
    // colour: cold light in the history; the game's colour once the game begins; the guide piece brightest
    vec3 base = mix(vec3(0.86, 0.88, 0.9), u_tcol, u_tamt);
    base = mix(base, mix(u_tcol, vec3(1.0), 0.35), clamp(guide * 1.5, 0.0, 1.0) * u_tamt);
    vec3 grain = mix(base, hue * vec3(1.0, 0.82, 0.7), clamp(hot * 1.5, 0.0, 1.0));
    float sv = clamp((v - 0.045) / 0.955, 0.0, 1.0) * gate;
    vec3 col = grain * (on * lvl * 0.78 + sv * 0.32 + guide * 0.25);
    outColor = vec4(col, v);
  }`;
  const COPY_FS = HEAD + `
  uniform sampler2D u_tex;
  in vec2 v_uv;
  out vec4 outColor;
  void main() { outColor = texture(u_tex, v_uv); }`;

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
  uniform sampler2D u_surface, u_marks;
  uniform vec3 u_inkEdge, u_ink, u_fog, u_eye, u_ground;
  in vec2 v_uv;
  in vec3 v_world;
  out vec4 outColor;

  // how close the nearest grounded piece is (0..1), and how much it shelters the ground
  float nearPieces(vec2 p, out float ao) {
    float near = 0.0;
    ao = 1.0;
    for (int i = 0; i < ${MAXB}; i++) {
      if (i >= u_nbox) break;
      float h, y0;
      float d = max(footDist(p, i, h, y0), 0.0);
      float w = exp(-max(y0, 0.0) / 0.03);                    // pieces resting on others root less
      float reach = 0.08 + 0.5 * h;                 // taller pieces send their veins further
      near = max(near, w * exp(-d / reach));
      ao = min(ao, 1.0 - 0.6 * w * exp(-d / 0.014));
    }
    return near;
  }

  // mycelial veins: dark roots at the foot of the stones that taper and branch
  // into ever finer hairs as they spread. Each finer order only grows along
  // the coarser one before it, so the network branches instead of tiling.
  // returns (ink, soft shadow)
  vec2 veins(vec2 p, float near, float t) {
    vec2 w = p + 0.045 * vec2(fbm(p * 5.0 + 1.7 + t * 0.004), fbm(p * 5.0 - 4.1));
    float ink = 0.0, halo = 0.0, parent = 1.0;
    float f = 7.0, width = 0.075, reach = 0.04;
    for (int o = 0; o < 4; o++) {
      vec2 q = w * f + float(o) * 17.3;
      q += 0.25 * vec2(snoise(q * 2.3), snoise(q * 2.3 + 9.0));      // kinks, no straight runs
      float r = 1.0 - abs(snoise(q));                                  // 1 on the vein's axis
      float grow = smoothstep(reach, reach + 0.35, near);              // how far this order reaches
      // veins run in stretches and end in a fine point, so they branch instead of closing into cells
      float run = smoothstep(-0.05, 0.55, snoise(q * 0.32 + 31.0 + float(o) * 5.0));
      float wd = width * (0.2 + 0.8 * near) * grow * run;              // tapers away from the stone
      float line = smoothstep(1.0 - wd, 1.0 - wd * 0.2, r) * parent;
      ink = max(ink, line * (1.0 - 0.18 * float(o)));
      halo = max(halo, smoothstep(1.0 - wd * 4.0, 1.0, r) * parent * grow);
      // the next, finer order only sprouts beside this one
      parent *= smoothstep(1.0 - wd * 6.0 - 0.06, 1.0 - wd * 0.5, r);
      f *= 2.1; width *= 0.72;
    }
    return vec2(ink, halo);
  }

  void main() {
    vec4 s = texture(u_surface, v_uv);
    // a calm, clean ground; the field only shows as a few veins where pieces are born
    vec3 col = u_ground;
    float ao;
    float near = nearPieces(v_world.xz, ao);
    // an organic, ragged border: the field spreads out from the pieces like a stain
    float edgeN = fbm(v_uv * 7.0 + 2.0) * 0.5 + 0.5 + 0.25 * snoise(v_uv * 40.0);
    float field = smoothstep(0.18, 0.5, near * (0.7 + 0.6 * edgeN));
    // beyond it, the longest veins still run out a little further
    float runner = s.a * smoothstep(0.06, 0.25, near) * smoothstep(0.4, 0.8, s.a);
    float show = max(field, runner);
    col = mix(col, s.rgb, show * 0.6);

    // the veins themselves: ink with a faint wet halo, a few cream fibres among them
    vec2 vn = veins(v_world.xz, near, u_time);
    float fibre = smoothstep(0.55, 0.85, snoise(v_world.xz * 3.0 + 5.0));
    vec3 veinCol = mix(u_inkEdge * 0.9, u_ink, smoothstep(0.3, 1.0, vn.x));
    col *= 1.0 - vn.y * 0.1;
    col = mix(col, veinCol, vn.x * 0.92 * (1.0 - fibre * 0.6));
    col = mix(col, col * 1.15 + 0.04, vn.x * fibre * 0.5);

    // relief lighting from the matter channel
    vec2 tx = 1.0 / vec2(textureSize(u_surface, 0));
    float hL = textureLod(u_surface, v_uv - vec2(tx.x * 1.5, 0.0), 0.7).a;
    float hR = textureLod(u_surface, v_uv + vec2(tx.x * 1.5, 0.0), 0.7).a;
    float hD = textureLod(u_surface, v_uv - vec2(0.0, tx.y * 1.5), 0.7).a;
    float hU = textureLod(u_surface, v_uv + vec2(0.0, tx.y * 1.5), 0.7).a;
    float k = ${RELIEF} * 2.2;
    vec3 n = normalize(vec3(-(hR - hL) * k / (3.0 * tx.x * u_aspect), 1.0, (hU - hD) * k / (3.0 * tx.y)));
    col *= 1.0 + (dot(n, u_light) - u_light.y) * 0.8 * show;

    // what the daemon left on the ground: grit of the ruin, footprints, paint
    vec2 mj = v_uv + 0.0012 * vec2(snoise(v_uv * 90.0), snoise(v_uv * 90.0 + 4.0));
    vec4 mk = texture(u_marks, mj);
    float tooth = 0.75 + 0.25 * fbm(v_uv * 160.0);
    col = mix(col, mk.rgb, clamp(mk.a * tooth, 0.0, 1.0));

    // the pieces' shadows bleed into the linen like soot
    vec3 gp = vec3(v_world.x, 0.0, v_world.z) + 0.0035 * vec3(snoise(v_uv * 46.0), 0.0, snoise(v_uv * 46.0 + 7.3));
    float lit = shadowAt(gp, 0.0015, 2.5 + 2.0 * (fbm(v_uv * 12.0) * 0.5 + 0.5));
    float soot = 0.85 + 0.3 * fbm(v_uv * 22.0 + 3.0);
    float dark = (1.0 - lit) * 0.55 * soot + (1.0 - ao) * 0.7;
    float hair = smoothstep(0.35, 0.9, snoise(v_uv * vec2(30.0, 380.0)));
    dark += (1.0 - lit) * hair * 0.06;
    col *= mix(vec3(1.0), u_inkEdge * 1.2, clamp(dark, 0.0, 0.82));

    // no edge, no slab: the ground simply continues
    vec2 ed = min(v_uv, 1.0 - v_uv) * vec2(u_aspect, 1.0);
    col = mix(u_ground, col, smoothstep(0.0, 0.1, min(ed.x, ed.y)));
    outColor = vec4(col, 0.5);                      // alpha 0.5: ground (read by the TOUCH pass)
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
  uniform float u_burn, u_guide;
  uniform float u_seed, u_g, u_mode, u_tint;   // mode: 0 piece · 1 the old ruin · 2 board edge; tint (ruin): 0 stone · 1 pale · 2 brick · 3 mortar
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
    col = mix(col, wallCol, mem * 0.16);

    // --- stone: the piece is cut stone first, the daemon's pattern only stains it ----------
    vec3 sp = wp * 1.0 + u_seed * 3.1;
    float strata = vnoise3(vec3(sp.x * 9.0, sp.y * 70.0 + vnoise3(sp * 14.0) * 3.0, sp.z * 9.0));
    float grainN = hash13(floor(wp * 2600.0));                        // mineral grain
    float pits = smoothstep(0.72, 0.9, vnoise3(sp * 210.0)) * 0.5 + smoothstep(0.8, 0.95, vnoise3(sp * 75.0)) * 0.6;
    float mottle = vnoise3(sp * 24.0) * 0.6 + vnoise3(sp * 60.0) * 0.4;
    vec3 stone = mix(mix(u_cream, u_washA, 0.35 + 0.3 * hash12(vec2(u_seed, 3.0))), mix(u_washB, u_paperDeep, 0.5), mottle * 0.55);
    stone *= 0.9 + 0.12 * strata;
    stone *= 0.93 + 0.12 * grainN;
    stone *= 1.0 - pits * 0.32;
    col = mix(stone, col, 0.32 + 0.4 * pat.a);

    // --- the new body is grown out of the ruin's own matter: its limestone, ochre and
    // pale stones, and the courses and joints of the old wall still running through it
    if (u_mode < 0.5) {
      float cy = wp.y / 0.017 + 0.5 * vnoise3(sp * 16.0);
      float row = floor(cy), fy = fract(cy);
      float al = dot(wp.xz, vec2(0.98, 0.2)) / 0.03 + hash12(vec2(row, u_seed)) * 3.0;
      float fx = fract(al), cell = hash12(vec2(row * 1.7 + floor(al), u_seed * 5.3));
      vec3 lime = mix(vec3(0.74, 0.71, 0.65), vec3(0.6, 0.57, 0.52), cell);
      lime = mix(lime, mix(vec3(0.74, 0.65, 0.5), vec3(0.6, 0.51, 0.4), cell), step(0.62, fract(cell * 7.3)));
      lime = mix(lime, vec3(0.88, 0.85, 0.77), step(0.86, fract(cell * 13.1)));
      lime *= 0.86 + 0.16 * mottle + 0.08 * (grainN - 0.5);
      lime *= 1.0 - pits * 0.4;
      float side = 1.0 - smoothstep(0.45, 0.7, tw.y);
      float joint = max(1.0 - smoothstep(0.0, 0.09, min(fy, 1.0 - fy)), 1.0 - smoothstep(0.0, 0.06, min(fx, 1.0 - fx))) * side;
      lime = mix(lime, vec3(0.36, 0.33, 0.28), joint * 0.75);
      col = mix(col, lime, 0.66);
    }

    // --- the old ruin: weathered limestone rubble, grime, lichen, moss; pale arch, red brick, mortar ---
    float isRuin = step(0.5, u_mode) * (1.0 - step(1.5, u_mode));
    float ember = 0.0;
    if (isRuin > 0.5) {
      float tone = hash12(vec2(u_seed * 7.1, 2.0));
      float t2 = hash12(vec2(u_seed * 3.7, 9.0));
      vec3 lime = mix(vec3(0.74, 0.71, 0.65), vec3(0.6, 0.57, 0.52), tone);      // grey limestone
      lime = mix(lime, mix(vec3(0.74, 0.65, 0.5), vec3(0.6, 0.51, 0.4), tone), step(0.6, t2));   // ochre and brown ones
      lime = mix(lime, vec3(0.88, 0.85, 0.77), step(0.86, t2));                 // a few pale ones
      if (u_tint > 0.5 && u_tint < 1.5) lime = mix(vec3(0.88, 0.85, 0.77), vec3(0.78, 0.74, 0.64), tone);   // pale dressed stone
      if (u_tint > 1.5 && u_tint < 2.5) lime = mix(vec3(0.56, 0.27, 0.18), vec3(0.66, 0.38, 0.26), tone);   // brick
      if (u_tint > 2.5) lime = vec3(0.36, 0.33, 0.28);                            // mortar, deep in the joints
      lime *= 0.86 + 0.16 * mottle + 0.08 * (grainN - 0.5);
      lime *= 1.0 - pits * 0.45;
      float along = dot(wp.xz, vec2(0.98, 0.2));
      float runs = smoothstep(0.35, 0.9, snoise(vec2(along * 90.0, wp.y * 6.0 + u_seed)) * 0.5 + 0.5);
      float grime = runs * 0.3 + (1.0 - smoothstep(0.0, 0.1, wp.y)) * 0.3;
      lime *= 1.0 - grime * 0.4;
      lime = mix(lime, lime * 0.45, line * 0.6);                                   // shadowed arrises
      float lich = smoothstep(0.66, 0.82, vnoise3(wp * 95.0 + u_seed));
      lime = mix(lime, mix(vec3(0.86, 0.85, 0.78), vec3(0.7, 0.64, 0.38), step(0.5, hash12(floor(wp.xz * 300.0)))), lich * 0.45 * step(u_tint, 0.5));
      float moss = smoothstep(0.55, 0.8, vnoise3(wp * 40.0 - u_seed)) * (max(n.y, 0.0) * 0.8 + (1.0 - smoothstep(0.0, 0.07, wp.y)));
      col = mix(lime, vec3(0.3, 0.36, 0.17), clamp(moss, 0.0, 1.0) * 0.6 * step(u_tint, 0.5));
      // fire: the stone blackens with soot, embers glow in its cracks
      if (u_burn > 0.0) {
        float sootN = smoothstep(0.25, 0.75, vnoise3(wp * 55.0 + u_seed));
        col = mix(col, vec3(0.09, 0.08, 0.07), u_burn * (0.6 + 0.35 * sootN));
        float flick = 0.55 + 0.45 * sin(u_time * 11.0 + u_seed * 7.0 + wp.y * 80.0);
        ember = (u_burn * (1.0 - u_burn) * 2.4 + 0.08 * u_burn) * smoothstep(0.62, 0.9, vnoise3(wp * 190.0 - vec3(0.0, u_time * 0.4, 0.0))) * flick;
      }
    }

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
    float excess = clamp(will.g, 0.0, 1.0) * (1.0 - step(0.5, u_mode)), harmony = clamp(will.b, 0.0, 1.0) * (1.0 - step(0.5, u_mode));
    vec2 sq = vec2(dot(wp.xz, vec2(0.8, 0.6)) * 30.0 + u_time * 0.35, wp.y * 150.0);
    float scratch = smoothstep(0.6, 0.95, snoise(sq + 2.0 * fbm(wp.xz * 9.0 + u_time * 0.05)));
    scratch *= excess * (0.55 + 0.45 * sin(u_time * 5.0 + u_seed * 3.0));
    col = mix(col, u_signal * 0.85, scratch * 0.55 + excess * 0.14);
    col = mix(col, mix(u_cream, u_washA, 0.35), harmony * 0.14);

    // --- light: crisp facets, other pieces cast shadows -----------------------------------
    float sh = ndl > 0.0 ? shadowAt(wp + n * 0.002, 0.0012, 1.4) : 0.0;
    float lit = 0.5 + 0.55 * max(ndl, 0.0) * sh + 0.08 * n.y + isRuin * 0.24;   // the ruin stands in daylight
    lit *= 0.75 + 0.25 * smoothstep(0.0, 0.03, wp.y);
    col *= lit;
    col += vec3(1.0, 0.42, 0.1) * ember;

    // worn arrises: the sharp folds catch light, with only a fine dark seam
    col = mix(col, col * 1.18 + 0.03, line * 0.5);
    col = mix(col, u_ink, line * 0.22);
    col = mix(col, u_fog, smoothstep(1.6, 4.5, distance(wp, u_eye)) * 0.45);
    if (u_guide > 0.5) { outColor = vec4(vec3(0.95), 0.9); return; }     // the next piece to place: alpha 0.9 marks it
    outColor = vec4(col, 1.0);
  }`;

  /* the ruin's dust: soft grains of stone, drifting (growth.dust) */
  const DUST_VS = HEAD + `
  layout(location = 0) in vec4 a_p;      // x, y, z, alpha
  layout(location = 1) in float a_size;  // world size
  uniform mat4 u_viewProj;
  uniform float u_px;                    // pixels per world unit at distance 1
  out float v_a;
  out float v_seed;
  void main() {
    gl_Position = u_viewProj * vec4(a_p.xyz, 1.0);
    gl_PointSize = clamp(a_size * u_px / gl_Position.w, 1.0, 48.0);
    v_a = a_p.w;
    v_seed = fract(sin(float(gl_VertexID) * 12.9898) * 43758.5453);
  }`;
  const DUST_FS = HEAD + `
  uniform vec3 u_dustA, u_dustB;
  in float v_a;
  in float v_seed;
  out vec4 outColor;
  void main() {
    vec2 q = gl_PointCoord * 2.0 - 1.0;
    float r = dot(q, q);
    if (r > 1.0) discard;
    float a = (1.0 - r) * (1.0 - r) * v_a;
    outColor = vec4(mix(u_dustA, u_dustB, v_seed) * a, a);   // premultiplied
  }`;

  /* the ruin from its 3D model: one mesh, every part moved by its own row in u_state
     * (row 0 pivot + plant, row 1 offset + spin, row 2 scale) */
  const RUINM_VS = HEAD + `
  layout(location = 0) in vec3 a_local;
  layout(location = 1) in vec3 a_nrm;
  layout(location = 2) in vec3 a_col;
  layout(location = 3) in vec2 a_part;   // index, plant
  uniform mat4 u_viewProj;
  uniform sampler2D u_state;
  out vec3 v_world, v_nrm, v_col;
  out float v_plant, v_fresh;
  void main() {
    int id = int(a_part.x + 0.5);
    vec4 pv = texelFetch(u_state, ivec2(id, 0), 0);
    vec4 of = texelFetch(u_state, ivec2(id, 1), 0);
    vec4 sf = texelFetch(u_state, ivec2(id, 2), 0);
    float sc = sf.x;
    v_fresh = sf.y;
    float c = cos(of.w), s = sin(of.w);
    vec3 l = a_local * sc;
    vec3 wp = pv.xyz + of.xyz + vec3(c * l.x + s * l.z, l.y, -s * l.x + c * l.z);
    if (sc <= 0.0) wp = vec3(0.0, -10.0, 0.0);
    v_world = wp;
    v_nrm = vec3(c * a_nrm.x + s * a_nrm.z, a_nrm.y, -s * a_nrm.x + c * a_nrm.z);
    v_col = a_col; v_plant = a_part.y;
    gl_Position = u_viewProj * vec4(wp, 1.0);
  }`;
  const RUINM_FS = HEAD + RUIN.shaders.NOISE + SCENE + `
  uniform vec3 u_fog, u_eye;
  in vec3 v_world, v_nrm, v_col;
  in float v_plant, v_fresh;
  out vec4 outColor;
  void main() {
    vec3 n = normalize(v_nrm), wp = v_world, col = v_col;
    col = mix(col, vec3(0.86, 0.83, 0.76), v_fresh * 0.6);          // fresh from the palace, not yet weathered
    if (v_plant < 0.5) {
      // weathered stone: grain, pits, grime run down, lichen, damp at the foot
      col *= 0.86 + 0.2 * vnoise3(wp * 180.0) + 0.08 * (vnoise3(wp * 700.0) - 0.5);
      col *= 1.0 - smoothstep(0.75, 0.92, vnoise3(wp * 420.0)) * 0.35;
      col *= 1.0 - smoothstep(0.55, 0.95, vnoise3(vec3(wp.x * 60.0, wp.y * 14.0, wp.z * 60.0))) * 0.12;   // faint grime
      col = mix(col, vec3(0.8, 0.78, 0.66), smoothstep(0.7, 0.85, vnoise3(wp * 130.0)) * 0.3);
      col *= 1.0 - (1.0 - smoothstep(0.0, 0.06, wp.y)) * 0.25;
    } else {
      col *= 0.85 + 0.3 * vnoise3(wp * 300.0);
      if (dot(n, u_eye - wp) < 0.0) n = -n;                      // leaves are lit on both sides
    }
    float ndl = v_plant > 0.5 ? abs(dot(n, u_light)) : max(dot(n, u_light), 0.0);
    float sh = shadowAt(wp + n * 0.002, 0.0015, 1.4);
    float lit = 0.62 + 0.55 * ndl * sh + 0.08 * n.y;
    col *= lit;
    col = mix(col, u_fog, smoothstep(1.6, 4.5, distance(wp, u_eye)) * 0.45);
    outColor = vec4(col, 1.0);
  }`;

  /* the ruin's ivy: lobed leaves and vine stems, one instanced quad each (growth.ivy) */
  const IVY_VS = HEAD + `
  layout(location = 0) in vec4 a_c;      // centre, kind (0 leaf, 1 stem)
  layout(location = 1) in vec4 a_n;      // facing normal, shade
  layout(location = 2) in vec4 a_s;      // size, rotation, falls at, -
  uniform mat4 u_viewProj;
  uniform float u_t;
  out vec2 v_q;
  out vec3 v_n, v_world;
  out float v_kind, v_shade, v_gone;
  void main() {
    int id = gl_VertexID % 6;
    vec2 q = vec2(id == 1 || id == 2 || id == 4 ? 1.0 : -1.0, id == 2 || id == 4 || id == 5 ? 1.0 : -1.0);
    vec3 n = normalize(a_n.xyz);
    vec3 up = abs(n.y) > 0.95 ? vec3(1, 0, 0) : vec3(0, 1, 0);
    vec3 t = normalize(cross(up, n)), b = cross(n, t);
    float c = cos(a_s.y), s = sin(a_s.y);
    vec2 r = vec2(c * q.x - s * q.y, s * q.x + c * q.y);
    vec2 k = a_c.w > 1.5 ? vec2(0.2, 1.0) : a_c.w > 0.5 ? vec2(0.16, 1.0) : vec2(1.0);   // stems and blades are thin
    vec3 p = a_c.xyz + (t * r.x * k.x + b * r.y * k.y) * a_s.x;
    // with the wall they fall
    float f = max(u_t - a_s.z, 0.0);
    p.y -= 1.6 * f * f;
    v_gone = step(p.y, -0.002);
    v_q = q; v_n = n; v_world = p; v_kind = a_c.w; v_shade = a_n.w;
    gl_Position = u_viewProj * vec4(p, 1.0);
  }`;
  const IVY_FS = HEAD + RUIN.shaders.NOISE + SCENE + `
  uniform vec3 u_fog, u_eye;
  in vec2 v_q;
  in vec3 v_n, v_world;
  in float v_kind, v_shade, v_gone;
  out vec4 outColor;
  void main() {
    if (v_gone > 0.5) discard;
    vec3 col;
    if (v_kind > 1.5) {
      if (abs(v_q.x) > 0.95 * (1.0 - (v_q.y + 1.0) * 0.5)) discard;          // a tapering blade
      col = mix(vec3(0.3, 0.38, 0.14), vec3(0.6, 0.6, 0.3), v_shade) * (0.75 + 0.3 * (v_q.y + 1.0) * 0.5);
    } else if (v_kind > 0.5) {
      if (abs(v_q.x) > 0.9) discard;
      col = mix(vec3(0.22, 0.17, 0.11), vec3(0.32, 0.26, 0.17), v_shade);
    } else {
      // an ivy leaf: three to five pointed lobes, stalk at the bottom
      vec2 q = v_q * vec2(1.0, -1.0) + vec2(0.0, 0.12);
      float a = atan(q.x, q.y), r = length(q);
      float lobes = 0.62 + 0.34 * pow(abs(cos(a * 1.5)), 3.0) - 0.18 * smoothstep(1.9, 3.1, abs(a));
      if (r > lobes) discard;
      float vein = smoothstep(0.06, 0.0, abs(fract(a * 0.955 + 0.5) - 0.5) * r) * (1.0 - r / lobes);
      col = mix(vec3(0.14, 0.2, 0.07), vec3(0.38, 0.44, 0.17), v_shade);
      col = mix(col, col * 1.6 + vec3(0.03, 0.04, 0.0), vein * 0.5);
      col *= 0.82 + 0.25 * r;
    }
    vec3 n = normalize(v_n);
    float ndl = abs(dot(n, u_light));
    float sh = shadowAt(v_world + n * 0.002, 0.0015, 1.4);
    float lit = 0.62 + 0.6 * ndl * sh;
    vec3 h = normalize(u_light + normalize(u_eye - v_world));
    float spec = pow(max(dot(n, h), 0.0), 40.0) * 0.25 * sh * step(v_kind, 0.5);   // waxy shine
    col = col * lit + spec;
    col = mix(col, u_fog, smoothstep(1.6, 4.5, distance(v_world, u_eye)) * 0.45);
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
    shard: (r) => ({ top: r.float(0.04, 0.18), tp: 1.1, tip: 0.35, bend: r.float(-0.35, 0.35), bulge: 0.12, jit: 0.14, corner: r.float(0.2, 0.4), f: 20 }),
    slab:  (r) => ({ top: r.float(0.8, 0.95), tp: 1, tip: 0.02, bend: 0, bulge: 0.1, jit: 0.1, corner: r.float(0.25, 0.45), f: 16, sag: r.float(-0.25, 0.25) }),
    knot:  (r) => ({ top: r.float(0.45, 0.75), tp: 1.2, tip: 0.08, bend: r.float(-0.1, 0.1), bulge: 0.28, jit: 0.16, corner: r.float(0.3, 0.5), f: 24 }),
    beam:  (r) => ({ top: r.float(0.82, 0.97), tp: 1, tip: 0.03, bend: r.float(-0.06, 0.06), bulge: 0.09, jit: 0.07, corner: r.float(0.25, 0.45), f: 14 }),
    box:   () => ({ top: 1, tp: 1, tip: 0, bend: 0, bulge: 0, jit: 0, corner: 0, f: 1 }),
    ball:  () => ({ top: 1, tp: 1, tip: 0, bend: 0, bulge: 0, jit: 0, corner: 0, f: 1 }),
    // a squared masonry stone (the ruin's wall): crisp, flat-faced, only lightly worn
    block: () => ({ top: 1, tp: 1, tip: 0, bend: 0, bulge: 0.1, jit: 0.08, corner: 0.35, f: 22 }),
  };

  function pieceGeometry(kind, size, seed) {
    const rng = new RUIN.Random(seed >>> 0);
    const noise = RUIN.createNoise3D(rng);
    const K = KINDS[kind](rng);
    const box = kind === 'box';
    const [sx, sy, sz] = size;
    // fine enough for chips and grain to read as stone, not as a block
    const seg = (d) => (kind === 'ball' ? 7 : box ? 1 : Math.max(2, Math.min(14, Math.round(d / 0.011))));
    const nx = seg(sx), ny = seg(sy), nz = seg(sz);
    const md = Math.min(sx, sy, sz);
    const tipX = rng.float(-1, 1) * K.tip * 0.4, tipZ = rng.float(-1, 1) * K.tip * 0.4;

    // every stone has its own character
    const style = kind === 'block' ? 'masonry' : rng.pick(['ashlar', 'ashlar', 'rubble', 'weathered', 'split', 'split']);
    const amp = { masonry: 0.13, ashlar: 0.05, rubble: 0.14, weathered: 0.1, split: 0.07 }[style] * md;
    const nChips = { masonry: rng.int(2, 6), ashlar: rng.int(3, 6), rubble: rng.int(9, 15), weathered: rng.int(4, 8), split: rng.int(5, 9) }[style];
    const squash = style === 'masonry' ? [1, 1] : [rng.float(0.86, 1.12), rng.float(0.86, 1.12)];     // uneven section
    const C = [0, sy * 0.5, 0];
    // cut planes slice facets off edges and corners, like knapped stone;
    // never from below, so it still stands flat
    const planes = [];
    for (let k = 0; k < nChips; k++) {
      const n = V.norm([rng.float(0.15, 1) * rng.pick([-1, 1]), rng.float(-0.2, 1), rng.float(0.15, 1) * rng.pick([-1, 1])]);
      const h = 0.5 * (Math.abs(n[0]) * sx + Math.abs(n[1]) * sy + Math.abs(n[2]) * sz);
      planes.push({ n, d: h - rng.float(0.08, style === 'rubble' ? 0.42 : style === 'masonry' ? 0.14 : 0.3) * md * 1.6 });
    }
    // a broken, slanted end
    if (style === 'split' || (style !== 'masonry' && rng.chance(0.35))) {
      const n = V.norm([rng.float(-0.45, 0.45), 1, rng.float(-0.45, 0.45)]);
      planes.push({ n, d: 0.5 * (Math.abs(n[0]) * sx + n[1] * sy + Math.abs(n[2]) * sz) - rng.float(0.15, 0.45) * md });
    }

    const verts = new Map();
    const P = [];
    const vid = (a, b, c) => {
      const k = a + ',' + b + ',' + c;
      if (verts.has(k)) return verts.get(k);
      const u = a / nx - 0.5, v = b / ny, w = c / nz - 0.5;
      let x = u * sx * squash[0], y = v * sy, z = w * sz * squash[1];
      if (kind === 'ball') {
        const cy = sy / 2, dy = y - cy, l = Math.hypot(x, dy, z) || 1, r = (sx / 2) * (1 + 0.05 * noise(x * 90, y * 90, z * 90));
        x = (x / l) * r; y = cy + (dy / l) * r; z = (z / l) * r;
      } else if (!box) {
        const t = Math.pow(v, K.tp);
        const taper = 1 + (K.top - 1) * t * 0.35;
        x *= taper; z *= taper;
        x += (tipX * sx + K.bend * 0.5 * sy) * t * t; z += tipZ * sz * t * t;
        if (K.sag) y += K.sag * 0.4 * sy * (1 - 4 * u * u) * (v > 0 ? 1 : 0.6);
        // weathered surface: two octaves of swelling and pitting
        const f1 = 1 / (md * 1.3), f2 = f1 * 3.1, o = (seed % 97) * 1.7;
        const nn = noise(x * f1 + o, y * f1, z * f1) + 0.45 * noise(x * f2 - o, y * f2, z * f2 + o);
        const len = Math.hypot(x, z) || 1;
        x += (x / len) * amp * nn; z += (z / len) * amp * nn;
        if (v > 0.999) y += amp * 0.8 * nn;
        // chips: project onto each cut plane
        for (const pl of planes) {
          const e = (x - C[0]) * pl.n[0] + (y - C[1]) * pl.n[1] + (z - C[2]) * pl.n[2] - pl.d;
          if (e > 0) { x -= pl.n[0] * e; y -= pl.n[1] * e; z -= pl.n[2] * e; }
        }
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
      return o == null || V.dot(normals[f], normals[o]) < 0.8 ? 1 : 0;
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
      this.progPost = renderer.program(FULL_VS, POST_FS);
      this.progCopy = renderer.program(FULL_VS, COPY_FS);
      this.touch = true;
      this.progDepth = renderer.program(PIECE_VS, DEPTH_FS);
      this.progBoard = renderer.program(BOARD_VS, BOARD_FS);
      this.progPiece = renderer.program(PIECE_VS, PIECE_FS);
      this.progDust = renderer.program(DUST_VS, DUST_FS);
      this.progIvy = renderer.program(IVY_VS, IVY_FS);
      this.progRuinM = renderer.program(RUINM_VS, RUINM_FS);
      this.progRuinMDepth = renderer.program(RUINM_VS, DEPTH_FS);
      this.ruinVAO = gl.createVertexArray();
      gl.bindVertexArray(this.ruinVAO);
      this.ruinBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.ruinBuf);
      [[0, 3, 0], [1, 3, 12], [2, 3, 24], [3, 2, 36]].forEach(([l, n, o]) => { gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, n, gl.FLOAT, false, 44, o); });
      gl.bindVertexArray(null);
      this.ruinSeen = -1; this.ruinCount = 0; this.ruinTex = null; this.ruinN = 0;
      this.ivyVAO = gl.createVertexArray();
      gl.bindVertexArray(this.ivyVAO);
      this.ivyBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.ivyBuf);
      for (let i = 0; i < 3; i++) { gl.enableVertexAttribArray(i); gl.vertexAttribPointer(i, 4, gl.FLOAT, false, 48, i * 16); gl.vertexAttribDivisor(i, 1); }
      gl.bindVertexArray(null);
      this.ivyCount = 0; this.ivySeen = -1;
      this.dustVAO = gl.createVertexArray();
      gl.bindVertexArray(this.dustVAO);
      this.dustBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.dustBuf);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 20, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 20, 16);
      gl.bindVertexArray(null);
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
      // the shadow map: depth seen from the light
      this.smap = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.smap);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, SMAP, SMAP);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
      this.smapFB = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.smapFB);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.smap, 0);
      gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      this.growth = null;       // set by main.js
      this.meshes = new Map();  // piece id → mesh
      this.seenVersion = -1;
      this.nbox = 0;
      this.light = V.norm([-0.5, 0.9, -0.35]);
      this.lightVP = mat4mul(ortho(-1.05, 1.05, -1.05, 1.05, 0.5, 6), lookAt(V.mul(this.light, 3), [0, 0, 0], [0, 1, 0]));

      this.cam = { yaw: 0.0, pitch: 0.78, dist: 1.8, yawT: 0.35, pitchT: 0.78, distT: 1.5, tgt: [0, 0.05, 0], tgtT: [0, 0.05, 0] };
      this.top = false;
      this.drift = true;
      this.shot = 'orbit';      // current preset view
      this.auto = false;        // cuts: hard cuts between the presets on their own
      this.shotLeft = 0;
      this.creep = 0.03;
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

    /** the model ruin: build its mesh once per session, upload its parts' state every frame */
    syncRuin() {
      const R = this.growth && this.growth.ruinM, gl = this.gl;
      if (!R) return false;
      const n = R.parts.length;
      if (R.version !== this.ruinSeen) {
        this.ruinSeen = R.version;
        let tris = 0;
        for (const p of R.parts) tris += p.idx.length / 3;
        const out = new Float32Array(tris * 3 * 11);
        let o = 0;
        R.parts.forEach((p, i) => {
          const V3 = p.verts, I = p.idx;
          let cx = 0, cy = 0, cz = 0;
          for (let k = 0; k < V3.length; k += 3) { cx += V3[k]; cy += V3[k + 1]; cz += V3[k + 2]; }
          const nv = V3.length / 3; cx /= nv; cy /= nv; cz /= nv;
          for (let t = 0; t < I.length; t += 3) {
            const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
            const A = [V3[a], V3[a + 1], V3[a + 2]], B = [V3[b], V3[b + 1], V3[b + 2]], C = [V3[c], V3[c + 1], V3[c + 2]];
            let nn = V.norm(V.cross(V.sub(B, A), V.sub(C, A)));
            const m = [(A[0] + B[0] + C[0]) / 3 - cx, (A[1] + B[1] + C[1]) / 3 - cy, (A[2] + B[2] + C[2]) / 3 - cz];
            if (V.dot(nn, m) < 0) nn = V.mul(nn, -1);
            for (const Q of [A, B, C]) {
              out.set([Q[0] - p.pivot[0], Q[1] - p.pivot[1], Q[2] - p.pivot[2], nn[0], nn[1], nn[2], p.col[0], p.col[1], p.col[2], i, p.plant], o);
              o += 11;
            }
          }
        });
        gl.bindBuffer(gl.ARRAY_BUFFER, this.ruinBuf);
        gl.bufferData(gl.ARRAY_BUFFER, out, gl.STATIC_DRAW);
        this.ruinCount = tris * 3;
        if (!this.ruinTex || this.ruinN !== n) {
          if (this.ruinTex) gl.deleteTexture(this.ruinTex);
          this.ruinTex = this.r.floatTex(n, 3, gl.RGBA32F, gl.RGBA);
          this.ruinN = n;
        }
      }
      gl.bindTexture(gl.TEXTURE_2D, this.ruinTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, n, 3, gl.RGBA, gl.FLOAT, R.state);
      return true;
    }

    /** the marks the daemon leaves on the ground (life.js draws them on a canvas) */
    syncMarks(time) {
      const gl = this.gl;
      if (!this.marksTex) {
        this.marksTex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.marksTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        this.marksSeen = -1; this.marksAt = -1;
      }
      const L = this.life;
      if (!L || L.version === this.marksSeen || Math.abs(time - this.marksAt) < 0.06) return;
      this.marksSeen = L.version; this.marksAt = time;
      gl.bindTexture(gl.TEXTURE_2D, this.marksTex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, L.canvas);
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
      if (this.shot === 'above') this.shot = 'orbit';
      c.yawT += dyaw;
      c.pitchT = Math.max(0.12, Math.min(1.5, c.pitchT + dpitch));
    }
    zoom(f) { const c = this.cam; c.distT = Math.max(0.45, Math.min(3.6, c.distT * f)); }
    toggleTop() {
      const c = this.cam;
      if (!this.top) { this._before = { shot: this.shot, yaw: c.yawT, pitch: c.pitchT, dist: c.distT, tgt: c.tgtT.slice() }; this.setShot('above'); }
      else if (this._before) { const b = this._before; this.top = false; this.shot = b.shot; c.yawT = b.yaw; c.pitchT = b.pitch; c.distT = b.dist; c.tgtT = b.tgt; }
      else this.setShot('orbit');
    }

    /** a piece worth looking at closely: one still growing, else a tall one */
    focusPiece() {
      const list = (this.growth ? this.growth.pieces : []).filter((p) => p.g > 0.25);
      if (!list.length) return null;
      const growing = list.filter((p) => p.g < 0.97);
      const pool = growing.length ? growing : list;
      let sum = 0;
      const w = pool.map((p) => (sum += 0.2 + p.size[1] * p.g));
      const r = Math.random() * sum;
      return pool[w.findIndex((x) => x >= r)] || pool[0];
    }

    /**
     * preset views: 'orbit' (the default three-quarter view), 'above' (straight
     * down), 'low' (at the height of the pieces), 'side' (from the short end,
     * along the board), 'close' (close up on one piece).
     * cut = jump there at once instead of gliding.
     */
    setShot(name, cut) {
      const c = this.cam, TAU = Math.PI * 2;
      const turn = Math.round(c.yawT / TAU) * TAU;
      let tgt = [0, 0.05, 0];
      if (name === 'close') {
        const p = this.focusPiece();
        if (!p) name = 'low';
        else {
          tgt = [p.pos[0], p.pos[1] + p.size[1] * p.g * 0.55, p.pos[2]];
          c.yawT += (Math.random() - 0.5) * 1.6;
          c.pitchT = 0.22 + Math.random() * 0.3;
          c.distT = 0.5 + Math.random() * 0.15;
        }
      }
      this.shot = name;
      this.top = name === 'above';
      if (name === 'orbit') { c.pitchT = 0.78; c.distT = 1.5; }
      else if (name === 'above') { c.yawT = turn; c.pitchT = 1.5; c.distT = 1.75; tgt = [0, 0, 0]; }
      else if (name === 'low') { c.pitchT = 0.13; c.distT = 1.2; tgt = [0, 0.1, 0]; }
      else if (name === 'side') { c.yawT = turn + (Math.random() < 0.5 ? 1 : -1) * Math.PI / 2; c.pitchT = 0.3; c.distT = 1.15; tgt = [0, 0.08, 0]; }
      c.tgtT = tgt;
      if (cut) { c.yaw = c.yawT; c.pitch = c.pitchT; c.dist = c.distT; c.tgt = tgt.slice(); }
    }

    setAuto(on) {
      this.auto = on;
      if (on) this.shotLeft = 0;
    }

    updateCamera(dt, aspectView) {
      const c = this.cam, k = 1 - Math.exp(-Math.max(0, dt) * 7);
      if (this.auto) {
        // cuts: every 8-15 s a hard cut to another preset; inside a shot the camera creeps
        this.shotLeft -= dt;
        if (this.shotLeft <= 0) {
          const pool = ['orbit', 'low', 'side', 'close', 'close', 'above'].filter((s) => s !== this.shot || s === 'close');
          this.setShot(pool[Math.floor(Math.random() * pool.length)], true);
          this.shotLeft = 8 + Math.random() * 7;
          this.creep = (Math.random() < 0.5 ? 1 : -1) * (0.025 + Math.random() * 0.03);
        }
        c.yawT += dt * this.creep;
        c.distT *= Math.exp(-dt * 0.012);
      } else if (!this.top && this.drift) {
        // left alone, it turns very slowly around its body
        c.yawT += dt * 0.012;
      }
      c.yaw += (c.yawT - c.yaw) * k; c.pitch += (c.pitchT - c.pitch) * k; c.dist += (c.distT - c.dist) * k;
      for (let i = 0; i < 3; i++) c.tgt[i] += (c.tgtT[i] - c.tgt[i]) * k;
      const fit = Math.max(1, 1.25 / Math.max(0.4, aspectView));
      const d = c.dist * fit;
      const target = c.tgt;
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
        if (p.g < 0.03 || p.pos[1] + p.size[1] * p.g < 0.001) continue;   // sunk below the ground
        if (p.ruinOnly && (p.pos[1] > 0.002 || p.tint)) continue;          // the ruin roots only by its foot
        if (p.guide) continue;
        const w = 0.35 + 0.65 * p.g;
        this.boxData[n * 4] = p.pos[0]; this.boxData[n * 4 + 1] = p.pos[1]; this.boxData[n * 4 + 2] = p.pos[2]; this.boxData[n * 4 + 3] = p.yaw;
        const r1 = MAXB * 4 + n * 4;
        this.boxData[r1] = p.size[0] * 0.5 * w; this.boxData[r1 + 1] = p.size[1] * p.g; this.boxData[r1 + 2] = p.size[2] * 0.5 * w; this.boxData[r1 + 3] = 0;
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
      gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D, this.smap); gl.uniform1i(u.u_smap, 7);
      gl.uniformMatrix4fv(u.u_lightVP, false, this.lightVP);
    }

    draw(time, dt, harmony) {
      const gl = this.gl, r = this.r, c = r.colors;
      this.syncMeshes();
      const pieces = this.growth ? this.growth.pieces : [];
      this.uploadBoxes();
      // shadows: the pieces' meshes, seen from the light (every frame: they grow)
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.smapFB);
      gl.viewport(0, 0, SMAP, SMAP);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(1.5, 3);
      gl.useProgram(this.progDepth.p);
      const ud = this.progDepth.u;
      gl.uniformMatrix4fv(ud.u_viewProj, false, this.lightVP);
      gl.uniform1f(ud.u_time, time);
      for (const p of pieces) {
        if (p.g < 0.003 || p.guide) continue;
        const m = this.meshes.get(p.id + ':' + p.seed);
        if (!m) continue;
        const e = p.g, w = 0.35 + 0.65 * e;
        this.drawMesh(ud, m, p.pos, [w, Math.max(0.001, e), w], p.yaw, { seed: p.seed % 1000 / 100 });
      }
      if (this.syncRuin()) {
        gl.useProgram(this.progRuinMDepth.p);
        gl.uniformMatrix4fv(this.progRuinMDepth.u.u_viewProj, false, this.lightVP);
        gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.ruinTex); gl.uniform1i(this.progRuinMDepth.u.u_state, 3);
        gl.bindVertexArray(this.ruinVAO);
        gl.drawArrays(gl.TRIANGLES, 0, this.ruinCount);
        gl.bindVertexArray(null);
      }
      gl.disable(gl.POLYGON_OFFSET_FILL);

      const touch = this.touch && this.postTargets(r.canvas.width, r.canvas.height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, touch ? this.post.scene.fb : null);
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
      this.syncMarks(time);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.marksTex); gl.uniform1i(u.u_marks, 2);
      gl.uniform3fv(u.u_inkEdge, c.inkEdge);
      gl.uniform3fv(u.u_ink, c.ink);
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
        this.drawMesh(u, m, p.pos, [w, Math.max(0.001, e), w], p.yaw, { seed: p.seed % 1000 / 100, mode: p.ruinOnly ? 1 : 0, tint: p.tint || 0, burn: p.burn || 0, guide: p.guide, g: p.ruinOnly ? 1 : e, shake: Math.max(shake * shake, p.shake || 0), self: p._box ?? -1 });
      }

      // the ruin from its model
      if (this.growth && this.growth.ruinM && this.ruinTex) {
        P = this.progRuinM; u = P.u;
        gl.useProgram(P.p);
        this.bindScene(P, time);
        gl.uniformMatrix4fv(u.u_viewProj, false, this.viewProj);
        gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.ruinTex); gl.uniform1i(u.u_state, 3);
        gl.uniform3fv(u.u_fog, fog);
        gl.uniform3fv(u.u_eye, this.eye);
        gl.bindVertexArray(this.ruinVAO);
        gl.drawArrays(gl.TRIANGLES, 0, this.ruinCount);
        gl.bindVertexArray(null);
      }

      // the ruin's ivy
      const IV = this.growth && this.growth.ivy;
      if (IV && IV.leaves.length) {
        if (IV.version !== this.ivySeen) {
          this.ivySeen = IV.version;
          const L = IV.leaves, buf = new Float32Array(L.length * 12);
          L.forEach((l, i) => buf.set([l.c[0], l.c[1], l.c[2], l.kind, l.n[0], l.n[1], l.n[2], l.shade, l.size, l.rot, l.fall, 0], i * 12));
          gl.bindBuffer(gl.ARRAY_BUFFER, this.ivyBuf);
          gl.bufferData(gl.ARRAY_BUFFER, buf, gl.STATIC_DRAW);
          this.ivyCount = L.length;
        }
        P = this.progIvy; u = P.u;
        gl.useProgram(P.p);
        this.bindScene(P, time);
        gl.uniformMatrix4fv(u.u_viewProj, false, this.viewProj);
        gl.uniform1f(u.u_t, this.growth.t);
        gl.uniform3fv(u.u_fog, fog);
        gl.uniform3fv(u.u_eye, this.eye);
        gl.bindVertexArray(this.ivyVAO);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.ivyCount);
      }

      // the ruin's dust
      const D = this.growth && this.growth.dust;
      if (D && D.n > 0) {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.dustBuf);
        gl.bufferData(gl.ARRAY_BUFFER, D.data.subarray(0, D.n * 5), gl.DYNAMIC_DRAW);
        P = this.progDust; u = P.u;
        gl.useProgram(P.p);
        gl.uniformMatrix4fv(u.u_viewProj, false, this.viewProj);
        gl.uniform1f(u.u_px, gl.drawingBufferHeight * 0.5 / Math.tan(this.fov * 0.5));
        gl.uniform3fv(u.u_dustA, [0.6, 0.53, 0.42]);
        gl.uniform3fv(u.u_dustB, [0.43, 0.38, 0.31]);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(false);
        gl.bindVertexArray(this.dustVAO);
        gl.drawArrays(gl.POINTS, 0, D.n);
        gl.depthMask(true);
        gl.disable(gl.BLEND);
      }

      // soft falloff and grain over the whole view
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.DST_COLOR, gl.ZERO);
      gl.bindVertexArray(this.emptyVAO);
      if (!touch) {
        gl.useProgram(this.progVig.p);
        gl.uniform1f(this.progVig.u.u_harmony, harmony);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      gl.disable(gl.BLEND);
      if (touch) {
        const T = this.post, [prev, next] = T.ping;
        gl.bindFramebuffer(gl.FRAMEBUFFER, next.fb);
        gl.useProgram(this.progPost.p);
        const u2 = this.progPost.u;
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, T.scene.tex); gl.uniform1i(u2.u_scene, 0);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, prev.tex); gl.uniform1i(u2.u_prev, 1);
        gl.uniform3fv(u2.u_ground, ground);
        gl.uniform2f(u2.u_px, 1 / T.w, 1 / T.h);
        gl.uniform1f(u2.u_cell, Math.max(1, Math.round(T.h / 720)));
        gl.uniform1f(u2.u_time, time);
        // bursts: now and then on its own, and when something happens to a being
        const fdt = Math.max(0, dt || 0);
        this.burst = (this.burst || 0) * Math.exp(-fdt * 3.5);
        if (this.life && this.life.on && Math.random() < fdt * 0.18) this.burst = Math.max(this.burst, 0.5 + Math.random() * 0.5);
        if (this.life && this.life.flash) { this.burst = Math.max(this.burst, this.life.flash); this.life.flash = 0; }
        gl.uniform1f(u2.u_burst, this.burst);
        const G = this.growth && this.growth.game;
        this.tamt = (this.tamt || 0) + (((G && G.active) ? 1 : 0) - (this.tamt || 0)) * Math.min(1, fdt * 1.5);
        gl.uniform3fv(u2.u_tcol, G ? G.colour : [0.86, 0.88, 0.9]);
        gl.uniform1f(u2.u_tamt, this.tamt);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.useProgram(this.progCopy.p);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, next.tex); gl.uniform1i(this.progCopy.u.u_tex, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        T.ping = [next, prev];
      }
      gl.bindVertexArray(null);
    }

    /** render targets for the TOUCH look: the scene, and two frames for the trails */
    postTargets(w, h) {
      const gl = this.gl;
      if (this.post && this.post.w === w && this.post.h === h) return true;
      if (this.post) {
        for (const t of [this.post.scene, ...this.post.ping]) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb); if (t.rb) gl.deleteRenderbuffer(t.rb); }
      }
      const make = (depth) => {
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        const fb = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        let rb = null;
        if (depth) {
          rb = gl.createRenderbuffer();
          gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
          gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
          gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
        }
        gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);     // empty: no light remembered yet
        return { tex, fb, rb };
      };
      this.post = { w, h, scene: make(true), ping: [make(false), make(false)] };
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return true;
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
      gl.uniform1f(u.u_tint, o.tint || 0);
      if (u.u_burn) gl.uniform1f(u.u_burn, o.burn || 0);
      if (u.u_guide) gl.uniform1f(u.u_guide, o.guide ? 1 : 0);
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
