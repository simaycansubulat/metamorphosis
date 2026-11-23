/* ---------------------------------------------------------------------------
 * shaders.js — how matter becomes pigment.
 *
 * Each pixel samples a FIELD built from the organism's primitives:
 *   ink      compact metaball kernel → stains that merge when close and
 *            separate into dots when apart (connection ↔ disconnection)
 *   segment  the same kernel along a tapered line → veins and dendrites
 *            (light segments become cream filaments instead)
 *   wash     gaussian tonal fields between two pigments, pooled edges
 *   ring     transparent circles with a darker rim; overlaps accumulate
 *   soot     soft dark sprayed stains with fibrous edges
 *
 * Then it is painted over linen: domain-warped edges, bled halos, and a
 * TISSUE of irregular cells (two scales of warped Voronoi membranes) that
 * grows wherever there is matter — dark walls on light ground, cream walls
 * inside dark masses — so separate stains read as one living network.
 *
 * A second, low-resolution pass keeps a slowly fading MEMORY of where
 * matter has been; the tissue lingers there as a ghost.
 * ------------------------------------------------------------------------- */
(function (RUIN) {
  'use strict';

  const INDEX_W = 2048;

  const NOISE = `
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }
  float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
    vec2 i = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
    m = m * m; m = m * m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
    vec3 g;
    g.x = a0.x * x0.x + h.x * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }
  float fbm(vec2 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { s += a * snoise(p); p = p * 2.03 + vec2(17.1, 9.7); a *= 0.5; }
    return s;
  }
  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  vec2 hash22(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy);
  }

  `;

  const VERT = `#version 300 es
  out vec2 v_uv;
  void main() {
    vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
    v_uv = p * 0.5 + 0.5;
    gl_Position = vec4(p, 0.0, 1.0);
  }`;

  const COMMON = `#version 300 es
  precision highp float;
  precision highp int;
  precision highp sampler2D;

  uniform sampler2D u_blobs;  // MAX x 3 : (x,y,r,type) (alpha,tint,act,seed) (x1,y1,r1,light)
  uniform sampler2D u_tiles;  // GX x GY : (start, count)
  uniform sampler2D u_index;  // INDEX_W x H : blob index
  uniform vec2  u_grid;
  uniform float u_aspect;
  uniform float u_time;

  ${NOISE}
  vec2 warp(vec2 p, float t) {
    vec2 w = vec2(fbm(p * 2.2 + vec2(0.0, t * 0.012)), fbm(p * 2.2 + vec2(5.2, 1.3 - t * 0.01)));
    return p + 0.02 * w;
  }

  struct Field { float ink; float act; float wash; float washTint; float rim; float fill; float soot; float light; };

  Field field(vec2 q) {
    Field f = Field(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
    vec2 cell = clamp(floor(vec2(q.x / u_aspect, q.y) * u_grid), vec2(0.0), u_grid - 1.0);
    vec4 tile = texelFetch(u_tiles, ivec2(cell), 0);
    int start = int(tile.r + 0.5);
    int count = int(tile.g + 0.5);
    for (int j = 0; j < 768; j++) {
      if (j >= count) break;
      int k = start + j;
      int bi = int(texelFetch(u_index, ivec2(k % ${INDEX_W}, k / ${INDEX_W}), 0).r + 0.5);
      vec4 a = texelFetch(u_blobs, ivec2(bi, 0), 0);
      vec4 b = texelFetch(u_blobs, ivec2(bi, 1), 0);
      float type = a.w;
      if (type > 3.5) {                      // SEGMENT — tapered vein
        vec4 c = texelFetch(u_blobs, ivec2(bi, 2), 0);
        vec2 pa = q - a.xy, ba = c.xy - a.xy;
        float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-9), 0.0, 1.0);
        vec2 dd = pa - ba * h;
        float rr = mix(a.z, c.z, h);
        float d2 = dot(dd, dd), R2 = 4.0 * rr * rr;
        if (c.w > 0.5) {
          // cream fibre: wide soft kernel -> blurred, translucent
          float L2 = 9.0 * rr * rr;
          if (d2 < L2) { float k3 = 1.0 - d2 / L2; f.light += k3 * k3 * b.x; }
        } else {
          if (d2 < R2) {
            float k3 = 1.0 - d2 / R2;
            k3 = k3 * k3 * k3 * b.x;
            f.ink += k3; f.act += k3 * b.z;
          }
          // a soft shadow around every vein: it bleeds into the ground
          float sr = rr * 3.5 + 0.004;
          f.soot += exp(-d2 / (sr * sr)) * b.x * 0.16;
        }
        continue;
      }
      vec2 d = q - a.xy;
      float d2 = dot(d, d);
      float r = a.z;
      if (type < 0.5) {                      // INK — compact metaball
        float R2 = 4.0 * r * r;
        if (d2 < R2) {
          float k3 = 1.0 - d2 / R2;
          k3 = k3 * k3 * k3 * b.x;
          f.ink += k3;
          f.act += k3 * b.z;
        }
      } else if (type < 1.5) {               // WASH — tonal field
        float s2 = r * r;
        if (d2 < 9.0 * s2) {
          float g = exp(-d2 / s2) * b.x;
          f.wash += g;
          f.washTint += g * b.y;
        }
      } else if (type > 2.5) {               // SOOT — soft dark spray
        float s2 = r * r;
        if (d2 < 9.0 * s2) f.soot += exp(-d2 / s2) * b.x;
      } else {                               // RING — transparent circle
        float dist = sqrt(d2);
        if (dist < r * 1.35) {
          float w = r * 0.04 + 0.0012;
          float e = (dist - r) / w;
          f.rim += exp(-e * e) * b.x;
          f.fill += (1.0 - smoothstep(r * 0.82, r, dist)) * b.x;
        }
      }
    }
    return f;
  }
  `;

  const MAIN = COMMON + `
  uniform sampler2D u_memory;
  uniform float u_axis;
  uniform vec3 u_paper, u_paperDeep, u_cream, u_memCol, u_tissue, u_signal;
  uniform sampler2D u_will;   // COLS x ROWS : lack, excess, harmony, flash
  uniform vec4  u_gridRect;   // world rect covered by the construction grid
  uniform float u_harmony;    // global contentment with the construction
  uniform vec4  u_hover;      // world rect of the grid cell being pointed at
  uniform float u_hoverA;
  uniform vec3 u_washA, u_washB, u_ink, u_inkEdge, u_rim;
  in vec2 v_uv;
  out vec4 outColor;

  // F1, F2 distances and a per-cell id hash; cell sites drift slowly
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

  void main() {
    vec2 p = vec2(v_uv.x * u_aspect, 1.0 - v_uv.y);
    float t = u_time;
    vec2 q = warp(p, t);
    q += 0.004 * vec2(snoise(p * 24.0 + 3.1), snoise(p * 24.0 - 7.7));
    Field f = field(q);

    // --- the will's feedback, sampled organically (warped, blurred) -------------
    vec2 gq = (q - u_gridRect.xy) / (u_gridRect.zw - u_gridRect.xy);
    gq += 0.035 * vec2(fbm(q * 3.0 + 40.0), fbm(q * 3.0 - 40.0));
    vec2 o1 = vec2(0.09, 0.0), o2 = vec2(0.0, 0.14);
    vec4 will = texture(u_will, gq) * 0.36
              + (texture(u_will, gq + o1) + texture(u_will, gq - o1) + texture(u_will, gq + o2) + texture(u_will, gq - o2)) * 0.16;
    vec2 ge = min(gq, 1.0 - gq);
    will *= smoothstep(-0.08, 0.06, min(ge.x, ge.y));
    float lackW = will.r, excessW = will.g, harmonyW = will.b, flashW = will.a;

    // --- linen ground --------------------------------------------------------
    float mott = fbm(p * 1.5 + 11.0) * 0.5 + 0.5;
    vec3 col = mix(u_paper, u_paperDeep, smoothstep(0.3, 0.95, mott) * 0.7);
    float weave = snoise(vec2(p.x * 620.0, p.y * 9.0)) * 0.5 + snoise(vec2(p.x * 9.0, p.y * 580.0)) * 0.5;
    col *= 1.0 + weave * 0.03;
    col *= 1.0 - smoothstep(0.8, 0.95, snoise(p * 95.0 + 40.0)) * 0.04;

    // --- memory of earlier states ---------------------------------------------
    float m = texture(u_memory, v_uv).r;
    float memA = smoothstep(0.02, 0.6, m) * 0.28;
    float tide = exp(-pow((m - 0.07) / 0.025, 2.0)) * 0.08;
    col *= mix(vec3(1.0), u_memCol, clamp(memA + tide, 0.0, 0.5));

    // --- tonal fields (washes) -------------------------------------------------
    float wt = clamp(f.washTint / max(f.wash, 1e-4), 0.0, 1.0);
    vec3 washCol = mix(u_washA, u_washB, wt);
    float wn = fbm(q * 3.5 + 3.0);
    float wf = f.wash * (0.85 + 0.3 * wn);
    float washA = smoothstep(0.04, 0.6, wf) * 0.85;
    float edgeBreak = smoothstep(-0.2, 0.5, snoise(q * 11.0));
    washA += exp(-pow((wf - 0.1) / 0.035, 2.0)) * 0.12 * edgeBreak;
    washA *= 0.88 + 0.16 * snoise(p * 48.0);
    col *= mix(vec3(1.0), washCol, clamp(washA, 0.0, 0.92));
    col *= mix(vec3(1.0), u_washB, smoothstep(0.6, 1.6, wf) * 0.4);

    // --- signal: where it wants matter, an oxide-red stain gathers ----------------
    float body0 = f.wash * 0.8 + f.soot * 0.9 + 0.25;
    float redN = 0.7 + 0.6 * fbm(q * 5.0 + vec2(t * 0.03, 0.0));
    float redA = smoothstep(0.1, 0.75, lackW * redN + flashW * 0.5) * 0.62 * clamp(body0, 0.35, 1.0);
    float ripple = flashW * (0.5 + 0.5 * sin((1.0 - flashW) * 18.0 - length(fract(gq * vec2(8.0, 5.0)) - 0.5) * 30.0));
    redA += ripple * 0.12 * smoothstep(0.1, 0.5, lackW + flashW);
    col *= mix(vec3(1.0), u_signal * 1.25, clamp(redA, 0.0, 0.75));

    // --- transparent rings -------------------------------------------------------
    col *= mix(vec3(1.0), u_washA, clamp(f.fill, 0.0, 3.0) * 0.1);
    col *= mix(vec3(1.0), u_rim, clamp(f.rim, 0.0, 1.0) * 0.8);

    // --- soot ----------------------------------------------------------------------
    vec2 ax = vec2(cos(u_axis), sin(u_axis));
    vec2 rp = vec2(dot(p, ax), dot(p, vec2(-ax.y, ax.x)));
    float hair = smoothstep(0.3, 0.9, snoise(rp * vec2(12.0, 230.0)));
    float streak = snoise(rp * vec2(5.0, 20.0));
    float sf = f.soot * (1.0 + 0.18 * streak + 0.18 * snoise(q * 16.0)) + hair * 0.1 * smoothstep(0.05, 0.4, f.soot);
    float sootA = smoothstep(0.04, 1.0, sf) * 0.85;
    col *= mix(vec3(1.0), u_inkEdge * 1.3, sootA);
    col = mix(col, u_ink, smoothstep(0.8, 1.8, sf) * 0.55);

    // --- ink: stains, veins, dendrites ------------------------------------------
    const float th = 0.42;
    float rough = snoise(q * 48.0) * 0.05 + snoise(q * 120.0) * 0.015;
    float inkF = f.ink + rough * smoothstep(0.0, th, f.ink);
    float aa = max(fwidth(inkF), 1e-4);
    float inkA = smoothstep(th - aa, th + aa, inkF);

    float halo = smoothstep(0.02, th, f.ink) * (1.0 - inkA);
    float haloA = halo * halo * 0.38 + halo * hair * 0.4;
    col *= mix(vec3(1.0), mix(u_inkEdge * 1.4, u_signal * 1.2, clamp(lackW + excessW, 0.0, 1.0) * 0.7), haloA * (1.0 - 0.35 * u_harmony));

    float depth = smoothstep(th, th * 5.0, f.ink);
    float act = clamp(f.act / max(f.ink, 1e-4), 0.0, 1.0);
    vec3 inkCol = mix(u_inkEdge, u_ink, 0.45 + 0.55 * depth);
    inkCol = mix(inkCol, u_washA * 0.9, act * 0.45 * (1.0 - depth * 0.5)); // thinking: veins glow faintly
    inkCol *= 0.93 + 0.12 * fbm(q * 18.0);
    inkCol = mix(inkCol, u_signal * 0.6, clamp(excessW, 0.0, 1.0) * 0.55);
    col = mix(col, inkCol, inkA * 0.97);

    // --- signal: where it rejects matter, red fibrous scratches agitate ---------
    float exA = smoothstep(0.08, 0.6, excessW);
    float scratch = smoothstep(0.62, 0.95, snoise(rp * vec2(10.0, 60.0) + vec2(t * 0.35, 0.0) + 2.0 * fbm(q * 4.0 + t * 0.05)));
    scratch *= exA * (0.55 + 0.45 * sin(t * 5.0 + fbm(q * 6.0) * 9.0));
    col = mix(col, u_signal * 0.85, scratch * 0.32);

    // --- tissue: the cellular network --------------------------------------------
    float body = f.wash * 0.8 + f.soot * 0.9 + smoothstep(0.0, th, f.ink) * 0.5;
    float tissue = smoothstep(0.08, 0.6, body + m * 0.55 + exA * 0.45);   // rejected places: tissue irritates
    // strongly warped, with cell size drifting across the surface → bubbly, uneven cells
    vec2 tq = q + 0.06 * vec2(fbm(q * 2.6 + 7.0), fbm(q * 2.6 - 4.0));
    float sc = 0.7 + 0.6 * (fbm(q * 1.1 + 21.0) * 0.5 + 0.5);
    vec4 v1 = voronoi(tq * 17.0 * sc, t);
    vec4 v2 = voronoi(tq * 44.0 * sc + 13.0, t * 1.3);
    float dens = smoothstep(0.25, 1.3, body);
    float e1 = v1.y - v1.x, e2 = v2.y - v2.x;
    float junction = 1.0 - smoothstep(0.0, 0.32, v1.w - v1.x);       // where three cells meet
    float w1 = 0.02 + 0.035 * (0.5 + 0.5 * snoise(q * 5.0)) + 0.09 * junction * junction;
    float mem1 = 1.0 - smoothstep(w1 * 0.3, w1, e1);
    float mem2 = (1.0 - smoothstep(0.02, 0.06, e2)) * dens;
    float nucleus = step(0.72, v1.z) * exp(-pow((v1.x - 0.16) / 0.026, 2.0));
    float membrane = clamp(max(mem1, mem2 * 0.75) + nucleus * 0.6, 0.0, 1.0);
    float pillow = smoothstep(0.0, 0.5, e1);
    col *= 1.0 - (1.0 - pillow) * 0.16 * tissue;                     // cells bulge like bubbles
    col *= 1.0 + pillow * 0.05 * tissue;
    float lum = dot(col, vec3(0.3, 0.59, 0.11));
    vec3 lineCol = mix(u_cream, u_tissue, smoothstep(0.22, 0.42, lum));
    lineCol = mix(lineCol, u_signal * 0.85, exA * 0.75);
    float soften = 1.0 - 0.55 * clamp(harmonyW, 0.0, 1.0) - 0.2 * u_harmony;
    col = mix(col, lineCol, membrane * tissue * mix(0.5, 0.35, inkA) * soften);
    col = mix(col, u_cream, clamp(harmonyW, 0.0, 1.0) * 0.07 * tissue);  // accepted areas settle and lighten

    // --- light filaments -------------------------------------------------------------
    float la = smoothstep(0.08, 0.7, f.light);
    float dark = 1.0 - smoothstep(0.25, 0.7, dot(col, vec3(0.3, 0.59, 0.11)));
    col = mix(col, u_cream, la * (0.15 + 0.4 * dark));

    // --- the grid cell the participant is pointing at (a faint, warped window) ---
    if (u_hoverA > 0.01) {
      vec2 hq = q + 0.012 * vec2(snoise(q * 9.0), snoise(q * 9.0 + 5.0));
      vec2 hd = min(hq - u_hover.xy, u_hover.zw - hq);
      float inH = smoothstep(-0.004, 0.01, min(hd.x, hd.y));
      float edgeH = inH * (1.0 - smoothstep(0.0, 0.008, min(hd.x, hd.y)));
      col = mix(col, u_cream, inH * 0.1 * u_hoverA);
      col = mix(col, u_tissue, edgeH * 0.35 * u_hoverA);
    }

    // --- grain & falloff ---------------------------------------------------------------
    col *= 0.97 + 0.06 * hash12(floor(gl_FragCoord.xy));
    vec2 vc = v_uv - 0.5;
    col *= 1.0 - (0.28 - 0.08 * u_harmony) * pow(dot(vc, vc) * 1.8, 1.4);
    // alpha carries the INK alone (veins, dendrites, stains): the 3D ground
    // shows only these, near the pieces, and raises them slightly
    outColor = vec4(col, clamp(inkA + la * 0.4, 0.0, 1.0));
  }`;

  const MEMORY = COMMON + `
  uniform sampler2D u_prev;
  uniform float u_frame;
  uniform float u_rate;
  uniform float u_decay;
  in vec2 v_uv;
  out vec4 outColor;

  void main() {
    vec2 p = vec2(v_uv.x * u_aspect, 1.0 - v_uv.y);
    Field f = field(warp(p, u_time));
    float cur = clamp(smoothstep(0.2, 0.7, f.ink) * 0.75 + f.wash * 0.35 + f.soot * 0.3 + f.rim * 0.25, 0.0, 0.85);
    float prev = texture(u_prev, v_uv).r;
    float nv = cur > prev ? prev + (cur - prev) * u_rate : prev - u_decay;
    nv += (hash12(gl_FragCoord.xy + u_frame * vec2(13.17, 7.73)) - 0.5) / 255.0; // stochastic rounding
    outColor = vec4(clamp(nv, 0.0, 1.0), 0.0, 0.0, 1.0);
  }`;

  RUIN.shaders = { VERT, MAIN, MEMORY, INDEX_W, NOISE };
})((window.RUIN = window.RUIN || {}));
