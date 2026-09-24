// Puesto · Ceph: el clúster de almacenamiento y sus comandos.
//
// Nada se guarda "ya calculado". El uso de cada OSD sale de cuántos datos hay,
// de qué OSD están dentro (in) y de su peso; la salud sale de qué demonios
// corren. Por eso `ceph osd out`, un reinicio o encender el balancer mueven
// los números solos, con el tiempo que tardaría un clúster real.
(function (P) {
'use strict';
const U = P.u, L = U.L, T = P.T;

const CEPH = ['ceph01', 'ceph02', 'ceph03'];
const OBJ = 812430, COPIAS = OBJ * 3, PGS = 481, PG_OSD = 160, OBJ_OSD = COPIAS / 9, CAP = 1.75;
const SESGO = [-1.9, 0.9, -0.2, 2.0, -0.6, 1.5, 0.1, -2.4, 0.6];   // reparto natural, suma 0
const MEDIA = 60.3;
const POOLS = [
  { id: 1, n: '.mgr', pgs: 1, parte: 0, obj: 2 },
  { id: 2, n: 'volumes', pgs: 256, parte: 0.55 },
  { id: 3, n: 'images', pgs: 64, parte: 0.08 },
  { id: 4, n: 'vms', pgs: 128, parte: 0.30 },
  { id: 5, n: 'backups', pgs: 32, parte: 0.07 },
];
P.SESGO = SESGO;

P.alCrear.push(st => {
  st.ceph = {
    fsid: 'b1f4c3a2-7d4e-4c1a-9a51-3f0e2d9c8b71',
    flags: {}, nearfull: 0.85, backfillfull: 0.90, full: 0.95, downOut: 10,   // mon_osd_down_out_interval = 600 s
    osds: SESGO.map((s, i) => ({ id: i, host: 'ceph0' + (Math.floor(i / 3) + 1), dev: ['/dev/sdb', '/dev/sdc', '/dev/sdd'][i % 3], in: true, reweight: 1, sesgo: s, disco: 'ok', downDesde: null, autoOut: false })),
    datos: MEDIA * 9,
    rec: null, movimientos: 0, crashes: [], balancer: { activo: true, modo: 'upmap' }, historial: [],
    cambioUp: -17280, cambioIn: -17280,   // para el "since" de ceph -s
    config: {},                           // ceph config set: lo que difiere de los valores por defecto
  };
});

// ------------------------------------------------------------------ modelo
U.osdUp = (st, o) => { const h = st.hosts[o.host], s = h && h.svcs['ceph-osd@' + o.id]; return !!(h && h.up && s && s.estado === 'active'); };
function objetivo(st) {
  const c = st.ceph, w = c.osds.map(o => o.in ? o.reweight : 0), sw = w.reduce((a, b) => a + b, 0) || 1;
  return c.osds.map((o, i) => o.in ? Math.max(0, Math.min(99.9, c.datos * w[i] / sw + o.sesgo)) : 0);
}
U.usos = st => {
  const obj = objetivo(st), r = st.ceph.rec;
  if (r && r.desde) { const f = 1 - r.restante / r.total; return obj.map((v, i) => r.desde[i] + (v - r.desde[i]) * f); }
  return obj;
};
const desbalance = c => Math.max(...c.osds.map(o => Math.abs(o.sesgo - SESGO[o.id])));

// Todo cambio que mueve datos pasa por aquí: guarda de dónde partían los usos
// para que el panel y `ceph osd df` los vean avanzar minuto a minuto.
P.cephCambiar = (st, cambio, o) => {
  const c = st.ceph, desde = U.usos(st), inAntes = c.osds.map(o => o.in).join();
  cambio();
  if (c.osds.map(o => o.in).join() !== inAntes) c.cambioIn = st.reloj;
  const prev = c.rec, f = prev ? prev.restante / prev.total : 0;
  const total = Math.max(o.min, prev ? prev.restante : 0);
  c.rec = {
    tipo: prev && prev.tipo !== 'log' ? prev.tipo : o.tipo, total, restante: total, desde,
    degObj: (o.degObj || 0) + (prev ? prev.degObj * f : 0), degPgs: (o.degPgs || 0) + (prev ? prev.degPgs * f : 0),
    malObj: (o.malObj || 0) + (prev ? prev.malObj * f : 0), malPgs: (o.malPgs || 0) + (prev ? prev.malPgs * f : 0),
  };
  if (o.tipo !== 'log') c.movimientos++;
};
const clog = (st, sev, t) => st.ceph.historial.push({ min: st.reloj, sev, t });
P.cephLog = clog;

U.degradado = st => {
  const c = st.ceph, downIn = c.osds.filter(o => o.in && !U.osdUp(st, o));
  let obj = downIn.length * OBJ_OSD, und = Math.min(PGS, downIn.length * PG_OSD), pgRec = 0, mal = 0, pgMal = 0;
  const r = c.rec;
  if (r) {
    const f = r.restante / r.total;
    obj += r.degObj * f; pgRec = Math.min(PGS, Math.round(r.degPgs * f));
    mal = Math.round(r.malObj * f); pgMal = Math.min(PGS, Math.round(r.malPgs * f));
  }
  let inact = 0;
  for (let i = 0; i < downIn.length; i++) for (let j = i + 1; j < downIn.length; j++) if (downIn[i].host !== downIn[j].host) inact += 53;
  return { downIn: downIn.length, obj: Math.round(obj), pgs: Math.min(PGS, und + pgRec), und, pgRec, mal, pgMal, inactivas: Math.min(PGS, inact), tipo: r ? r.tipo : null };
};

P.ticks.push(st => {
  const c = st.ceph;
  if (c.rec) { c.rec.restante--; if (c.rec.restante <= 0) { c.rec = null; clog(st, 'INF', 'Health check cleared: PG_DEGRADED (was: Degraded data redundancy)'); } }
  c.osds.forEach(o => {
    const up = U.osdUp(st, o);
    if (!up) {
      if (o.downDesde == null) { o.downDesde = st.reloj; clog(st, 'INF', 'osd.' + o.id + ' marked itself down and dead'); }
      if (o.in && !c.flags.noout && st.reloj - o.downDesde >= c.downOut) {
        clog(st, 'INF', 'Marking osd.' + o.id + ' out (has been down for ' + (c.downOut * 60) + ' seconds)');
        P.cephCambiar(st, () => { o.in = false; o.autoOut = true; }, { tipo: 'backfill', min: 8, degObj: OBJ_OSD, degPgs: PG_OSD });
      }
    } else if (o.downDesde != null) {
      const caido = st.reloj - o.downDesde; o.downDesde = null; c.cambioUp = st.reloj;
      clog(st, 'INF', 'osd.' + o.id + ' [v2:' + st.hosts[o.host].ip + ':68' + (o.id + 10) + '/' + U.pid(o.id) + '] boot');
      if (o.in) P.cephCambiar(st, () => {}, { tipo: 'log', min: 1, degObj: Math.min(OBJ_OSD, 1400 * Math.max(1, caido)), degPgs: PG_OSD });
      else if (o.autoOut) P.cephCambiar(st, () => { o.in = true; o.autoOut = false; }, { tipo: 'backfill', min: 6, malObj: OBJ_OSD, malPgs: PG_OSD });
    }
  });
  if (c.balancer.activo && !c.rec && desbalance(c) > 3) {
    P.cephCambiar(st, () => c.osds.forEach(o => { o.sesgo = SESGO[o.id]; }), { tipo: 'reparto', min: 6, malObj: 96000, malPgs: 44 });
  }
});

// ------------------------------------------------------------------ salud
P.saludCeph = st => {
  const c = st.ceph, checks = [], osds = c.osds;
  const add = (code, sev, res, det) => checks.push({ code, sev, res, det: det || [] });
  const mons = CEPH.filter(n => st.hosts[n].up && st.hosts[n].svcs['ceph-mon@' + n].estado === 'active');
  if (mons.length < 2) return { estado: 'HEALTH_ERR', sinQuorum: true, mons, checks: [{ code: 'MON_DOWN', sev: 'ERR', res: (3 - mons.length) + '/3 mons down, no quorum', det: [] }] };
  const flags = Object.keys(c.flags).filter(k => c.flags[k]);
  if (flags.length) add('OSDMAP_FLAGS', 'WRN', flags.join(',') + ' flag(s) set');
  if (mons.length < 3) add('MON_DOWN', 'WRN', (3 - mons.length) + '/3 mons down, quorum ' + mons.join(','), CEPH.filter(n => mons.indexOf(n) < 0).map(n => 'mon.' + n + ' (rank ' + CEPH.indexOf(n) + ') addr [v2:' + st.hosts[n].ip + ':3300/0,v1:' + st.hosts[n].ip + ':6789/0] is down (out of quorum)'));
  const downIn = osds.filter(o => o.in && !U.osdUp(st, o));
  const hostsDown = CEPH.filter(n => osds.filter(o => o.host === n).every(o => o.in && !U.osdUp(st, o)));
  if (hostsDown.length) add('OSD_HOST_DOWN', 'WRN', hostsDown.length + ' host (' + hostsDown.length * 3 + ' osds) down', hostsDown.map(n => 'host ' + n + ' (root=default) (3 osds) is down'));
  if (downIn.length) add('OSD_DOWN', 'WRN', downIn.length + ' osds down', downIn.map(o => 'osd.' + o.id + ' (root=default,host=' + o.host + ') is down'));
  const d = U.degradado(st);
  if (d.inactivas) add('PG_AVAILABILITY', 'ERR', 'Reduced data availability: ' + d.inactivas + ' pgs inactive', ['pg 2.1a is stuck inactive for 2m, current state undersized+degraded+peered, last acting [5]']);
  if (d.obj > 0) add('PG_DEGRADED', 'WRN', 'Degraded data redundancy: ' + d.obj + '/' + COPIAS + ' objects degraded (' + (d.obj / COPIAS * 100).toFixed(3) + '%), ' + d.pgs + ' pgs degraded' + (d.und ? ', ' + d.und + ' pgs undersized' : ''),
    ejemplosPg(st, downIn, d));
  const usos = U.usos(st);
  const llenos = osds.filter(o => o.in && U.osdUp(st, o) && usos[o.id] >= c.full * 100);
  const casi = osds.filter(o => o.in && U.osdUp(st, o) && usos[o.id] >= c.nearfull * 100 && usos[o.id] < c.full * 100);
  if (llenos.length) { add('OSD_FULL', 'ERR', llenos.length + ' full osd(s)', llenos.map(o => 'osd.' + o.id + ' is full')); add('POOL_FULL', 'ERR', '4 pool(s) full', POOLS.slice(1).map(p => "pool '" + p.n + "' is full (no space)")); }
  if (casi.length) { add('OSD_NEARFULL', 'WRN', casi.length + ' nearfull osd(s)', casi.map(o => 'osd.' + o.id + ' is near full')); add('POOL_NEARFULL', 'WRN', '4 pool(s) nearfull', POOLS.slice(1).map(p => "pool '" + p.n + "' is nearfull")); }
  const skew = mons.filter(n => Math.abs(st.hosts[n].ntp.offset) > 0.05);
  if (skew.length) add('MON_CLOCK_SKEW', 'WRN', 'clock skew detected on ' + skew.map(n => 'mon.' + n).join(', '), skew.map(n => 'mon.' + n + ' clock skew ' + Math.abs(st.hosts[n].ntp.offset).toFixed(4) + 's > max 0.05s (latency 0.00213s)'));
  // Cada monitor vigila el disco donde guarda su base de datos.
  mons.forEach(n => {
    const libre = 100 - U.pctDisco(st.hosts[n], '/');
    if (libre < 5) add('MON_DISK_CRIT', 'ERR', 'mon ' + n + ' is very low on available space', ['mon.' + n + ' has ' + libre + '% avail']);
    else if (libre < 30) add('MON_DISK_LOW', 'WRN', 'mon ' + n + ' is low on available space', ['mon.' + n + ' has ' + libre + '% avail']);
  });
  const cr = c.crashes.filter(x => !x.archivado);
  if (cr.length) add('RECENT_CRASH', 'WRN', cr.length + ' daemons have recently crashed', cr.map(x => x.entidad + ' crashed on host ' + x.host + ' at ' + x.cuando));
  const estado = checks.some(x => x.sev === 'ERR') ? 'HEALTH_ERR' : checks.length ? 'HEALTH_WARN' : 'HEALTH_OK';
  return { estado, checks, mons };
};
function ejemplosPg(st, downIn, d) {
  const out = [], base = downIn.length ? downIn : st.ceph.osds.filter(o => !o.in).slice(0, 1);
  const estado = d.pgRec && !d.und ? (d.tipo === 'log' ? 'active+recovering+degraded' : 'active+undersized+degraded+remapped+backfilling') : 'active+undersized+degraded';
  for (let i = 0; i < 4; i++) {
    const o = base[i % Math.max(1, base.length)], otros = [0, 1, 2, 3, 4, 5, 6, 7, 8].filter(x => !o || Math.floor(x / 3) !== Math.floor(o.id / 3));
    const a = otros[(i * 2) % otros.length], b = otros[(i * 2 + 3) % otros.length];
    out.push('pg ' + (2 + (i % 3)) + '.' + (0x1a + i * 37).toString(16) + ' is ' + estado + ', acting [' + a + ',' + b + ']');
  }
  out.push('...');
  return out;
}
P.pendientesSalud = st => {
  const s = P.saludCeph(st);
  return s.estado === 'HEALTH_OK' ? [] : [T('Ceph sigue en ', 'Ceph is still in ') + s.estado + ': ' + s.checks.map(c => c.res).join(' · ')];
};
P.cephCrashMon = (st, host, min) => {
  const cuando = U.iso(min) + '.' + String(512093 + Math.abs(min) * 17).slice(0, 6) + 'Z';
  st.ceph.crashes.push({ id: cuando + '_' + U.uuid('crashmon' + host + min), entidad: 'mon.' + host, host, cuando, tipo: 'paxos', archivado: false, min });
};
P.cephCrash = (st, osd, min, tipo) => {
  const cuando = U.iso(min) + '.' + String(338211 + osd * 7919 + Math.abs(min) * 13).slice(0, 6) + 'Z';
  st.ceph.crashes.push({ id: cuando + '_' + U.uuid('crash' + osd + min), entidad: 'osd.' + osd, host: st.ceph.osds[osd].host, cuando, tipo, archivado: false, min });
};

P.detectores.push((st, add) => {
  const s = P.saludCeph(st);
  if (s.estado !== 'HEALTH_OK') add(s.estado === 'HEALTH_ERR' ? 'CephHealthError' : 'CephHealthWarning', s.estado === 'HEALTH_ERR' ? 'critical' : 'warning', null, T('Ceph en ', 'Ceph in ') + s.estado + ': ' + s.checks.map(x => x.code).join(', '), 'CephHealth');
  const usos = U.usos(st);
  st.ceph.osds.forEach(o => {
    if (o.in && !U.osdUp(st, o)) add('CephOSDDown', 'critical', o.host, 'osd.' + o.id + ' down', 'CephOSDDown|' + o.id);
    if (o.in && U.osdUp(st, o) && usos[o.id] >= st.ceph.nearfull * 100) add('CephOSDNearFull', 'warning', o.host, 'osd.' + o.id + T(' al ', ' at ') + usos[o.id].toFixed(1) + ' %', 'CephOSDNearFull|' + o.id);
  });
});
// Cada reinicio queda apuntado con el estado de noout en ese momento.
P.alApagar.push((st, h) => { st.hechos.reinicios.push({ host: h.nombre, min: st.reloj, noout: !!(st.ceph && st.ceph.flags.noout), salud: P.saludCeph(st).estado }); });

// ------------------------------------------------------------------ fallos
P.motivos['osd-suicidio'] = {
  result: 'signal', proceso: '(code=killed, signal=ABRT)', limite: true,
  journal: (st, h, u, min) => {
    const id = u.split('@')[1], out = [];
    [3, 2, 0].forEach((d, i) => {
      const src = 'ceph-osd[' + U.pid(h.nombre + u + (min - d)) + ']';
      out.push({ min: min - d, src, t: U.iso(min - d) + '.118+0000 7f2c1a7fe640 -1 heartbeat_map is_healthy \'OSD::osd_op_tp thread 0x7f2c1a7fe640\' had suicide timed out after 150.000000000s' });
      out.push({ min: min - d, src, t: '*** Caught signal (Aborted) **' });
      out.push({ min: min - d, src, t: ' in thread 7f2c1a7fe640 thread_name:tp_osd_tp' });
      out.push({ min: min - d, src: 'systemd[1]', t: u + '.service: Main process exited, code=killed, status=6/ABRT' });
      if (i < 2) out.push({ min: min - d, src: 'systemd[1]', t: u + '.service: Scheduled restart job, restart counter is at ' + (i + 1) + '.' });
    });
    return out;
  },
};
P.motivos['disco-muerto'] = {
  result: 'exit-code', proceso: '(code=exited, status=1/FAILURE)', limite: true,
  journal: (st, h, u, min) => {
    const id = u.split('@')[1], src = 'ceph-osd[' + U.pid(h.nombre + u + min) + ']';
    return [
      { src, t: U.iso(min) + '.402+0000 7f81d2e3c5c0 -1 bluestore(/var/lib/ceph/osd/ceph-' + id + ') _read_bdev_label failed to read from /var/lib/ceph/osd/ceph-' + id + '/block: (5) Input/output error' },
      { src, t: U.iso(min) + '.402+0000 7f81d2e3c5c0 -1  ** ERROR: unable to open OSD superblock on /var/lib/ceph/osd/ceph-' + id + ': (5) Input/output error' },
      { src: 'systemd[1]', t: u + '.service: Main process exited, code=exited, status=1/FAILURE' },
    ];
  },
  alFallar: (st, h, u) => {
    const o = st.ceph.osds[+u.split('@')[1]], dev = o.dev.replace('/dev/', ''), t = (1036500 + (st.reloj + 200) * 60).toFixed(0);
    h.dmesg.push('[' + t + '.884211] sd 0:0:' + (o.id % 3 + 1) + ':0: [' + dev + '] tag#12 FAILED Result: hostbyte=DID_OK driverbyte=DRIVER_OK cmd_age=3s');
    h.dmesg.push('[' + t + '.884230] sd 0:0:' + (o.id % 3 + 1) + ':0: [' + dev + '] tag#12 Sense Key : Medium Error [current]');
    h.dmesg.push('[' + t + '.884240] critical medium error, dev ' + dev + ', sector 1874412872 op 0x0:(READ) flags 0x0 phys_seg 1 prio class 2');
    h.dmesg.push('[' + t + '.884301] Buffer I/O error on dev dm-' + (o.id % 3 + 1) + ', logical block 234301609, async page read');
  },
};
P.motivos['mon-sin-espacio'] = {
  result: 'exit-code', proceso: '(code=exited, status=0/SUCCESS)',
  journal: (st, h, u) => [
    { src: 'ceph-mon[' + U.pid(h.nombre + u) + ']', t: U.iso(st.reloj) + '.771+0000 7f0c3b1fe640 -1 mon.' + h.nombre + '@0(peon).data_health(42) reached critical levels of available space on local monitor storage -- shutdown!' },
    { src: 'systemd[1]', t: u + '.service: Deactivated successfully.' },
  ],
};
P.reglas.push((st, h, u) => /^ceph-mon@/.test(u) && U.pctDisco(h, '/') >= 95 ? 'mon-sin-espacio' : null);
// Un monitor en debug_mon 20 escribe cientos de MB por minuto; al 95 % se apaga solo.
P.ticks.push(st => {
  if (!/^20/.test(st.ceph.config['mon/debug_mon'] || '')) return;
  CEPH.forEach(n => {
    const h = st.hosts[n], u = 'ceph-mon@' + n, p = '/var/log/ceph/ceph-mon.' + n + '.log';
    if (!h.up || h.svcs[u].estado !== 'active' || h.logs[p] == null) return;
    h.logs[p] += 150;
    if (U.pctDisco(h, '/') >= 95) P.fallar(st, h, u, 'mon-sin-espacio', st.reloj);
  });
});
P.motivos['mon-abort'] = {
  result: 'signal', proceso: '(code=killed, signal=ABRT)', limite: true,
  journal: (st, h, u, min) => {
    const src = 'ceph-mon[' + U.pid(h.nombre + u + min) + ']';
    return [
      { min: min - 1, src, t: './src/mon/Paxos.cc: In function \'void Paxos::handle_last(MonOpRequestRef)\' thread 7f41c2ffd640' },
      { min: min - 1, src, t: './src/mon/Paxos.cc: 1122: FAILED ceph_assert(p.second <= last_committed)' },
      { min: min - 1, src, t: '*** Caught signal (Aborted) **' },
      { min: min - 1, src: 'systemd[1]', t: u + '.service: Main process exited, code=killed, status=6/ABRT' },
      { min: min - 1, src: 'systemd[1]', t: u + '.service: Scheduled restart job, restart counter is at 3.' },
    ];
  },
};
P.reglas.push((st, h, u) => {
  const m = /^ceph-osd@(\d+)$/.exec(u);
  if (m) { const o = st.ceph.osds[+m[1]]; if (o && o.disco !== 'ok') return 'disco-muerto'; }
  return null;
});

// ------------------------------------------------------------------ logs
P.generadoresLog.push((st, h, p) => {
  let m = /\/var\/log\/ceph\/ceph-osd\.(\d+)\.log$/.exec(p);
  if (m) {
    const o = st.ceph.osds[+m[1]], s = h.svcs['ceph-osd@' + o.id], out = [];
    const t = min => U.iso(min) + '.' + String(100 + (Math.abs(min) * 7) % 900) + '+0000 7f3c' + U.hex('osd' + o.id, 8);
    for (let i = 6; i > 0; i--) out.push(t(s.desde - i * 20) + '  0 log_channel(cluster) log [DBG] : ' + (2 + i % 3) + '.' + (i * 17).toString(16) + ' scrub ok');
    if (s.motivo === 'osd-suicidio') {
      out.push(t(s.desde - 4) + '  0 log_channel(cluster) log [DBG] : 2.7f deep-scrub starts');
      out.push(t(s.desde - 3) + ' -1 heartbeat_map is_healthy \'OSD::osd_op_tp thread 0x7f2c1a7fe640\' had timed out after 15.000000954s');
      out.push(t(s.desde) + ' -1 heartbeat_map is_healthy \'OSD::osd_op_tp thread 0x7f2c1a7fe640\' had suicide timed out after 150.000000000s');
      out.push(t(s.desde) + ' -1 *** Caught signal (Aborted) **');
      out.push(' ceph version 18.2.4 (e7ad5345525c7aa95470c26863873b581076945d) reef (stable)');
      out.push(' 1: /lib/x86_64-linux-gnu/libc.so.6(+0x42520) [0x7f2c2d842520]');
      out.push(' 2: (ceph::HeartbeatMap::_check(ceph::heartbeat_handle_d const*, char const*, std::chrono::time_point<ceph::coarse_mono_clock>)+0x2f1) [0x55d1e2a0c3b1]');
      out.push(' NOTE: a copy of the executable, or `objdump -rdS <executable>` is needed to interpret this.');
    } else if (s.motivo === 'disco-muerto') {
      out.push(t(s.desde - 90) + ' -1 bdev(0x55a1f2e3c000 /var/lib/ceph/osd/ceph-' + o.id + '/block) _aio_thread got r=-5 ((5) Input/output error)');
      out.push(t(s.desde - 90) + ' -1 bluestore(/var/lib/ceph/osd/ceph-' + o.id + ') _do_read bdev-read failed: (5) Input/output error');
      out.push(t(s.desde - 90) + ' -1 *** Caught signal (Aborted) **');
      out.push(t(s.desde) + ' -1 bluestore(/var/lib/ceph/osd/ceph-' + o.id + ') _read_bdev_label failed to read from /var/lib/ceph/osd/ceph-' + o.id + '/block: (5) Input/output error');
      out.push(t(s.desde) + ' -1  ** ERROR: unable to open OSD superblock on /var/lib/ceph/osd/ceph-' + o.id + ': (5) Input/output error');
    }
    return out;
  }
  if (/\/var\/log\/ceph\/ceph\.log$/.test(p)) {
    const base = [{ min: -60, sev: 'INF', t: 'overall HEALTH_OK' }];
    return base.concat(st.ceph.historial).slice(-30).map((x, i) => U.iso(x.min) + '.' + String(411872 + i * 97).slice(0, 6) + '+0000 mon.ceph01 (mon.0) ' + (18200 + i) + ' : cluster [' + x.sev + '] ' + x.t);
  }
  return null;
});

// ------------------------------------------------------------------ salida
U.bytes = tib => {
  const f = (v, u) => (v < 10 ? v.toFixed(1) : String(Math.round(v))) + ' ' + u;
  if (tib >= 1) return f(tib, 'TiB');
  if (tib * 1024 >= 1) return f(tib * 1024, 'GiB');
  return f(tib * 1048576, 'MiB');
};
const TOTAL = CAP * 9;
const usadoRaw = st => U.usos(st).reduce((s, u) => s + u / 100 * CAP, 0);
function maxAvail(st) {
  const c = st.ceph, usos = U.usos(st), w = c.osds.map(o => o.in ? o.reweight : 0), sw = w.reduce((a, b) => a + b, 0) || 1;
  let raw = Infinity;
  c.osds.forEach((o, i) => { if (o.in && w[i] > 0) raw = Math.min(raw, Math.max(0, (c.full * 100 - usos[i]) / 100 * CAP) / (w[i] / sw)); });
  return (raw === Infinity ? 0 : raw) / 3;
}
function status(st) {
  const s = P.saludCeph(st), c = st.ceph, d = U.degradado(st);
  const col = s.estado === 'HEALTH_OK' ? 'verde' : s.estado === 'HEALTH_ERR' ? 'rojo' : 'ambar';
  const out = [L('  cluster:'), L('    id:     ' + c.fsid), L('    health: ' + s.estado, col)];
  s.checks.forEach(ch => out.push(L('            ' + ch.res, ch.sev === 'ERR' ? 'rojo' : 'ambar')));
  out.push(L('')); out.push(L('  services:'));
  const edadMon = Math.min(...s.mons.map(n => st.reloj - Math.max(st.hosts[n].arrancado, st.hosts[n].svcs['ceph-mon@' + n].desde)));
  const fuera = CEPH.filter(n => s.mons.indexOf(n) < 0);
  out.push(L('    mon: 3 daemons, quorum ' + s.mons.join(',') + ' (age ' + U.edad(edadMon) + ')' + (fuera.length ? ', out of quorum: ' + fuera.join(', ') : '')));
  const mgrs = CEPH.filter(n => st.hosts[n].up && st.hosts[n].svcs['ceph-mgr@' + n].estado === 'active');
  if (mgrs.length) out.push(L('    mgr: ' + mgrs[0] + '.' + U.hex(mgrs[0], 6) + '(active, since ' + U.edad(st.reloj - st.hosts[mgrs[0]].svcs['ceph-mgr@' + mgrs[0]].desde) + ')' + (mgrs.length > 1 ? ', standbys: ' + mgrs.slice(1).map(n => n + '.' + U.hex(n, 6)).join(', ') : '')));
  else out.push(L('    mgr: no daemons active', 'rojo'));
  const up = c.osds.filter(o => U.osdUp(st, o)).length, nin = c.osds.filter(o => o.in).length;
  const cambioUp = Math.max(-17280, c.cambioUp, ...c.osds.map(o => o.downDesde != null ? o.downDesde : -17280));
  const remap = d.pgMal + (d.tipo !== 'log' ? d.pgRec : 0);
  out.push(L('    osd: 9 osds: ' + up + ' up (since ' + U.edad(st.reloj - cambioUp) + '), ' + nin + ' in (since ' + U.edad(st.reloj - c.cambioIn) + ')' + (remap ? '; ' + remap + ' remapped pgs' : ''), up < 9 ? 'ambar' : 'out'));
  out.push(L('')); out.push(L('  data:'));
  out.push(L('    pools:   5 pools, ' + PGS + ' pgs'));
  out.push(L('    objects: 812.43k objects, ' + U.bytes(usadoRaw(st) / 3)));
  out.push(L('    usage:   ' + U.bytes(usadoRaw(st)) + ' used, ' + U.bytes(TOTAL - usadoRaw(st)) + ' / 16 TiB avail'));
  const estados = estadosPg(st), cab = [];
  if (d.obj) cab.push(d.obj + '/' + COPIAS + ' objects degraded (' + (d.obj / COPIAS * 100).toFixed(3) + '%)');
  if (d.mal) cab.push(d.mal + '/' + COPIAS + ' objects misplaced (' + (d.mal / COPIAS * 100).toFixed(3) + '%)');
  const filas = cab.map(t => [t, 'ambar']).concat(estados.map(e => [String(e[0]).padEnd(4) + e[1], e[1] === 'active+clean' ? 'out' : 'ambar']));
  filas.forEach((f, i) => out.push(L((i ? '             ' : '    pgs:     ') + f[0], f[1])));
  out.push(L('')); out.push(L('  io:'));
  out.push(L('    client:   42 MiB/s rd, 18 MiB/s wr, 1.21k op/s rd, 640 op/s wr'));
  if (c.rec) {
    out.push(L('    recovery: ' + (c.rec.tipo === 'log' ? '96 MiB/s, 24 objects/s' : '412 MiB/s, 103 objects/s'), 'ambar'));
    const hecho = 1 - c.rec.restante / c.rec.total, n = 28, llenas = Math.round(hecho * n);
    out.push(L('')); out.push(L('  progress:'));
    out.push(L('    ' + (c.rec.tipo === 'reparto' ? 'Rebalancing after osdmap change' : 'Global Recovery Event') + ' (' + (c.rec.total - c.rec.restante) + 'm)'));
    out.push(L('      [' + '='.repeat(llenas) + '.'.repeat(n - llenas) + '] (remaining: ' + c.rec.restante + 'm)', 'ambar'));
  }
  return out;
}
function estadosPg(st) {
  const d = U.degradado(st), out = [];
  if (d.inactivas) out.push([d.inactivas, 'undersized+degraded+peered']);
  const und = Math.max(0, d.und - d.inactivas);
  if (und) out.push([und, 'active+undersized+degraded']);
  if (d.pgRec) {
    if (d.tipo === 'log') out.push([d.pgRec, 'active+recovering+degraded']);
    else { const a = Math.min(d.pgRec, 6); out.push([a, 'active+undersized+degraded+remapped+backfilling']); if (d.pgRec > a) out.push([d.pgRec - a, 'active+undersized+degraded+remapped+backfill_wait']); }
  }
  if (d.pgMal) { const a = Math.min(d.pgMal, 4); out.push([a, 'active+remapped+backfilling']); if (d.pgMal > a) out.push([d.pgMal - a, 'active+remapped+backfill_wait']); }
  const resto = PGS - out.reduce((s, x) => s + x[0], 0);
  out.unshift([Math.max(0, resto), 'active+clean']);
  return out.filter(x => x[0] > 0);
}
function detalle(st) {
  const s = P.saludCeph(st);
  if (s.estado === 'HEALTH_OK') return [L('HEALTH_OK', 'verde')];
  const out = [L(s.estado + ' ' + s.checks.map(c => c.res).join('; '), s.estado === 'HEALTH_ERR' ? 'rojo' : 'ambar')];
  s.checks.forEach(c => { out.push(L('[' + c.sev + '] ' + c.code + ': ' + c.res, c.sev === 'ERR' ? 'rojo' : 'ambar')); c.det.forEach(x => out.push(L('    ' + x))); });
  return out;
}
function arbol(st) {
  const c = st.ceph, fila = (id, cls, w, nombre, estado, rw, pa) => String(id).padStart(2) + '  ' + cls.padStart(5) + '  ' + w.padStart(8) + '  ' + nombre.padEnd(16) + estado.padStart(6) + '  ' + rw.padStart(8) + '  ' + pa.padStart(7);
  const out = [L(fila('ID', 'CLASS', 'WEIGHT', 'TYPE NAME', 'STATUS', 'REWEIGHT', 'PRI-AFF').replace(/^ID/, 'ID'))];
  out.push(L(fila(-1, '', (CAP * 9).toFixed(5), 'root default', '', '', '')));
  CEPH.forEach((n, i) => {
    out.push(L(fila(-3 - i * 2, '', (CAP * 3).toFixed(5), '    host ' + n, '', '', '')));
    c.osds.filter(o => o.host === n).forEach(o => {
      const up = U.osdUp(st, o);
      out.push(L(fila(o.id, 'ssd', CAP.toFixed(5), '        osd.' + o.id, up ? 'up' : 'down', (o.in ? o.reweight : 0).toFixed(5), '1.00000'), up ? (o.in ? 'out' : 'ambar') : 'rojo'));
    });
  });
  return out;
}
function df(st) {
  const c = st.ceph, usos = U.usos(st), w = c.osds.map(o => o.in ? o.reweight : 0), sw = w.reduce((a, b) => a + b, 0) || 1;
  const col = (a) => a.map((x, i) => String(x)[i === 0 ? 'padStart' : 'padStart']([2, 5, 8, 8, 8, 8, 8, 6, 5, 4, 6][i])).join('  ');
  const out = [L(col(['ID', 'CLASS', 'WEIGHT', 'REWEIGHT', 'SIZE', 'RAW USE', 'AVAIL', '%USE', 'VAR', 'PGS', 'STATUS']))];
  const media = usos.reduce((s, u, i) => s + (c.osds[i].in ? u : 0), 0) / (c.osds.filter(o => o.in).length || 1);
  const vars = [];
  c.osds.forEach((o, i) => {
    const u = usos[i], v = media ? u / media : 0; if (o.in) vars.push(v);
    const pgs = o.in ? Math.round(PG_OSD * w[i] * 9 / sw) : 0;
    out.push(L(col([o.id, 'ssd', CAP.toFixed(5), (o.in ? o.reweight : 0).toFixed(5), '1.7 TiB', U.bytes(u / 100 * CAP), U.bytes(CAP * (1 - u / 100)), u.toFixed(2), v.toFixed(2), pgs, U.osdUp(st, o) ? 'up' : 'down']),
      !U.osdUp(st, o) ? 'rojo' : u >= c.nearfull * 100 ? 'ambar' : 'out'));
  });
  const tot = usadoRaw(st), mn = Math.min(...vars), mx = Math.max(...vars);
  const desv = Math.sqrt(usos.filter((u, i) => c.osds[i].in).reduce((s, u) => s + (u - media) * (u - media), 0) / (vars.length || 1));
  out.push(L('                         TOTAL   16 TiB  ' + U.bytes(tot).padStart(8) + '  ' + U.bytes(TOTAL - tot).padStart(8) + '  ' + (tot / TOTAL * 100).toFixed(2)));
  out.push(L('MIN/MAX VAR: ' + mn.toFixed(2) + '/' + mx.toFixed(2) + '  STDDEV: ' + desv.toFixed(2), mx > 1.3 ? 'ambar' : 'out'));
  return out;
}
function cephDf(st) {
  const tot = usadoRaw(st), ma = maxAvail(st), guard = tot / 3;
  const out = [L('--- RAW STORAGE ---'), L('CLASS    SIZE    AVAIL     USED  RAW USED  %RAW USED'),
    L('ssd    16 TiB  ' + U.bytes(TOTAL - tot).padStart(7) + '  ' + U.bytes(tot).padStart(7) + '   ' + U.bytes(tot).padStart(7) + '      ' + (tot / TOTAL * 100).toFixed(2)),
    L('TOTAL  16 TiB  ' + U.bytes(TOTAL - tot).padStart(7) + '  ' + U.bytes(tot).padStart(7) + '   ' + U.bytes(tot).padStart(7) + '      ' + (tot / TOTAL * 100).toFixed(2)),
    L(''), L('--- POOLS ---'), L('POOL      ID  PGS   STORED  OBJECTS     USED  %USED  MAX AVAIL')];
  POOLS.forEach(p => {
    const sto = p.parte ? guard * p.parte : 2.1 / 1048576, obj = p.obj || Math.round(OBJ * p.parte);
    const pct = p.parte ? sto / (sto + ma) * 100 : 0;
    out.push(L(p.n.padEnd(8) + String(p.id).padStart(4) + String(p.pgs).padStart(5) + '  ' + U.bytes(sto).padStart(7) + '  ' + (obj > 1000 ? (obj / 1000).toFixed(1) + 'k' : String(obj)).padStart(7) + '  ' + U.bytes(sto * 3).padStart(7) + '  ' + pct.toFixed(2).padStart(5) + '  ' + U.bytes(ma).padStart(9), ma < 0.6 ? 'ambar' : 'out'));
  });
  return out;
}

// ------------------------------------------------------------------ ceph
const idOsd = x => { const m = /^(?:osd\.)?(\d+)$/.exec(String(x || '')); return m ? +m[1] : null; };
function adminSocket(ctx, a) {
  const st = ctx.st, h = ctx.h, ent = a[0] || '', m = /^mon\.(ceph0\d)$/.exec(ent);
  const d = U.sinRoot(ctx, ['admin_socket: exception getting command descriptions: [Errno 13] Permission denied']); if (d) return d;
  if (!m || m[1] !== h.nombre || h.svcs['ceph-mon@' + h.nombre].estado !== 'active') return [L('admin_socket: exception getting command descriptions: [Errno 2] No such file or directory', 'err'), L(T('(el socket es del demonio local: se usa en su nodo y con el demonio en marcha, p. ej. sudo ceph daemon mon.' + h.nombre + ' mon_status en ' + h.nombre + ')', '(the socket belongs to the local daemon: use it on that node with the daemon running, e.g. sudo ceph daemon mon.' + h.nombre + ' mon_status on ' + h.nombre + ')'), 'dim')];
  if (a[1] !== 'mon_status' && a[1] !== 'quorum_status') return [L(T('(en el simulador: sudo ceph daemon mon.' + h.nombre + ' mon_status)', '(in the simulator: sudo ceph daemon mon.' + h.nombre + ' mon_status)'), 'dim')];
  const vivos = CEPH.filter(n => st.hosts[n].up && st.hosts[n].svcs['ceph-mon@' + n].estado === 'active');
  const hay = vivos.length >= 2, rango = CEPH.indexOf(h.nombre);
  const estado = !hay ? 'probing' : vivos[0] === h.nombre ? 'leader' : 'peon';
  return U.ls(['{', '    "name": "' + h.nombre + '",', '    "rank": ' + rango + ',', '    "state": "' + estado + '",', '    "election_epoch": ' + (42 + st.reloj) + ',',
    '    "quorum": [' + (hay ? vivos.map(n => CEPH.indexOf(n)).join(', ') : '') + '],', '    "quorum_names": [' + (hay ? vivos.map(n => '"' + n + '"').join(', ') : '') + '],',
    '    "outside_quorum": [' + (hay ? '' : '"' + h.nombre + '"') + '],', '    "monmap": {', '        "mons": [']
    .concat(CEPH.map((n, i) => '            { "rank": ' + i + ', "name": "' + n + '", "addr": "' + st.hosts[n].ip + ':6789/0" }' + (i < 2 ? ',' : '')))
    .concat(['        ]', '    }', '}']), !hay ? 'ambar' : 'out');
}
function cephCmd(ctx) {
  const st = ctx.st, c = st.ceph, a = ctx.args.filter(x => x !== '--format=json-pretty' && x !== '-f'), s0 = a[0] || '', s1 = a[1] || '';
  // El socket de administración habla con el demonio local: funciona aunque
  // el clúster no tenga quórum. Es la forma de mirar cuando ceph -s se cuelga.
  if (s0 === 'daemon') return adminSocket(ctx, a.slice(1));
  const saludErr = P.saludCeph(st);
  if (saludErr.sinQuorum) return { lineas: [L('[errno 110] RADOS timed out (error connecting to the cluster)', 'err'), L(T('(sin quórum de monitores: dos de los tres mon están caídos)', '(no monitor quorum: two of the three mons are down)'), 'dim')], minutos: 5 };
  if (s0 === '-s' || s0 === 'status') return status(st);
  if (s0 === '-w' || s0 === '--watch') return [L(T('(ceph -w se queda escuchando; en el simulador usa ceph -s y deja pasar el tiempo con sleep)', '(ceph -w keeps listening; in the simulator use ceph -s and let time pass with sleep)'), 'dim')].concat(status(st));
  if (s0 === 'health') return s1 === 'detail' ? detalle(st) : [L(saludErr.estado === 'HEALTH_OK' ? 'HEALTH_OK' : saludErr.estado + ' ' + saludErr.checks.map(x => x.res).join('; '), saludErr.estado === 'HEALTH_OK' ? 'verde' : 'ambar')];
  if (s0 === 'df') return cephDf(st);
  if (s0 === 'versions') return U.ls(['{', '    "mon": { "ceph version 18.2.4 (e7ad5345525c7aa95470c26863873b581076945d) reef (stable)": 3 },', '    "mgr": { "ceph version 18.2.4 (e7ad5345525c7aa95470c26863873b581076945d) reef (stable)": 3 },', '    "osd": { "ceph version 18.2.4 (e7ad5345525c7aa95470c26863873b581076945d) reef (stable)": ' + c.osds.filter(o => U.osdUp(st, o)).length + ' }', '}']);
  if (s0 === 'mon' && s1 === 'stat') return [L('e3: 3 mons at {' + CEPH.map(n => n + '=[v2:' + st.hosts[n].ip + ':3300/0,v1:' + st.hosts[n].ip + ':6789/0]').join(',') + '} removed_ranks: {} disallowed_leaders: {}, election epoch 42, leader 0 ' + saludErr.mons[0] + ', quorum ' + saludErr.mons.map(n => CEPH.indexOf(n)).join(',') + ' ' + saludErr.mons.join(','))];
  if (s0 === 'pg' && s1 === 'stat') {
    const d = U.degradado(st), e = estadosPg(st);
    return [L(PGS + ' pgs: ' + e.map(x => x[0] + ' ' + x[1]).join(', ') + '; ' + U.bytes(usadoRaw(st) / 3) + ' data, ' + U.bytes(usadoRaw(st)) + ' used, ' + U.bytes(TOTAL - usadoRaw(st)) + ' / 16 TiB avail' + (d.obj ? '; ' + d.obj + '/' + COPIAS + ' objects degraded (' + (d.obj / COPIAS * 100).toFixed(3) + '%)' : ''))];
  }
  // Configuración central: vale para todos los demonios del tipo, estén donde estén.
  if (s0 === 'config') {
    const DEF = { mon_osd_down_out_interval: String(c.downOut * 60), osd_memory_target: '4294967296', mon_osd_nearfull_ratio: String(c.nearfull), osd_op_thread_suicide_timeout: '150', mon_clock_drift_allowed: '0.050000', debug_mon: '1/5', debug_osd: '1/5', debug_ms: '0/0', mon_data_avail_warn: '30', mon_data_avail_crit: '5' };
    const quien = a[2] || '', k = a[3] || '', clave = quien + '/' + k;
    if (s1 === 'dump') {
      const filas = Object.keys(c.config).map(x => x.split('/').concat([c.config[x]]));
      return [L('WHO     MASK  LEVEL     OPTION                                 VALUE    RO')].concat([['global', 'advanced', 'fsid', c.fsid], ['mon', 'advanced', 'auth_allow_insecure_global_id_reclaim', 'false'], ['osd', 'advanced', 'osd_memory_target', '4294967296']].map(f => L(f[0].padEnd(14) + f[1].padEnd(10) + f[2].padEnd(39) + f[3])))
        .concat(filas.map(f => L(f[0].padEnd(14) + (/^debug/.test(f[1]) ? 'basic' : 'advanced').padEnd(10) + f[1].padEnd(39) + f[2], /^debug/.test(f[1]) && /^20/.test(f[2]) ? 'ambar' : 'out')));
    }
    if (s1 === 'get') { const v = c.config[clave] != null ? c.config[clave] : DEF[k]; return v != null ? [L(v)] : [L('Error ENOENT: unrecognized key \'' + k + '\'', 'err')]; }
    if (s1 === 'set') { if (!k || a[4] == null) return [L('Invalid command: missing required parameter value(<string>)', 'err')]; if (DEF[k] != null && DEF[k] === a[4]) delete c.config[clave]; else c.config[clave] = a[4]; st.hechos.cephConfig = (st.hechos.cephConfig || []).concat([{ clave, valor: a[4], min: st.reloj }]); return []; }
    if (s1 === 'rm') { delete c.config[clave]; st.hechos.cephConfig = (st.hechos.cephConfig || []).concat([{ clave, valor: null, min: st.reloj }]); return []; }
    return [L('Invalid command: config ' + s1, 'err')];
  }
  if (s0 === 'crash') {
    if (s1 === 'ls' || s1 === 'ls-new') {
      const lista = c.crashes.filter(x => s1 === 'ls' || !x.archivado);
      if (!lista.length) return [];
      return [L('ID'.padEnd(76) + 'ENTITY  NEW  ')].concat(lista.map(x => L(x.id.padEnd(76) + x.entidad.padEnd(8) + (x.archivado ? '     ' : ' *   '), x.archivado ? 'out' : 'ambar')));
    }
    if (s1 === 'stat') return [L(c.crashes.length + ' crashes recorded'), L(c.crashes.filter(x => !x.archivado).length + ' older than 1 days old:')];
    if (s1 === 'info') {
      const x = c.crashes.find(k => k.id === a[2] || k.id.indexOf(a[2] || '#') === 0);
      if (!x) return [L('Error ENOENT: crash ' + (a[2] || '') + ' not found', 'err')];
      const disco = x.tipo === 'disco';
      return U.ls(['{',
        '    "archived": "' + (x.archivado ? U.iso(st.reloj) + '.000000' : '') + '",',
        '    "assert_condition": "' + (disco ? 'r == 0' : '0 == \\"hit suicide timeout\\"') + '",',
        '    "assert_func": "' + (disco ? 'void BlueStore::_do_read(...)' : 'bool ceph::HeartbeatMap::_check(const ceph::heartbeat_handle_d*, const char*, ceph::time_point)') + '",',
        '    "assert_msg": "' + (disco ? 'bdev-read failed: (5) Input/output error' : 'hit suicide timeout') + '",',
        '    "backtrace": [',
        '        "/lib/x86_64-linux-gnu/libc.so.6(+0x42520) [0x7f2c2d842520]",',
        '        "' + (disco ? '(BlueStore::_do_read(BlueStore::Collection*, ...)+0x1c4f) [0x55d1e2c1a0af]' : '(ceph::HeartbeatMap::_check(ceph::heartbeat_handle_d const*, char const*, ...)+0x2f1) [0x55d1e2a0c3b1]') + '",',
        '        "(OSD::ShardedOpWQ::_process(unsigned int, ceph::heartbeat_handle_d*)+0x1283) [0x55d1e2718f93]"',
        '    ],',
        '    "ceph_version": "18.2.4",',
        '    "crash_id": "' + x.id + '",',
        '    "entity_name": "' + x.entidad + '",',
        '    "os_name": "Ubuntu",',
        '    "process_name": "ceph-osd",',
        '    "timestamp": "' + x.cuando + '",',
        '    "utsname_hostname": "' + x.host + '"',
        '}']);
    }
    if (s1 === 'archive-all') { c.crashes.forEach(x => { x.archivado = true; }); return []; }
    if (s1 === 'archive') { const x = c.crashes.find(k => k.id === a[2]); if (!x) return [L('Error ENOENT: crash ' + (a[2] || '') + ' not found', 'err')]; x.archivado = true; return []; }
    return [L('Invalid command: crash ' + s1, 'err')];
  }
  if (s0 === 'balancer') {
    if (s1 === 'status') return U.ls(['{', '    "active": ' + c.balancer.activo + ',', '    "last_optimize_duration": "' + (c.balancer.activo ? '0:00:00.000812' : '') + '",', '    "last_optimize_started": "' + (c.balancer.activo ? U.fechaCorta(st.reloj - 1) : '') + '",', '    "mode": "' + c.balancer.modo + '",', '    "no_optimization_needed": ' + (desbalance(c) <= 3) + ',', '    "optimize_result": "' + (c.balancer.activo ? (desbalance(c) <= 3 ? 'Unable to find further optimization, or pool(s) pg_num is decreasing, or distribution is already perfect' : 'Optimization plan created successfully') : '') + '",', '    "plans": []', '}'], c.balancer.activo ? 'out' : 'ambar');
    if (s1 === 'on') { c.balancer.activo = true; st.hechos.balancer = true; return []; }
    if (s1 === 'off') { c.balancer.activo = false; return []; }
    if (s1 === 'mode') { c.balancer.modo = a[2] || 'upmap'; return []; }
    return [L('Invalid command: balancer ' + s1, 'err')];
  }
  if (s0 !== 'osd') return [L('no valid command found; 10 closest matches:', 'err'), L('Error EINVAL: invalid command', 'err'), L(T('(prueba: ceph -s · ceph health detail · ceph osd tree · ceph osd df · ceph df · ceph crash ls · ceph balancer status)', '(try: ceph -s · ceph health detail · ceph osd tree · ceph osd df · ceph df · ceph crash ls · ceph balancer status)'), 'dim')];

  // ceph osd ...
  if (s1 === 'tree') return arbol(st);
  if (s1 === 'df') return df(st);
  if (s1 === 'stat') return [L('9 osds: ' + c.osds.filter(o => U.osdUp(st, o)).length + ' up (since 3m), ' + c.osds.filter(o => o.in).length + ' in (since 3m); epoch: e' + (4312 + c.movimientos))];
  if (s1 === 'dump') {
    const flags = ['sortbitwise', 'recovery_deletes', 'purged_snapdirs', 'pglog_hardlimit'].concat(Object.keys(c.flags).filter(k => c.flags[k]));
    return U.ls(['epoch ' + (4312 + c.movimientos), 'fsid ' + c.fsid, 'created 2024-03-11T10:02:44.118211+0000', 'flags ' + flags.join(','), 'crush_version 42', 'full_ratio ' + c.full, 'backfillfull_ratio ' + c.backfillfull, 'nearfull_ratio ' + c.nearfull, 'require_min_compat_client luminous', 'require_osd_release reef', 'stretch_mode_enabled false']
      .concat(POOLS.map(p => "pool " + p.id + " '" + p.n + "' replicated size 3 min_size 2 crush_rule 0 object_hash rjenkins pg_num " + p.pgs + ' pgp_num ' + p.pgs + ' autoscale_mode on application ' + (p.n === '.mgr' ? 'mgr' : 'rbd')))
      .concat(['max_osd 9']).concat(c.osds.map(o => 'osd.' + o.id + ' ' + (U.osdUp(st, o) ? 'up  ' : 'down') + ' ' + (o.in ? 'in ' : 'out') + ' weight ' + (o.in ? o.reweight : 0) + ' up_from 4102 up_thru 4310 down_at 4101 last_clean_interval [3,4100) [v2:' + st.hosts[o.host].ip + ':68' + (o.id + 10) + '/' + U.pid(o.id) + '] ' + (o.in && U.osdUp(st, o) ? 'exists,up' : 'exists'))));
  }
  if (s1 === 'metadata') {
    const id = idOsd(a[2]); if (id == null || !c.osds[id]) return [L('Error ENOENT: osd.' + (a[2] || '') + ' does not exist', 'err')];
    const o = c.osds[id];
    return U.ls(['{', '    "id": ' + id + ',', '    "arch": "x86_64",', '    "bluestore_bdev_dev_node": "/dev/dm-' + (id % 3 + 1) + '",', '    "bluestore_bdev_type": "ssd",', '    "ceph_version": "ceph version 18.2.4 (e7ad5345525c7aa95470c26863873b581076945d) reef (stable)",', '    "default_device_class": "ssd",', '    "device_ids": "' + o.dev.replace('/dev/', '') + '=SAMSUNG_MZ7L31T9HBLT-00A07_S6ESNE0T' + (400311 + id * 17) + '",', '    "devices": "' + o.dev.replace('/dev/', '') + '",', '    "hostname": "' + o.host + '",', '    "osd_objectstore": "bluestore",', '    "rotational": "0"', '}']);
  }
  if (s1 === 'set' || s1 === 'unset') {
    const f = a[2];
    if (['noout', 'norebalance', 'nobackfill', 'norecover', 'noscrub', 'nodeep-scrub', 'noin', 'nodown'].indexOf(f) < 0) return [L('Error EINVAL: invalid command', 'err')];
    if (s1 === 'set') { c.flags[f] = true; clog(st, 'WRN', 'Health check failed: ' + f + ' flag(s) set (OSDMAP_FLAGS)'); }
    else { delete c.flags[f]; clog(st, 'INF', 'Health check cleared: OSDMAP_FLAGS (was: ' + f + ' flag(s) set)'); }
    return [L(f + ' is ' + s1)];
  }
  if (s1 === 'out' || s1 === 'in') {
    const ids = a.slice(2).map(idOsd);
    if (!ids.length || ids.some(x => x == null || !c.osds[x])) return [L('Error EINVAL: invalid osd id', 'err')];
    return ids.map(id => {
      const o = c.osds[id], up = U.osdUp(st, o);
      if (s1 === 'out') {
        if (!o.in) return L('osd.' + id + ' is already out. ');
        clog(st, 'INF', 'Client admin marked osd.' + id + ' out, while it was still marked ' + (up ? 'up' : 'down'));
        P.cephCambiar(st, () => { o.in = false; o.autoOut = false; }, up ? { tipo: 'backfill', min: 8, malObj: OBJ_OSD, malPgs: PG_OSD } : { tipo: 'backfill', min: 8, degObj: OBJ_OSD, degPgs: PG_OSD });
        return L('marked out osd.' + id + '. ');
      }
      if (o.in) return L('osd.' + id + ' is already in. ');
      if (up) P.cephCambiar(st, () => { o.in = true; o.autoOut = false; }, { tipo: 'backfill', min: 6, malObj: OBJ_OSD, malPgs: PG_OSD });
      else { o.in = true; o.autoOut = false; c.cambioIn = st.reloj; }
      return L('marked in osd.' + id + '. ');
    });
  }
  if (s1 === 'reweight') {
    const id = idOsd(a[2]), w = parseFloat(a[3]);
    if (id == null || !c.osds[id] || isNaN(w) || w < 0 || w > 1) return [L('Error EINVAL: invalid command', 'err')];
    const o = c.osds[id];
    if (Math.abs(o.reweight - w) > 1e-6) { P.cephCambiar(st, () => { o.reweight = w; }, { tipo: 'reparto', min: 6, malObj: Math.round(OBJ_OSD * Math.abs(1 - w)), malPgs: Math.max(4, Math.round(PG_OSD * Math.abs(1 - w))) }); st.hechos.reweight = true; }
    return [L('reweighted osd.' + id + ' to ' + w + ' (' + Math.round(w * 0x10000).toString(16) + ')')];
  }
  if (s1 === 'reweight-by-utilization' || s1 === 'test-reweight-by-utilization') {
    const oload = parseInt(a[2], 10) || 120, usos = U.usos(st), inn = c.osds.filter(o => o.in), media = inn.reduce((s, o) => s + usos[o.id], 0) / inn.length;
    const sobre = inn.filter(o => usos[o.id] > media * oload / 100);
    if (!sobre.length) return [L('no change')];
    const out = [L('moved ' + (12 * sobre.length) + ' / 1443 (' + (12 * sobre.length / 14.43).toFixed(5) + '%)'), L('avg 160.333'), L('stddev 9.12 -> 7.35 (expected baseline 12.1)'), L(''), L('oload ' + oload), L('max_change 0.05'), L('max_change_osds 4'), L('average_utilization ' + (media / 100).toFixed(4)), L('overload_utilization ' + (media * oload / 10000).toFixed(4))];
    sobre.forEach(o => { const nw = Math.max(0, +(o.reweight - 0.05).toFixed(4)); out.push(L('osd.' + o.id + ' weight ' + o.reweight.toFixed(4) + ' -> ' + nw.toFixed(4))); });
    if (s1 === 'reweight-by-utilization') { P.cephCambiar(st, () => sobre.forEach(o => { o.reweight = +(o.reweight - 0.05).toFixed(4); }), { tipo: 'reparto', min: 6, malObj: 12000 * sobre.length, malPgs: 12 * sobre.length }); st.hechos.reweight = true; }
    else st.hechos.pruebaReweight = true;
    return out;
  }
  if (s1 === 'set-nearfull-ratio' || s1 === 'set-full-ratio' || s1 === 'set-backfillfull-ratio') {
    const r = parseFloat(a[2]); if (isNaN(r) || r <= 0 || r > 1) return [L('Error EINVAL: invalid command', 'err')];
    if (s1 === 'set-nearfull-ratio') { if (r > c.nearfull) st.hechos.umbralSubido = true; c.nearfull = r; }
    else if (s1 === 'set-full-ratio') { if (r > c.full) st.hechos.umbralSubido = true; c.full = r; }
    else c.backfillfull = r;
    return [];
  }
  if (s1 === 'purge' || s1 === 'destroy' || s1 === 'rm') return [L(T('(la retirada definitiva del OSD la hace hardware al sustituir el disco; no forma parte de ningún escenario)', '(permanently removing the OSD is done by the hardware team when they replace the disk; it is not part of any scenario)'), 'dim')];
  return [L('Invalid command: osd ' + s1, 'err'), L(T('(prueba: ceph osd tree · ceph osd df · ceph osd out/in N · ceph osd set/unset noout · ceph osd metadata N)', '(try: ceph osd tree · ceph osd df · ceph osd out/in N · ceph osd set/unset noout · ceph osd metadata N)'), 'dim')];
}
U.cmd('ceph', { ayuda: T('clúster Ceph: -s, health detail, osd tree, osd df, df...', 'Ceph cluster: -s, health detail, osd tree, osd df, df...'), grupo: 'Ceph', donde: ['bastion', 'ceph'], fuera: T('(el cliente de Ceph está en el bastión y en los nodos ceph0X)', '(the Ceph client is on the bastion and the ceph0X nodes)'), fn: cephCmd,
  completar: (st, ses, pal) => {
    const [a, b] = pal;
    if (!a) return ['-s', 'status', 'health', 'osd', 'df', 'crash', 'balancer', 'pg', 'mon', 'config', 'versions', 'daemon'];
    if (a === 'daemon' && pal.length === 1) return ['mon.' + ses.host];
    if (a === 'daemon') return ['mon_status', 'quorum_status'];
    if (a === 'osd' && pal.length === 1) return ['tree', 'df', 'stat', 'dump', 'metadata', 'out', 'in', 'set', 'unset', 'reweight', 'reweight-by-utilization', 'test-reweight-by-utilization', 'set-nearfull-ratio'];
    if (a === 'osd' && (b === 'set' || b === 'unset')) return ['noout', 'norebalance', 'nobackfill', 'noscrub', 'nodeep-scrub'];
    if (a === 'crash' && pal.length === 1) return ['ls', 'ls-new', 'info', 'archive', 'archive-all', 'stat'];
    if (a === 'crash' && (b === 'info' || b === 'archive')) return st.ceph.crashes.map(x => x.id);
    if (a === 'balancer' && pal.length === 1) return ['status', 'on', 'off', 'mode'];
    if (a === 'health' && pal.length === 1) return ['detail'];
    if (a === 'pg' || a === 'mon') return ['stat'];
    if (a === 'config' && pal.length === 1) return ['get', 'set', 'rm', 'dump'];
    if (a === 'config' && pal.length === 2) return ['mon', 'osd'];
    if (a === 'config' && pal.length === 3) return ['debug_mon', 'mon_osd_down_out_interval', 'osd_memory_target', 'mon_clock_drift_allowed'];
    return [];
  } });

// ------------------------------------------------------------------ discos físicos
U.cmd('ceph-volume', { ayuda: T('qué disco físico hay detrás de cada OSD', 'which physical disk backs each OSD'), grupo: 'Ceph', donde: ['ceph'], fn: ctx => {
  const d = U.sinRoot(ctx, ['--> RuntimeError: Unable to proceed with non-existing device: must be run as root']); if (d) return d;
  if (ctx.args[0] !== 'lvm' || ctx.args[1] !== 'list') return [L('usage: ceph-volume lvm list', 'err')];
  const out = [];
  ctx.st.ceph.osds.filter(o => o.host === ctx.h.nombre).forEach(o => {
    const vg = 'ceph-' + U.uuid('vg' + o.id), lv = 'osd-block-' + U.uuid('lv' + o.id);
    out.push(L('')); out.push(L('====== osd.' + o.id + ' =======', 'verde')); out.push(L(''));
    out.push(L('  [block]       /dev/' + vg + '/' + lv)); out.push(L(''));
    out.push(L('      block device              /dev/' + vg + '/' + lv));
    out.push(L('      cluster fsid              ' + ctx.st.ceph.fsid));
    out.push(L('      crush device class        ssd'));
    out.push(L('      encrypted                 0'));
    out.push(L('      osd fsid                  ' + U.uuid('osdfsid' + o.id)));
    out.push(L('      osd id                    ' + o.id));
    out.push(L('      type                      block'));
    out.push(L('      devices                   ' + o.dev, 'ambar'));
  });
  return out;
} });
function discosHost(st, h) { return [{ dev: '/dev/sda', osd: null }].concat(st.ceph.osds.filter(o => o.host === h.nombre).map(o => ({ dev: o.dev, osd: o }))); }
U.cmd('lsblk', { ayuda: T('discos y particiones', 'disks and partitions'), donde: ['ceph', 'ctl', 'cmp', 'mon', 'bastion'], fn: ctx => {
  const h = ctx.h, out = [L('NAME                                              MAJ:MIN RM   SIZE RO TYPE MOUNTPOINTS'), L('sda                                                 8:0    0 447.1G  0 disk'), L('├─sda1                                              8:1    0   1.1G  0 part /boot/efi'), L('└─sda2                                              8:2    0   446G  0 part'), L('  └─vg0-root                                      253:0    0    48G  0 lvm  /')];
  if (h.rol === 'ceph') discosHost(ctx.st, h).slice(1).forEach((d, i) => {
    out.push(L(d.dev.replace('/dev/', '').padEnd(52) + '8:' + (16 * (i + 1)) + '   0   1.7T  0 disk'));
    out.push(L('└─ceph--' + U.hex('vg' + d.osd.id, 8) + '--osd--block--' + U.hex('lv' + d.osd.id, 8) + '    253:' + (i + 1) + '    0   1.7T  0 lvm'));
  });
  return out;
} });
U.cmd('smartctl', { ayuda: T('salud física de un disco (smartctl -a /dev/sdb)', 'physical health of a disk (smartctl -a /dev/sdb)'), grupo: 'Ceph', donde: ['ceph'], fn: ctx => {
  const dev = ctx.args.filter(x => x[0] !== '-').pop();
  if (!dev) return [L('smartctl 7.2 2020-12-30 r5155 [x86_64-linux-' + ctx.h.kernel + '] (local build)'), L('ERROR: smartctl requires a device name as the final command-line argument.', 'err')];
  const d = U.sinRoot(ctx, ['smartctl 7.2 2020-12-30 r5155 [x86_64-linux-' + ctx.h.kernel + '] (local build)', 'Smartctl open device: ' + dev + ' failed: Permission denied']); if (d) return d;
  const disco = discosHost(ctx.st, ctx.h).find(x => x.dev === dev);
  if (!disco) return [L('Smartctl open device: ' + dev + ' failed: No such device', 'err')];
  const malo = disco.osd && disco.osd.disco !== 'ok';
  const out = [L('smartctl 7.2 2020-12-30 r5155 [x86_64-linux-' + ctx.h.kernel + '] (local build)'), L('Copyright (C) 2002-20, Bruce Allen, Christian Franke, www.smartmontools.org'), L(''), L('=== START OF INFORMATION SECTION ==='),
    L('Device Model:     ' + (disco.osd ? 'SAMSUNG MZ7L31T9HBLT-00A07' : 'MICRON 5300 PRO 480GB')), L('Serial Number:    ' + (disco.osd ? 'S6ESNE0T' + (400311 + disco.osd.id * 17) : 'MSA2210' + U.hex(ctx.h.nombre, 5).toUpperCase())), L('User Capacity:    ' + (disco.osd ? '1,920,383,410,176 bytes [1.92 TB]' : '480,103,981,056 bytes [480 GB]')), L('Rotation Rate:    Solid State Device'), L(''),
    L('=== START OF READ SMART DATA SECTION ==='), L('SMART overall-health self-assessment test result: ' + (malo ? 'FAILED!' : 'PASSED'), malo ? 'rojo' : 'verde')];
  if (malo) { out.push(L('Drive failure expected in less than 24 hours. SAVE ALL DATA.', 'rojo')); out.push(L('Failed Attributes:', 'rojo')); }
  out.push(L('')); out.push(L('ID# ATTRIBUTE_NAME          FLAG     VALUE WORST THRESH TYPE      UPDATED  WHEN_FAILED RAW_VALUE'));
  out.push(L('  5 Reallocated_Sector_Ct   0x0033   ' + (malo ? '001   001   010    Pre-fail  Always   FAILING_NOW 3120' : '100   100   010    Pre-fail  Always       -       0'), malo ? 'rojo' : 'out'));
  out.push(L('  9 Power_On_Hours          0x0032   094   094   000    Old_age   Always       -       26311'));
  out.push(L('187 Reported_Uncorrect      0x0032   ' + (malo ? '001   001   000    Old_age   Always       -       4471' : '100   100   000    Old_age   Always       -       0'), malo ? 'rojo' : 'out'));
  out.push(L('197 Current_Pending_Sector  0x0012   ' + (malo ? '001   001   000    Old_age   Always       -       812' : '100   100   000    Old_age   Always       -       0'), malo ? 'rojo' : 'out'));
  return out;
}, completar: (st, ses) => discosHost(st, st.hosts[ses.host]).map(x => x.dev).concat(['-a', '-H']) });

})(window.PUESTO = window.PUESTO || {});
