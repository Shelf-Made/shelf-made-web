/*
 * Reel director for Shelf Made: injected into the game page by capture.cjs (before the game's
 * own scripts), see the make-reels director contract. It steps the game one 1/30 s frame at a
 * time, sets up a scene (a fitted-out shop, a crowd, a storm...), plays a short script of
 * actions over the take, flies a portrait camera, paints the game's floating "+$" popups into
 * the frame (they are HTML in the game, so not in the GL canvas), logs every sound cue
 * instead of playing it and renders that log offline afterwards, in sync.
 *
 * A shot: { name, scene, seed?, seconds, tail?, speed? }. The take's "KO" is the scene's money
 * moment (a thief caught, a lightning strike, the last shelf placed...): the edit cuts on it.
 */
(() => {
  const FPS = 30;
  const R = (window.__reel = { frame: 0, events: [], marks: [], opts: null, koAt: -1 });
  const t = () => R.frame / FPS;
  const H = () => window.__shelf;
  const RT = () => window.__shelf.runtime;

  // An element with id="root" never shadows __shelf, but test for what only the hooks have.
  R.ready = () => !!(H() && H().ready && H().ready() && RT().renderer);

  const mark = (kind, label) => R.marks.push({ t: +t().toFixed(3), kind, label });
  const ko = (label) => { if (R.koAt < 0) { R.koAt = t(); mark('ko', label); } };

  // ---- Shop-relative coordinates (the shop's frame can be flipped on the south corners).
  const world = (s, x, z) => (s.shop.flip ? { x: s.shop.originX - x, z: s.shop.originZ - z } : { x: s.shop.originX + x, z: s.shop.originZ + z });
  const local = (s, x, z) => (s.shop.flip ? { x: s.shop.originX - x, z: s.shop.originZ - z } : { x: x - s.shop.originX, z: z - s.shop.originZ });
  const wyaw = (s, yaw) => (s.shop.flip ? yaw + Math.PI : yaw);
  const lerp = (a, b, k) => a + (b - a) * k;
  const ease = (k) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));
  const person = (s, id) => s.people.find((p) => p.id === id);
  const owner = (s) => s.people.find((p) => p.kind === 'owner');
  // Deterministic randomness per take, so a re-shoot is the same take.
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  const hireAll = (h, roles) => {
    for (const role of roles) { const c = h.state().staffPool.find((x) => x.role === role); if (c) h.dispatch({ type: 'hire', candidateId: c.id }); }
  };
  const fitOut = (h, { staff = true, open = true, warm = 60 } = {}) => {
    h.quickSetup(open);
    h.openRivals();
    h.dispatch({ type: 'cheat', cash: 30000 });
    if (staff) hireAll(h, ['cashier', 'stocker', 'cleaner']);
    if (warm) h.advanceScan(warm, 2);
    h.restock();
  };
  const place = (h, type, x, z, rot = 0, variant) => h.dispatch({ type: 'placeFixture', fixtureType: type, x, z, rot, variant }).ok;
  const STOCK = { produce: ['apples', 'oranges', 'tomatoes', 'lettuce', 'strawberries', 'bananas'], cold: ['milk', 'cheese', 'yogurt', 'chicken', 'eggs', 'butter'], dry: ['cereal', 'pasta', 'cola', 'chips', 'cookies', 'soup', 'juice', 'coffee', 'tea', 'ketchup', 'jam', 'water', 'chocolate', 'rice', 'beans', 'lemonade'] };
  const stockAll = (s) => {
    let i = 0;
    for (const f of s.shop.fixtures) {
      const list = f.type === 'produce' ? STOCK.produce : ['fridge', 'freezer'].includes(f.type) ? STOCK.cold : ['shelf', 'endcap', 'rack', 'wallShelf'].includes(f.type) ? STOCK.dry : null;
      if (!list) continue;
      f.slots.forEach((sl, j) => { if (!sl.productId) f.slots[j] = { productId: list[(i++) % list.length], qty: 0 }; });
    }
  };
  // A market hall, fitted out (the big "after" shop).
  const marketHall = (h) => {
    h.dispatch({ type: 'expandShop', sizeId: 'large' });
    h.dispatch({ type: 'expandLot' });
    for (const [x, z, ty, rot] of [[-1.5, -6, 'shelf', 0], [-0.5, -6, 'shelf', 0], [0.5, -6, 'endcap', 0], [-3.5, -4, 'freezer', 1], [-1.5, -4, 'shelf', 0], [-0.5, -4, 'shelf', 0], [2.5, -6, 'produce', 0], [3.5, -3, 'register', 3], [1.5, -2, 'flowers', 0], [-3.5, -1, 'plant', 0], [3.5, -7, 'shelf', 0]]) place(h, ty, x, z, rot);
    stockAll(h.state());
    h.dispatch({ type: 'setFloor', style: 'checker' });
    h.dispatch({ type: 'outsideSign', on: true });
    h.restock();
  };

  // ---- Scenes. setup() builds the moment; act(t) scripts it; cam(t) frames it (shop-relative
  // look-at x/z, yaw relative to the shop, distance, pitch, look height); `ko` names the cue
  // that is the take's money moment.
  // Follow a person (shop-relative), smoothed so the camera never jerks.
  const track = (s, c, id, k = 0.12) => {
    const p = person(s, id);
    if (p) { const l = local(s, p.x, p.z); c.fx = c.fx === undefined ? l.x : lerp(c.fx, l.x, k); c.fz = c.fz === undefined ? l.z : lerp(c.fz, l.z, k); }
    return { x: c.fx ?? 0, z: c.fz ?? -3 };
  };
  const emptyShelves = (s, keep = 0) => { for (const f of s.shop.fixtures) for (const sl of f.slots) if (sl.productId) sl.qty = keep; };

  const SCENES = {
    // A trading shop with a crowd: the calibration take.
    busy: {
      setup(h) { fitOut(h); h.crowd(8); h.crowd(3, false); h.advanceScan(20, 3); },
      cam: (tt) => ({ x: 0, z: -3, yaw: 0.35 + tt * 0.02, dist: 17 - tt * 0.25, pitch: 0.78 }),
      ko: 'cash',
    },

    // ---------------- Reel 1: the glow-up, Day 1 to Day 30.
    // The bare shell on day one, the manager alone in it; the camera creeps in.
    a_empty: {
      setup(h) { h.fp(0.3, -2.6, 0, 0.9, 12); h.state().people.filter((p) => p.kind === 'owner').forEach((o) => { o.yaw = 0; }); },
      cam: (tt) => ({ x: 0, z: -2.9, yaw: 0.5 - tt * 0.03, dist: 15 - tt * 0.45, pitch: 0.82 }),
      act(tt, h, rt, s) { const o = owner(s); if (o && tt > 2.5 && !o.waved) { o.waved = true; h.jump(); } },
      ko: 'hop',
    },
    // Fitting it out: one piece after another lands on the beat-ish.
    a_build: {
      setup(h) { h.dispatch({ type: 'cheat', cash: 30000 }); const s = h.state(); const o = owner(s); if (o) { const w = world(s, 0.3, -0.6); o.x = o.px = w.x; o.z = o.pz = w.z; } return { i: 0 }; },
      cam: (tt) => ({ x: 0, z: -3, yaw: -0.45 + tt * 0.035, dist: 14.5 - tt * 0.15, pitch: 0.95 }),
      act(tt, h, rt, s, c) {
        const f = s.shop.floor;
        const plan = [['register', f.x1 - 1, f.z1 - 3, 2], ['shelf', f.x0, f.z0 + 2, 1], ['shelf', f.x0, f.z0 + 3, 1], ['fridge', f.x1 - 1, f.z0, 3], ['shelf', -1, -3.5, 0], ['produce', 0.5, -3.5, 0], ['plant', f.x0, f.z1 - 1, 0], ['flowers', 1, -1, 0], ['shelf', -0.5, f.z0, 0]];
        while (c.i < plan.length && tt >= 0.6 + c.i * 0.55) {
          const [ty, x, z, rot] = plan[c.i++];
          place(h, ty, x + 0.5 * 0, z, rot);
          if (c.i === plan.length) ko('lastPiece');
        }
        if (c.i === plan.length && !c.stocked && tt > 0.6 + plan.length * 0.55 + 0.4) { c.stocked = true; stockAll(s); h.restock(); s.sounds.push('stock'); }
      },
    },
    // Doors open: the first shoppers stream in.
    a_open: {
      setup(h) { h.quickSetup(false); h.dispatch({ type: 'cheat', cash: 30000 }); h.restock(); return {}; },
      cam: (tt) => ({ x: 0, z: -1.2, yaw: 0.25 + tt * 0.02, dist: 16 - tt * 0.3, pitch: 0.62 }),
      act(tt, h, rt, s, c) {
        if (tt >= 1.0 && !c.open) { c.open = true; h.dispatch({ type: 'openShop' }); ko('open'); }
        if (tt >= 1.4 && !c.crowd) { c.crowd = true; h.crowd(5); h.crowd(2, false); }
        if (Math.floor(tt * 4) !== c.q) { c.q = Math.floor(tt * 4); h.dispatch({ type: 'scan' }); }
      },
    },
    // Day 30: a market hall, staff on the floor, packed.
    a_busy: {
      setup(h) { fitOut(h); marketHall(h); h.crowd(12); h.crowd(5, false); h.advanceScan(30, 2); h.crowd(6); h.advanceScan(8, 2); h.restock(); },
      cam: (tt) => ({ x: -0.3, z: -4, yaw: 0.65 - tt * 0.05, dist: 16 - tt * 0.2, pitch: 0.85 }),
      act(tt, h) { if (Math.floor(tt * 3) !== this.q) { this.q = Math.floor(tt * 3); h.dispatch({ type: 'scan' }); } },
      ko: 'cash', koAfter: 1.5,
    },
    // Dusk over the market hall: the sign lit, the street glowing, the camera pulls out to the town.
    a_dusk: {
      setup(h) { fitOut(h); marketHall(h); h.crowd(8); h.crowd(4, false); h.advanceScan(25, 2); h.setSky('clear'); h.setTime(12 * 60 * 0.885); },
      cam: (tt) => { const k = ease(tt / 9); return { x: lerp(0, 2, k), z: lerp(-3, 2, k), yaw: lerp(0.15, 0.75, k), dist: lerp(14, 40, k), pitch: lerp(0.55, 0.9, k), lookY: 0.8 }; },
      act(tt, h, rt, s) { s.time = Math.min(s.time, 12 * 60 * 0.97); if (tt > 4 && R.koAt < 0) ko('pullout'); },
    },

    // ---------------- Reel 2: restock ASMR.
    // The wholesale truck backs up to the back door and unloads.
    b_truck: {
      setup(h) {
        fitOut(h);
        h.dispatch({ type: 'placeOrder', supplierId: 'express', lines: [{ productId: 'milk', qty: 12 }, { productId: 'chips', qty: 12 }, { productId: 'bread', qty: 12 }] });
        const truck = () => h.state().cars.find((c) => c.orderId != null);
        for (let i = 0; i < 400 && !truck(); i++) h.advanceScan(1, 2);
        // Roll on until it is a few seconds out.
        for (let i = 0; i < 400; i++) { const c = truck(); if (!c || Math.hypot(c.x - world(h.state(), -1, -9).x, c.z - world(h.state(), -1, -9).z) < (h.state().__d ?? 17)) break; h.advanceScan(0.25, 2); }
        h.advanceScan(4.5, 2);
        { const c = truck(), s = h.state(); console.warn('truck', JSON.stringify(c && { st: c.state, x: c.x, z: c.z, o: s.shop.originX, oz: s.shop.originZ, flip: s.shop.flip })); }
        return { id: truck()?.id };
      },
      cam: (tt) => ({ x: -0.6, z: -7.6, yaw: 0.75 + tt * 0.02, dist: 12.5 - tt * 0.25, pitch: 0.8 }),
      ko: 'boxes',
    },
    // The manager grabs a box off the pallet and stocks a bare shelf: close in.
    b_stock: {
      setup(h) {
        fitOut(h, { staff: false, warm: 10 });
        const s = h.state();
        emptyShelves(s, 0);
        s.shop.storage = [{ productId: 'pasta', qty: 12, day: s.day }, { productId: 'chips', qty: 12, day: s.day }, { productId: 'bread', qty: 12, day: s.day }, { productId: 'cereal', qty: 12, day: s.day }];
        const shelf = s.shop.fixtures.find((f) => f.type === 'shelf');
        return { shelf: shelf?.id, o: owner(s)?.id, n: 0 };
      },
      cam: (tt) => ({ x: -1.6, z: -3.6, yaw: 1.05 + tt * 0.02, dist: 7.8 - tt * 0.1, pitch: 0.62, lookY: 0.7 }),
      act(tt, h, rt, s, c) {
        const o = owner(s);
        if (o && !o.task && !o.carrying && tt > 0.3 && c.n < 4) {
          const shelves = s.shop.fixtures.filter((f) => f.type === 'shelf');
          const f = shelves[c.n % shelves.length];
          if (h.dispatch({ type: 'carry', fixtureId: f.id }).ok) c.n++;
        }
      },
      ko: 'stock',
    },
    // Bare shelves fill up one after another: the restock, sped up.
    b_refill: {
      setup(h) { fitOut(h, { warm: 20 }); marketHall(h); const s = h.state(); emptyShelves(s, 0); s.people = s.people.filter((p) => p.kind !== 'customer'); return { i: 0 }; },
      cam: (tt) => ({ x: lerp(-1.6, 0.2, ease(tt / 9)), z: -5, yaw: 0.25 - tt * 0.02, dist: 10.5 - tt * 0.2, pitch: 0.82, lookY: 0.5 }),
      act(tt, h, rt, s, c) {
        const fx = s.shop.fixtures.filter((f) => f.slots.some((sl) => sl.productId)).sort((a, b) => a.x - b.x || a.z - b.z);
        while (c.i < fx.length && tt >= 1.0 + c.i * 0.42) {
          const f = fx[c.i++];
          for (const sl of f.slots) if (sl.productId) sl.qty = 99;
          h.restock();
          for (const g of fx.slice(c.i)) for (const sl of g.slots) if (sl.productId) sl.qty = 0;
          s.sounds.push('stock');
          if (c.i === fx.length) ko('full');
        }
      },
    },
    // A wall of full shelves with shoppers picking: low, close, sliding along the aisle.
    b_aisle: {
      setup(h) { fitOut(h); marketHall(h); h.crowd(10); h.advanceScan(12, 2); h.restock(); },
      cam: (tt) => ({ x: lerp(-2.2, 0.8, tt / 9), z: -5, yaw: 0.2, dist: 8.5, pitch: 0.68, lookY: 0.6 }),
      act(tt, h) { if (Math.floor(tt * 3) !== this.q) { this.q = Math.floor(tt * 3); h.dispatch({ type: 'scan' }); } },
      ko: 'cash', koAfter: 1,
    },
    // The till: a queue, beep, beep, ka-ching.
    b_till: {
      setup(h) {
        fitOut(h, { staff: false, warm: 30 });
        h.crowd(9); h.advanceNoScan(28);
        const s = h.state(); const reg = s.shop.fixtures.find((f) => f.type === 'register');
        return { reg: reg?.id };
      },
      cam(tt, s, c) {
        const reg = s.shop.fixtures.find((f) => f.id === c.reg);
        return { x: (reg?.x ?? 1.5) - 0.3, z: (reg?.z ?? -3) + 0.8, yaw: -0.45 + tt * 0.02, dist: 8.5, pitch: 0.72, lookY: 0.6 };
      },
      act(tt, h) { if (Math.floor(tt * 5) !== this.q) { this.q = Math.floor(tt * 5); h.dispatch({ type: 'scan' }); } },
      ko: 'cash', koAfter: 1,
    },

    // ---------------- Reel 3: ranking the chaos.
    // D tier: a spill. Someone drops a jar; the cleaner mops it up.
    c_spill: {
      setup(h) { fitOut(h); h.crowd(5); h.advanceScan(10, 2); return {}; },
      cam: (tt) => ({ x: -0.5, z: -2.8, yaw: 0.35 + tt * 0.02, dist: 9.5 - tt * 0.1, pitch: 0.78 }),
      act(tt, h, rt, s, c) {
        if (tt >= 1.2 && !c.done) {
          c.done = true;
          const w = world(s, -0.5, -2.6);
          s.shop.litter.push({ id: s.nextId++, x: w.x, z: w.z, dirt: 0.05 });
          s.sounds.push('spill');
          ko('spill');
        }
      },
    },
    // C tier: the rival's sale pulls the town over the zebra.
    c_rival: {
      setup(h) {
        fitOut(h);
        const s = h.state(); const r = s.rivals.find((x) => x.corner === 'se') ?? s.rivals[0];
        h.rivalSale(r.id); h.advanceScan(40, 2); h.rivalShoppers(r.id, 6);
        return { r: r.id };
      },
      cam(tt, s, c) { const r = s.rivals.find((x) => x.id === c.r); return { world: true, x: (r?.x ?? 11) - 2 + tt * 0.1, z: (r?.z ?? 4) - 2.5, yaw: Math.PI - 0.25 + tt * 0.02, dist: 24 - tt * 0.4, pitch: 0.8 }; },
      act(tt, h, rt, s, c) { if (tt >= 1.0 && !c.m) { c.m = true; h.rivalMove(c.r, 'priceMatch'); ko('rival'); } },
    },
    // B tier: two cars bump on Main Road.
    c_bump: {
      setup(h) {
        fitOut(h);
        const pair = () => { const cs = h.state().cars.filter((c) => c.state === 'passing'); for (const b of cs) for (const a of cs) { if (a === b || Math.abs(a.z - b.z) > 0.3) continue; const ahead = (a.x - b.x) * Math.sin(b.yaw); if (ahead >= 2 && ahead <= 6 && Math.abs(a.x) > 7 && Math.abs(b.x) > 7 && Math.abs(a.x) < 26) return { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }; } return null; };
        let at = null;
        for (let i = 0; i < 2400 && !(at = pair()); i++) h.advanceScan(0.1, 2);
        console.warn('bump pair', JSON.stringify(at));
        return { at };
      },
      cam(tt, s, c) {
        const b = s.life?.bumps?.[s.life.bumps.length - 1];
        if (b && c.ok && c.bx === undefined) { c.bx = b.x; c.bz = b.z; }
        const at = c.at ?? world(s, 0, 2.5);
        c.cx = c.cx === undefined ? at.x : lerp(c.cx, c.bx ?? at.x, 0.08); c.cz = c.cz === undefined ? at.z : lerp(c.cz, c.bz ?? at.z, 0.08);
        return { world: true, x: c.cx, z: c.cz, yaw: 0.5 + tt * 0.03, dist: 13 - tt * 0.25, pitch: 0.75 };
      },
      act(tt, h, rt, s, c) { if (tt >= 1.2 && tt < 5 && !c.ok) { c.ok = h.bump(); if (c.ok) ko('bump'); } },
    },
    // A tier: a shoplifter bolts, the alarm goes, staff run them down.
    c_thief: {
      setup(h) { fitOut(h); h.crowd(8); h.advanceScan(14, 2); return {}; },
      cam(tt, s, c) {
        const p = c.id ? track(s, c, c.id, 0.1) : { x: 0, z: -3 };
        return { x: lerp(p.x, 0, 0.35), z: lerp(p.z, -2.5, 0.35), yaw: 0.3 + tt * 0.02, dist: 11, pitch: 0.8 };
      },
      act(tt, h, rt, s, c) { if (tt >= 1.0 && !c.id) { const id = h.thief(); if (id) { c.id = id; } } },
      ko: 'caught',
    },
    // S tier: a thunderstorm, and lightning right over the shop.
    c_storm: {
      setup(h, rt) {
        fitOut(h); h.crowd(5); h.advanceScan(10, 2);
        h.setSky('storm'); h.soak();
        const w = rt.renderer.weather; try { w.rainLevel = 1; } catch { /* derived */ }
        return {};
      },
      cam: (tt) => ({ x: 0, z: -2.5, yaw: 0.2 + tt * 0.015, dist: 20 - tt * 0.3, pitch: 0.62, lookY: 1.5 }),
      act(tt, h, rt, s, c) {
        if (tt >= 2.0 && !c.a) { c.a = true; h.strike(-3, -9); }
        if (tt >= 5.5 && !c.b) { c.b = true; h.strike(4, -6); }
      },
      ko: 'thunder',
    },
  };

  let scene = null, ctx = {};

  R.setup = (opts) => {
    const h = H(), rt = RT();
    R.opts = opts;
    seed = (opts.seed ?? 7) * 97 + 13;
    scene = SCENES[opts.scene];
    if (!scene) throw new Error(`no scene ${opts.scene}`);

    // ---- Sound: log, don't play. Cues are rate-limited as play() does, on take time.
    const sfx = rt.audio;
    const last = new Map();
    const gap = (c) => (c === 'beep' ? 0.04 : c === 'chime' ? 0.35 : c === 'step' ? 0.15 : c === 'hover' ? 0.06 : c === 'whoosh' ? 0.25 : 0.12);
    sfx.play = (cue, o = {}) => {
      if (['hover', 'tap', 'cardOpen', 'cardClose', 'speed', 'tick', 'click'].includes(cue)) return;
      const now = t();
      if (now - (last.get(cue) ?? -9) < gap(cue)) return;
      last.set(cue, now);
      R.events.push({ t: now, name: 'cue', args: [cue, o.gain ?? 1, o.pan ?? 0] });
      if (scene.ko === cue && t() >= (scene.koAfter ?? 0)) ko(cue);
      if (['alarm', 'caught', 'spill', 'boxes', 'place', 'truck', 'reward', 'open'].includes(cue)) mark('sound', cue);
    };
    sfx.thunder = (distance, delay, strength = 1) => { R.events.push({ t: t(), name: 'thunder', args: [distance, delay, strength] }); mark('thunder', `${distance.toFixed(0)}`); if (scene.ko === 'thunder') ko('thunder'); };
    sfx.setRain = (level) => { R.rain = level; };
    sfx.start = () => {};
    sfx.setMood = () => {};

    // ---- The scene. (Paused while it is set up, then the clock runs at the shot's speed.)
    h.newGame(opts.seed ?? 3, opts.plot ?? 'main', opts.shopName ?? 'Corner Fresh', { tutorial: false });
    h.setSpeed(0);
    rt.settings.quality = 'high';
    ctx = scene.setup(h, rt, h.state(), opts) || {};
    h.state().sounds.length = 0;
    h.state().popups.length = 0;
    rt.cinematic = true;
    const r = rt.renderer;
    r.camera.bounds = { minX: -80, maxX: 80, minZ: -80, maxZ: 80 };
    r.camera.limits.minPitch = 0.05; r.camera.limits.maxPitch = 1.5;
    r.camera.camera.fov = opts.fov ?? 44;
    r.camera.camera.updateProjectionMatrix();
    h.setSpeed(opts.speed ?? 1);
    aim(0);
    r.camera.snap();
  };

  /** The portrait camera for take time `tt` (snapped: the path itself is smooth). */
  const aim = (tt) => {
    const s = H().state(), r = RT().renderer;
    const c = scene.cam(tt, s, ctx);
    const w = c.world ? { x: c.x, z: c.z } : world(s, c.x, c.z);
    r.camera.lookY = c.lookY ?? 0.6;
    r.camera.sideOffset = 0;
    r.camera.focus(w.x, w.z, c.dist, c.world ? c.yaw : wyaw(s, c.yaw), c.pitch);
    r.camera.snap();
  };

  // ---- Ambience the game plays on timers (birdsong, the rain's patter): logged on take time.
  let nextBird = 1.2, nextDrop = 0;
  const ambience = () => {
    const now = t(), s = H().state();
    const rain = R.rain ?? 0;
    if (rain >= 0.03 && now >= nextDrop) { R.events.push({ t: now, name: 'rain', args: [rain] }); nextDrop = now + 0.09; }
    if (now >= nextBird) {
      if (rain <= 0.2 && s.phase !== 'night') R.events.push({ t: now, name: 'bird', args: [] });
      nextBird = now + 1.8 + rnd() * 4.2;
    }
  };

  // ---- The game's floating popups ("+$4.20", "Caught!"), drawn as the game's CSS draws them.
  const born = new Map();
  let overlay = null, octx = null;
  const COLORS = { money: '#FFC044', info: '#FFFFFF', bad: '#FF8C6B' };
  const paintPopups = (w, h, buf) => {
    const s = H().state(), r = RT().renderer;
    const now = t();
    const live = [];
    for (const p of s.popups) {
      if (!born.has(p.id)) born.set(p.id, now);
      const age = now - born.get(p.id);
      if (age > 2.2) continue;
      const proj = { x: 0, y: 0, visible: false };
      r.project(p.x, p.y, p.z, proj);
      if (!proj.visible) continue;
      live.push({ p, age, x: proj.x, y: proj.y });
    }
    if (!live.length) return;
    if (!overlay) { overlay = new OffscreenCanvas(w, h); octx = overlay.getContext('2d', { willReadFrequently: true }); }
    octx.clearRect(0, 0, w, h);
    const scale = R.opts.popupScale ?? 2.1;
    let x0 = w, x1 = 0, y0 = h, y1 = 0;
    for (const { p, age, x, y } of live) {
      const k = age / 2.2;
      const alpha = k < 0.1 ? k / 0.1 : 1 - (k - 0.1) / 0.9;
      const yy = y - 60 * scale * k * (1 - 0.3 * k);
      const size = (p.kind === 'info' ? 16 : 17.6) * scale;
      octx.font = `700 ${size}px Fredoka, Nunito, sans-serif`;
      octx.textAlign = 'center'; octx.textBaseline = 'bottom';
      octx.globalAlpha = Math.max(0, Math.min(1, alpha));
      octx.fillStyle = 'rgba(0,0,0,0.35)'; octx.fillText(p.text, x, yy + 2 * scale);
      octx.lineWidth = 3 * scale; octx.strokeStyle = 'rgba(0,0,0,0.22)'; octx.strokeText(p.text, x, yy);
      octx.fillStyle = COLORS[p.kind] ?? '#FFFFFF'; octx.fillText(p.text, x, yy);
      const tw = octx.measureText(p.text).width;
      x0 = Math.min(x0, x - tw / 2 - 12); x1 = Math.max(x1, x + tw / 2 + 12); y0 = Math.min(y0, yy - size - 12); y1 = Math.max(y1, yy + 3 * scale + 12);
    }
    octx.globalAlpha = 1;
    x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0)); x1 = Math.min(w, Math.ceil(x1)); y1 = Math.min(h, Math.ceil(y1));
    if (x1 <= x0 || y1 <= y0) return;
    const img = octx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
    const bw = x1 - x0;
    // The GL buffer runs bottom-up.
    for (let yy = y0; yy < y1; yy++) {
      const row = (h - 1 - yy) * w * 4;
      for (let xx = x0; xx < x1; xx++) {
        const si = ((yy - y0) * bw + (xx - x0)) * 4, a = img[si + 3];
        if (!a) continue;
        const di = row + xx * 4, f = a / 255;
        // Canvas image data is un-premultiplied.
        buf[di] = buf[di] * (1 - f) + img[si] * f; buf[di + 1] = buf[di + 1] * (1 - f) + img[si + 1] * f; buf[di + 2] = buf[di + 2] * (1 - f) + img[si + 2] * f;
      }
    }
  };

  /** One frame of game time; returns the frame's pixels (RGBA, bottom row first). */
  R.step = () => {
    const h = H(), rt = RT();
    const tt = t();
    if (scene.act) scene.act(tt, h, rt, h.state(), ctx);
    aim(tt);
    R.frame++;
    rt.frame(1 / FPS);
    ambience();
    const gl = rt.renderer.renderer.getContext();
    const w = gl.drawingBufferWidth, hh = gl.drawingBufferHeight;
    if (!R.buf || R.buf.length !== w * hh * 4) R.buf = new Uint8Array(w * hh * 4);
    gl.readPixels(0, 0, w, hh, gl.RGBA, gl.UNSIGNED_BYTE, R.buf);
    if (R.opts.popups !== false) paintPopups(w, hh, R.buf);
    return R.buf;
  };

  R.state = () => ({ frame: R.frame, t: t(), koAt: R.koAt, over: false });

  /** Render the logged sounds, in sync, as 16-bit stereo WAV bytes. */
  R.renderAudio = async (seconds) => {
    const rate = 48000;
    const ctxA = new OfflineAudioContext(2, Math.ceil(seconds * rate), rate);
    const sfx = new (RT().audio.constructor)();
    sfx.attach(ctxA);
    sfx.setVolumes({ master: 0.8, music: 0, sfx: 0.9 });
    const play = (ev) => {
      try {
        if (ev.name === 'cue') { sfx.cueGain = ev.args[1]; sfx.cuePan = ev.args[2]; sfx.cue(ev.args[0]); sfx.cueGain = 1; sfx.cuePan = 0; }
        else if (ev.name === 'thunder') sfx.thunder(...ev.args);
        else if (ev.name === 'bird') sfx.bird();
        else if (ev.name === 'rain') {
          sfx.rain = ev.args[0];
          const n = 2 + Math.floor(sfx.rain * 7);
          for (let i = 0; i < n; i++) sfx.drop(Math.random() * 0.09);
          if (sfx.rain > 0.55 && Math.random() < 0.5) sfx.ambientNoise(0.5, 0.012 * sfx.rain, 900, 'lowpass');
        }
      } catch (err) { console.warn('sfx replay', ev.name, err); }
    };
    const q = 128 / rate;
    const groups = new Map();
    for (const ev of R.events) {
      const at = Math.round(ev.t / q) * q;
      if (at >= seconds) continue;
      if (!groups.has(at)) groups.set(at, []);
      groups.get(at).push(ev);
    }
    for (const [at, evs] of groups) {
      if (at <= 0) evs.forEach(play);
      else ctxA.suspend(at).then(() => { evs.forEach(play); ctxA.resume(); });
    }
    const buf = await ctxA.startRendering();
    const n = buf.length;
    const out = new DataView(new ArrayBuffer(44 + n * 4));
    const str = (o, s) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
    str(0, 'RIFF'); out.setUint32(4, 36 + n * 4, true); str(8, 'WAVEfmt ');
    out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 2, true);
    out.setUint32(24, rate, true); out.setUint32(28, rate * 4, true); out.setUint16(32, 4, true); out.setUint16(34, 16, true);
    str(36, 'data'); out.setUint32(40, n * 4, true);
    const L = buf.getChannelData(0), Rc = buf.getChannelData(1);
    for (let i = 0; i < n; i++) {
      out.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[i])) * 0x7fff, true);
      out.setInt16(46 + i * 4, Math.max(-1, Math.min(1, Rc[i])) * 0x7fff, true);
    }
    return new Uint8Array(out.buffer);
  };
})();
