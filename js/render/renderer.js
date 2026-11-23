/* ---------------------------------------------------------------------------
 * renderer.js — WebGL2 painter.
 * Receives plain numbers from the organism (via `daemon.organism.collect`),
 * bins them into screen tiles so each pixel only evaluates nearby matter,
 * and paints the field. Resolution adapts to keep motion fluid.
 * ------------------------------------------------------------------------- */
(function (RUIN) {
  'use strict';

  const MAX_BLOBS = 2048;
  const ROWS = 3;
  const INDEX_W = RUIN.shaders.INDEX_W;
  const INDEX_H = 64;
  const MEMORY_DIV = 4;
  const lerp = (a, b, t) => a + (b - a) * t;

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
      if (!gl) throw new Error('WebGL2 is not available');
      this.gl = gl;

      this.blobData = new Float32Array(MAX_BLOBS * 4 * ROWS);
      this.indexData = new Float32Array(INDEX_W * INDEX_H);
      this.tileData = null;
      this.count = 0;
      this.frame = 0;

      this.quality = Math.min(window.devicePixelRatio || 1, 1.5);
      this.maxQuality = this.quality;
      this.frameMs = 16;
      this.slowFrames = 0;
      this.fastFrames = 0;

      this.colors = null; // eased palette

      this.progMain = this.program(RUIN.shaders.VERT, RUIN.shaders.MAIN);
      this.progMem = this.program(RUIN.shaders.VERT, RUIN.shaders.MEMORY);
      this.vao = gl.createVertexArray();

      this.texBlobs = this.floatTex(MAX_BLOBS, ROWS, gl.RGBA32F, gl.RGBA);
      this.texIndex = this.floatTex(INDEX_W, INDEX_H, gl.R32F, gl.RED);
      this.texTiles = null;
      this.mem = null;
      this.resize();
    }

    /* ---- setup helpers ------------------------------------------------- */
    program(vs, fs) {
      const gl = this.gl;
      const compile = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        return s;
      };
      const p = gl.createProgram();
      gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
      gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      const uniforms = {};
      const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n; i++) {
        const info = gl.getActiveUniform(p, i);
        uniforms[info.name] = gl.getUniformLocation(p, info.name);
      }
      return { p, u: uniforms };
    }

    floatTex(w, h, internal, format) {
      const gl = this.gl;
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, gl.FLOAT, null);
      return t;
    }

    memoryTarget(w, h) {
      const gl = this.gl;
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return { tex, fb, w, h };
    }

    /* ---- sizing --------------------------------------------------------- */
    resize() {
      const gl = this.gl;
      const cw = this.canvas.clientWidth || window.innerWidth;
      const ch = this.canvas.clientHeight || window.innerHeight;
      this.cssW = cw; this.cssH = ch;
      this.aspect = cw / ch;
      this.canvas.width = Math.max(2, Math.floor(cw * this.quality));
      this.canvas.height = Math.max(2, Math.floor(ch * this.quality));

      // tile grid (~36 columns, square-ish tiles)
      this.gx = 36;
      this.gy = Math.max(8, Math.min(48, Math.round(36 / this.aspect)));
      this.tileData = new Float32Array(this.gx * this.gy * 4);
      if (this.texTiles) gl.deleteTexture(this.texTiles);
      this.texTiles = this.floatTex(this.gx, this.gy, gl.RGBA32F, gl.RGBA);

      // memory survives resizes of the same order; rebuild only when needed
      const mw = Math.max(8, Math.floor(cw / MEMORY_DIV)), mh = Math.max(8, Math.floor(ch / MEMORY_DIV));
      if (!this.mem || this.mem[0].w !== mw || this.mem[0].h !== mh) {
        this.mem = [this.memoryTarget(mw, mh), this.memoryTarget(mw, mh)];
      }
    }

    setQuality(q) {
      q = Math.max(0.45, Math.min(this.maxQuality, q));
      if (Math.abs(q - this.quality) < 0.01) return;
      this.quality = q;
      this.canvas.width = Math.max(2, Math.floor(this.cssW * q));
      this.canvas.height = Math.max(2, Math.floor(this.cssH * q));
    }

    /** Adaptive resolution: protect fluid motion over pixel density. */
    measure(ms) {
      this.frameMs = lerp(this.frameMs, ms, 0.05);
      if (this.frameMs > 24) { if (++this.slowFrames > 40) { this.setQuality(this.quality * 0.85); this.slowFrames = 0; } }
      else this.slowFrames = 0;
      if (this.frameMs < 13 && this.quality < this.maxQuality) {
        if (++this.fastFrames > 240) { this.setQuality(this.quality * 1.1); this.fastFrames = 0; }
      } else this.fastFrames = 0;
    }

    /* ---- per-frame data --------------------------------------------------- */
    upload(organism) {
      const gl = this.gl;
      const n = organism.collect(this.blobData, MAX_BLOBS);
      this.count = n;

      // bin primitives into tiles by their reach (+ margin for the warp)
      const gx = this.gx, gy = this.gy, W = this.aspect;
      const tw = W / gx, th = 1 / gy;
      const lists = this._lists || (this._lists = []);
      for (let i = 0; i < gx * gy; i++) { if (!lists[i]) lists[i] = []; else lists[i].length = 0; }
      const margin = 0.03;
      for (let i = 0; i < n; i++) {
        const x = this.blobData[i * 4], y = this.blobData[i * 4 + 1];
        const r = this.blobData[i * 4 + 2], type = this.blobData[i * 4 + 3];
        let lx = x, hx = x, ly = y, hy = y, reach;
        if (type > 3.5) { // segment: bounding box of both ends
          const r2 = MAX_BLOBS * 8 + i * 4;
          const ex = this.blobData[r2], ey = this.blobData[r2 + 1];
          lx = Math.min(x, ex); hx = Math.max(x, ex); ly = Math.min(y, ey); hy = Math.max(y, ey);
          reach = 2 * Math.max(r, this.blobData[r2 + 2]) + margin;
        } else {
          reach = (type < 0.5 ? 2 * r : type < 1.5 || type > 2.5 ? 3 * r : 1.4 * r) + margin;
        }
        const x0 = Math.max(0, Math.floor((lx - reach) / tw)), x1 = Math.min(gx - 1, Math.floor((hx + reach) / tw));
        const y0 = Math.max(0, Math.floor((ly - reach) / th)), y1 = Math.min(gy - 1, Math.floor((hy + reach) / th));
        for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) lists[ty * gx + tx].push(i);
      }
      let k = 0;
      const cap = INDEX_W * INDEX_H;
      for (let i = 0; i < gx * gy; i++) {
        const L = lists[i];
        const start = k;
        for (let j = 0; j < L.length && k < cap; j++) this.indexData[k++] = L[j];
        this.tileData[i * 4] = start;
        this.tileData[i * 4 + 1] = k - start;
      }
      const rows = Math.max(1, Math.ceil(k / INDEX_W));

      gl.bindTexture(gl.TEXTURE_2D, this.texBlobs);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, MAX_BLOBS, ROWS, gl.RGBA, gl.FLOAT, this.blobData);
      gl.bindTexture(gl.TEXTURE_2D, this.texIndex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, INDEX_W, rows, gl.RED, gl.FLOAT, this.indexData.subarray(0, rows * INDEX_W));
      gl.bindTexture(gl.TEXTURE_2D, this.texTiles);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gx, gy, gl.RGBA, gl.FLOAT, this.tileData);
    }

    easeColors(pal, dt) {
      const target = pal;
      if (!this.colors) { this.colors = {}; for (const k in target) if (Array.isArray(target[k])) this.colors[k] = target[k].slice(); return; }
      const t = 1 - Math.exp(-dt * 0.35);
      for (const k in this.colors) for (let i = 0; i < 3; i++) this.colors[k][i] = lerp(this.colors[k][i], target[k][i], t);
    }

    bindField(prog, time) {
      const gl = this.gl, u = prog.u;
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texBlobs); gl.uniform1i(u.u_blobs, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.texTiles); gl.uniform1i(u.u_tiles, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.texIndex); gl.uniform1i(u.u_index, 2);
      gl.uniform2f(u.u_grid, this.gx, this.gy);
      gl.uniform1f(u.u_aspect, this.aspect);
      gl.uniform1f(u.u_time, time);
    }

    /* ---- the will's feedback map: one texel per construction cell ---------- */
    bindWill(daemon, u, dt) {
      const gl = this.gl, W = RUIN.will;
      if (!this.texWill) {
        this.willData = new Uint8Array(W.N * 4);
        this.texWill = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.texWill);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W.COLS, W.ROWS, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.willData);
        this.hoverA = 0; this.content = 0;
      }
      const will = daemon.state === 'session' ? daemon.will : null;
      if (will) will.texture(this.willData); else this.willData.fill(0);
      gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, this.texWill);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W.COLS, W.ROWS, gl.RGBA, gl.UNSIGNED_BYTE, this.willData);
      gl.uniform1i(u.u_will, 4);
      const R = W.rect(this.aspect);
      gl.uniform4f(u.u_gridRect, R.x0, R.y0, R.x1, R.y1);
      const step = Math.min(1, (dt || 0.016) * 1.5);
      this.content = lerp(this.content, will && will.engaged ? will.alignment : 0, step);
      gl.uniform1f(u.u_harmony, this.content);
      // the cell the participant points at on the grid panel
      this.hoverA = lerp(this.hoverA, this.hover ? 1 : 0, Math.min(1, 0.1));
      if (this.hover) this.hoverCell = this.hover;
      const hv = this.hoverCell || { i: 0, j: 0 };
      const cw = (R.x1 - R.x0) / W.COLS, ch = (R.y1 - R.y0) / W.ROWS;
      gl.uniform4f(u.u_hover, R.x0 + hv.i * cw, R.y0 + hv.j * ch, R.x0 + (hv.i + 1) * cw, R.y0 + (hv.j + 1) * ch);
      gl.uniform1f(u.u_hoverA, this.hoverA);
    }

    /* ---- draw ---------------------------------------------------------------- */
    render(daemon, dt, time) {
      const gl = this.gl;
      const org = daemon.organism;
      this.upload(org);
      this.easeColors(daemon.palette, dt);
      gl.bindVertexArray(this.vao);

      // memory pass (~20 Hz)
      if (this.frame % 3 === 0 && dt > 0) {
        const [src, dst] = this.mem;
        gl.useProgram(this.progMem.p);
        this.bindField(this.progMem, time);
        gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, src.tex);
        gl.uniform1i(this.progMem.u.u_prev, 3);
        gl.uniform1f(this.progMem.u.u_frame, this.frame % 997);
        gl.uniform1f(this.progMem.u.u_rate, 0.012);
        gl.uniform1f(this.progMem.u.u_decay, 0.0006);
        gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb);
        gl.viewport(0, 0, dst.w, dst.h);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        this.mem = [dst, src];
      }

      // main pass
      const P = this.progMain, u = P.u, c = this.colors;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.useProgram(P.p);
      this.bindField(P, time);
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.mem[0].tex);
      gl.uniform1i(u.u_memory, 3);
      gl.uniform1f(u.u_axis, org.axis);
      gl.uniform3fv(u.u_paper, c.paper);
      gl.uniform3fv(u.u_paperDeep, c.paperDeep);
      gl.uniform3fv(u.u_cream, c.cream);
      gl.uniform3fv(u.u_memCol, c.memory);
      gl.uniform3fv(u.u_washA, c.washA);
      gl.uniform3fv(u.u_washB, c.washB);
      gl.uniform3fv(u.u_ink, c.ink);
      gl.uniform3fv(u.u_inkEdge, c.inkEdge);
      gl.uniform3fv(u.u_rim, c.rim);
      gl.uniform3fv(u.u_tissue, c.tissue);
      gl.uniform3fv(u.u_signal, c.signal);
      this.bindWill(daemon, u, dt);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.frame++;
    }
  }

  RUIN.Renderer = Renderer;
})((window.RUIN = window.RUIN || {}));
