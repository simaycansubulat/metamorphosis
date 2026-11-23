/* ---------------------------------------------------------------------------
 * construction.js — the participant's report of the physical model.
 *
 * A small top-down grid in a corner (COLS × ROWS cells, the same grid the
 * will thinks in). It mirrors the table where the pieces are built: each
 * cell holds a stack of 0..MAXH pieces.
 *
 *   click a cell               add a piece (stack one higher)
 *   right-click / alt-click    remove a piece
 *   "lift" mode                clicks remove instead of add (touch screens)
 *   clear                      the model was taken apart
 *   keyboard on a cell         Enter / + add · Backspace / Delete / - remove
 *
 * Pointing at a cell lights the matching region of the surface, so the
 * participant learns where on the surface each place of the table lives.
 * The panel shows only what was built: never what the daemon wants.
 * ------------------------------------------------------------------------- */
(function (RUIN) {
  'use strict';

  class Construction {
    constructor({ daemon, renderer, root }) {
      this.daemon = daemon;
      this.renderer = renderer;
      this.root = root;
      this.lift = false;
      const { COLS, ROWS } = RUIN.will;

      this.gridEl = root.querySelector('.site__grid');
      this.countEl = root.querySelector('.site__count');
      this.modeEl = root.querySelector('.site__mode');
      this.clearEl = root.querySelector('.site__clear');
      this.gridEl.style.setProperty('--cols', COLS);
      this.gridEl.style.setProperty('--rows', ROWS);

      this.cells = [];
      for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'site__cell';
        b.dataset.i = i; b.dataset.j = j;
        b.setAttribute('aria-label', `cell ${i + 1}, ${j + 1}: empty`);
        b.innerHTML = '<span class="stack"></span>';
        this.gridEl.appendChild(b);
        this.cells.push(b);
      }
      this.bind();
      this.render();
    }

    cellOf(ev) {
      const b = ev.target.closest('.site__cell');
      return b ? { i: +b.dataset.i, j: +b.dataset.j, el: b } : null;
    }

    place(i, j, delta) {
      if (this.daemon.state !== 'session') return;
      if (this.daemon.place(i, j, delta)) {
        const el = this.cells[j * RUIN.will.COLS + i];
        el.classList.remove('is-touched'); void el.offsetWidth; el.classList.add('is-touched');
      }
    }

    bind() {
      const g = this.gridEl, d = this.daemon;
      g.addEventListener('click', (ev) => {
        const c = this.cellOf(ev);
        if (c) this.place(c.i, c.j, this.lift || ev.altKey || ev.shiftKey ? -1 : 1);
      });
      g.addEventListener('contextmenu', (ev) => {
        const c = this.cellOf(ev);
        if (!c) return;
        ev.preventDefault();
        this.place(c.i, c.j, -1);
      });
      g.addEventListener('keydown', (ev) => {
        const c = this.cellOf(ev);
        if (!c) return;
        if (ev.key === 'Backspace' || ev.key === 'Delete' || ev.key === '-') { ev.preventDefault(); this.place(c.i, c.j, -1); }
        else if (ev.key === '+' || ev.key === '=') { ev.preventDefault(); this.place(c.i, c.j, 1); }
        else if (ev.key.startsWith('Arrow')) {
          ev.preventDefault();
          const { COLS, ROWS } = RUIN.will;
          const di = ev.key === 'ArrowLeft' ? -1 : ev.key === 'ArrowRight' ? 1 : 0;
          const dj = ev.key === 'ArrowUp' ? -1 : ev.key === 'ArrowDown' ? 1 : 0;
          const ni = Math.max(0, Math.min(COLS - 1, c.i + di)), nj = Math.max(0, Math.min(ROWS - 1, c.j + dj));
          this.cells[nj * COLS + ni].focus();
        }
        ev.stopPropagation(); // the global shortcuts (n, h, d…) stay out of the grid
      });
      const hover = (ev) => { const c = this.cellOf(ev); this.renderer.hover = c ? { i: c.i, j: c.j } : null; };
      g.addEventListener('pointerover', hover);
      g.addEventListener('focusin', hover);
      g.addEventListener('pointerleave', () => { this.renderer.hover = null; });
      g.addEventListener('focusout', () => { this.renderer.hover = null; });

      this.modeEl.addEventListener('click', () => {
        this.lift = !this.lift;
        this.modeEl.setAttribute('aria-pressed', String(this.lift));
        this.root.classList.toggle('is-lifting', this.lift);
      });
      this.clearEl.addEventListener('click', () => {
        // two-step: the first click arms, the second (within 3 s) clears
        if (!this.clearEl.classList.contains('is-armed')) {
          this.clearEl.classList.add('is-armed');
          this.clearEl.textContent = 'clear?';
          clearTimeout(this._arm);
          this._arm = setTimeout(() => { this.clearEl.classList.remove('is-armed'); this.clearEl.textContent = 'clear'; }, 3000);
          return;
        }
        clearTimeout(this._arm);
        this.clearEl.classList.remove('is-armed'); this.clearEl.textContent = 'clear';
        d.clearModel();
      });

      d.on('piece', () => this.render());
      d.on('session:start', () => this.render());
      d.on('session:end', () => this.render());
    }

    render() {
      const m = this.daemon.model, { MAXH } = RUIN.will;
      this.cells.forEach((el, c) => {
        const h = m && this.daemon.state === 'session' ? m.h[c] : 0;
        el.style.setProperty('--h', h / MAXH);
        el.dataset.h = h;
        el.querySelector('.stack').textContent = h > 1 ? h : '';
        el.setAttribute('aria-label', `cell ${(c % RUIN.will.COLS) + 1}, ${((c / RUIN.will.COLS) | 0) + 1}: ${h ? h + (h > 1 ? ' pieces' : ' piece') : 'empty'}`);
      });
      const n = m ? m.pieces : 0;
      this.countEl.textContent = `${n} ${n === 1 ? 'piece' : 'pieces'}`;
    }
  }

  RUIN.Construction = Construction;
})((window.RUIN = window.RUIN || {}));
