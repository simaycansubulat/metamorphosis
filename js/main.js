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
  // sound is switched off for now: no synth, no sonifier (js/sound/ stays for later)
  const synth = null;
  const sonifier = null;
  const ui = new RUIN.Interface({ daemon, canvas, clock, synth });
  const growth = new RUIN.Growth({ daemon, aspect: renderer.aspect });
  renderer.scene.growth = growth;
  const life = new RUIN.Life({ growth, daemon, aspect: renderer.aspect });
  renderer.scene.life = life;
  const story = document.getElementById('story');
  // the human, as the daemon can sense them: where the cursor is on the ground, and taps
  const ground = (ev) => renderer.scene.pick(ev.clientX, ev.clientY, canvas.getBoundingClientRect());
  canvas.addEventListener('pointermove', (ev) => { const h = ground(ev); if (h) life.pointer(h.point[0], h.point[2]); });
  canvas.addEventListener('pointerdown', (ev) => { const h = ground(ev); if (h) life.tap(h.point[0], h.point[2]); });
  let told = '';
  // the game: one human thing per session, built by the players with real blocks
  const game = new RUIN.Game({ growth, daemon, scene: renderer.scene });
  const hud = { el: document.getElementById('hud'), name: document.getElementById('hud-name'), turn: document.getElementById('hud-turn'), count: document.getElementById('hud-count'), seen: '' };
  // a tap (not a drag) on the screen: the glowing block has been placed
  let down = null;
  canvas.addEventListener('pointerdown', (ev) => { down = { x: ev.clientX, y: ev.clientY, t: performance.now() }; });
  canvas.addEventListener('pointerup', (ev) => {
    if (down && Math.hypot(ev.clientX - down.x, ev.clientY - down.y) < 6 && performance.now() - down.t < 450) game.next();
    down = null;
  });
  window.addEventListener('keydown', (ev) => {
    if (ev.target instanceof HTMLInputElement || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (ev.key === 'ArrowRight' || (ev.key === 'Enter' && game.state === 'build')) game.next();
    else if (ev.key === 'ArrowLeft' || ev.key === 'Backspace') { ev.preventDefault(); game.back(); }
    else if (ev.key === 'g' || ev.key === 'G') { game.cycle(); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n' })); }
    else if (ev.key === '+' || ev.key === '=') game.setPlayers(game.players + 1);
    else if (ev.key === '-') game.setPlayers(game.players - 1);
  });
  const view = new RUIN.View({ daemon, renderer, growth, ui, canvas, clock });
  const cameras = new RUIN.Cameras({ daemon, growth });

  window.addEventListener('resize', () => renderer.resize());

  let last = performance.now();
  let time = 0;
  function frame(now) {
    const raw = Math.min(0.05, Math.max(0, (now - last) / 1000));   // never negative: the first frame can start before init ends
    last = now;
    const dt = clock.held || document.hidden ? 0 : raw;
    time += dt;
    daemon.update(dt);
    growth.update(dt);
    life.update(dt);
    game.update(dt);
    const st = game.status();
    if (st) hud.el.style.setProperty('--left', st.left.toFixed(3));
    const key = st ? [st.id, st.turn, st.k, st.n, st.players, st.alive].join() : '';
    if (key !== hud.seen) {
      hud.seen = key;
      hud.el.classList.toggle('is-on', !!st);
      if (st) {
        hud.el.style.setProperty('--c', st.hex);
        hud.name.textContent = st.id;
        hud.turn.innerHTML = st.alive ? '' : Array.from({ length: st.players }, (_, i) => `<i class="${i === st.turn ? 'is-turn' : ''}"></i>`).join('');
        hud.count.textContent = st.alive ? 'complete' : st.k + ' / ' + st.n;
      }
    }
    const say = growth.caption();
    if (say !== told) { told = say; if (say) story.textContent = say; story.classList.toggle('is-on', !!say); }
    ui.update(raw);
    view.update(raw);
    cameras.update(raw);
    sonifier?.update(raw);
    const t0 = performance.now();
    renderer.render(daemon, dt, time);
    renderer.measure(raw * 1000 || performance.now() - t0);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  window.daemon = daemon;
  window.RUIN.app = { daemon, renderer, ui, synth, sonifier, growth, life, game, view, cameras };
})(window.RUIN);
