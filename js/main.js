/* ---------------------------------------------------------------------------
 * main.js — wiring.
 *   Daemon (body + mind)  →  Renderer (pigment)  →  Interface (threshold)
 * The daemon instance is exposed as `window.daemon` so the team can inspect
 * it from the console, e.g. daemon.describe() or daemon.on('phase', console.log).
 * ------------------------------------------------------------------------- */
(function (RUIN) {
  'use strict';

  const canvas = document.getElementById('surface');
  let renderer;
  try {
    renderer = new RUIN.Renderer(canvas);
  } catch (e) {
    console.error(e);
    const fb = document.getElementById('fallback');
    fb.hidden = false;
    const detail = document.createElement('pre');
    detail.style.cssText = 'font-size:10px;letter-spacing:0;opacity:.7;max-width:80vw;white-space:pre-wrap;text-align:left';
    detail.textContent = String(e && e.message || e).slice(0, 1200);
    fb.querySelector('p').after(detail);
    return;
  }

  const daemon = new RUIN.Daemon({ aspect: renderer.aspect });
  const clock = { held: false };
  const synth = new RUIN.Synth();
  const sonifier = new RUIN.Sonifier(daemon, synth);
  const ui = new RUIN.Interface({ daemon, canvas, clock, synth });
  const growth = new RUIN.Growth({ daemon, aspect: renderer.aspect });
  renderer.scene.growth = growth;
  const view = new RUIN.View({ daemon, renderer, growth, ui, canvas, clock });

  window.addEventListener('resize', () => renderer.resize());

  let last = performance.now();
  let time = 0;
  function frame(now) {
    const raw = Math.min(0.05, (now - last) / 1000);
    last = now;
    const dt = clock.held || document.hidden ? 0 : raw;
    time += dt;
    daemon.update(dt);
    growth.update(dt);
    ui.update(raw);
    view.update(raw);
    sonifier.update(raw);
    const t0 = performance.now();
    renderer.render(daemon, dt, time);
    renderer.measure(raw * 1000 || performance.now() - t0);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  window.daemon = daemon;
  window.RUIN.app = { daemon, renderer, ui, synth, sonifier, growth, view };
})(window.RUIN);
