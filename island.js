export const LIMIT = { x: 180, z: 144, soft: .85 };
export const WEATHER = { sunny: { speed: 1.8, label: '晴天' }, windy: { speed: 12, label: '刮大風' } };
export const TOOLS = {
  foot: { name: '徒步', sand: [6, 10], water: [5.4, 9], wind: .25, currentWith: 1, currentAgainst: 1, drift: .12, step: 0, jump: 7.2, verb: '跑動' },
  surfboard: { name: '衝浪板', sand: [7.2, 11.2], water: [8.2, 13.2], wind: .22, currentWith: 1.16, currentAgainst: .6, drift: .07, step: .38, jump: 7.6, verb: '滑行' },
  jetski: { name: '水上摩托車', sand: [8, 12], water: [12, 18], wind: .14, currentWith: .35, currentAgainst: .35, drift: .035, step: .76, jump: 7.2, verb: '推進' },
  exoskeleton: { name: '外骨骼助行器', sand: [9, 14], water: [7.6, 11.6], wind: .18, currentWith: .65, currentAgainst: .65, drift: .055, step: 1.05, jump: 8.4, verb: '助行' }
};
export const ZONES = {
  surf: { x: 54, z: 55, label: '南灣浪線', yaw: -.95 },
  beach: { x: -9, z: 25, label: '南岸沙灘', yaw: .15 },
  lagoon: { x: 9, z: -3, label: '透光潟湖', yaw: -.55 },
  obstacles: { x: 21, z: 20, label: '漂流木障礙區', yaw: -.45 },
  current: { x: 59, z: -12, label: '東側急流水道', yaw: .65 }
};
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const smooth = (v) => { const t = clamp(v, 0, 1); return t * t * (3 - 2 * t); };
export function seeded(seed = 21) { let v = seed; return () => { v = (v * 1664525 + 1013904223) >>> 0; return v / 4294967296; }; }
export function coastRadius(x, z) {
  const xx = (x + 4) / 49, zz = (z + 1) / 36, a = Math.atan2(zz, xx);
  return Math.hypot(xx, zz) * (1 + .045 * Math.sin(5 * a) + .025 * Math.cos(3 * a));
}
export function terrainHeight(x, z) {
  const q = coastRadius(x, z);
  let h = clamp((1 - q) * 10, -14, 1.25);
  h += 1.65 * Math.exp(-((x + 23) ** 2 / 220 + (z + 7) ** 2 / 290)) * smooth((1 - q) * 5);
  h += (.10 * Math.sin(x * .21) * Math.cos(z * .28) + .045 * Math.sin(z * .7 + x * .5)) * smooth((1 - q) * 4);
  const lagoon = Math.hypot((x - 10) / 17, (z + 3) / 12);
  h = Math.min(h, (lagoon - 1) * 7);
  if (x > 12) h = Math.min(h, (Math.abs(z + 3) - 5.5) * .58 + Math.max(0, 15 - x) * .18);
  return h;
}
export const isWater = (x, z) => terrainHeight(x, z) < .12;
export const floorAt = (x, z) => Math.max(.13, terrainHeight(x, z));
// The renderer, board support, spray and camera all sample this same swell.
export function swellAt(x,z,time=0,weather='sunny') {
  const exposure=smooth((coastRadius(x,z)-.93)*1.8),amplitude=(2.5+(weather==='windy'?1.0:0))*exposure;
  const phase=x*.10-z*.16-time*1.35,secondary=-x*.17+z*.075-time*.79;
  const harmonic=Math.cos(phase)+.48*Math.cos(2*phase+.5);
  return {height:.075+amplitude*(Math.sin(phase)+.24*Math.sin(2*phase+.5))+.08*exposure*Math.sin(secondary),
    dx:amplitude*.10*harmonic-.0136*exposure*Math.cos(secondary),dz:-amplitude*.16*harmonic+.006*exposure*Math.cos(secondary),
    face:Math.max(0,Math.cos(phase)),phase,exposure};
}
export const SWELL_GLSL = `
float seaExposure(vec2 p){vec2 q=vec2((p.x+4.)/49.,(p.y+1.)/36.);float a=atan(q.y,q.x);float r=length(q)*(1.+.045*sin(5.*a)+.025*cos(3.*a));return smoothstep(0.,1.,(r-.93)*1.8);}
float seaHeight(vec2 p,float t,float storm){float e=seaExposure(p);float phase=p.x*.10-p.y*.16-t*1.35;return .075+(2.5+1.*storm)*e*(sin(phase)+.24*sin(2.*phase+.5))+.08*e*sin(-p.x*.17+p.y*.075-t*.79);}
`;
export function ridingHeight(x,z,env) {
  return isWater(x,z)?Math.max(terrainHeight(x,z),swellAt(x,z,env.time,env.weather).height+.055):floorAt(x,z);
}
export function currentAt(x, z, reversed = false) {
  const lagoon = x < 30 && Math.hypot((x - 10) / 19, (z + 3) / 15) < 1.35;
  let dx, dz, strength, name;
  if (lagoon) {
    dx = .92; dz = -.25 + .16 * Math.sin(x * .1); strength = 1.6; name = '潟湖緩流';
  } else if (x > 44) {
    dx = .13 + .12 * Math.sin(z * .06); dz = -.98; strength = 3.8; name = '東岸急流';
  } else if (z < -33) {
    dx = -.96; dz = .16; strength = 2.8; name = '北岸橫流';
  } else {
    dx = .86; dz = .28 * Math.sin(x * .055); strength = 2.3; name = '環島水流';
  }
  const n = Math.hypot(dx, dz), sign = reversed ? -1 : 1;
  return { x: dx / n * sign, z: dz / n * sign, strength, name };
}
export function windAt(weather, angle, time = 0) {
  const gust = weather === 'windy' ? 1 + .09 * Math.sin(time * .72) + .035 * Math.sin(time * 1.9) : 1;
  return { x: Math.sin(angle), z: -Math.cos(angle), strength: WEATHER[weather].speed * gust };
}
export function boundaryWeight(x, z) {
  const q = Math.hypot(x / LIMIT.x, z / LIMIT.z);
  return { q, factor: smooth((1 - q) / (1 - LIMIT.soft)) };
}
export function softenOutward(vx, vz, x, z) {
  const { q, factor } = boundaryWeight(x, z);
  if (q <= LIMIT.soft) return { x: vx, z: vz };
  let nx = x / (LIMIT.x * LIMIT.x), nz = z / (LIMIT.z * LIMIT.z);
  const n = Math.hypot(nx, nz); nx /= n; nz /= n;
  const outward = Math.max(0, vx * nx + vz * nz);
  return { x: vx - nx * outward * (1 - factor), z: vz - nz * outward * (1 - factor) };
}
export const OBSTACLES = [];
function add(o) { o.base = floorAt(o.x, o.z); o.top = o.base + o.h; OBSTACLES.push(o); }
const rand = seeded(77);
for (const [x, z, r, h] of [
  [30, 19, 2.1, 2.3], [35, 16, 1.6, 1.9], [32, 11, 2.2, 2.6], [36, 23, 1.3, 1.3],
  [-38, -19, 2, 2.7], [-42, -14, 1.6, 1.9], [-36, -24, 1.2, 1.6], [-13, -31, 1.7, 2],
  [44, -16, 2.6, 2.8], [48, -21, 1.5, 2.0], [39, -24, 1.8, 2.7], [45, -29, 1.3, 1.6],
  [-40, 16, 1.7, 2.1], [-36, 21, 1.3, 1.5], [27, 26, 1.0, .9], [53, -7, 1.6, 1.8]
]) add({ type: 'rock', x, z, r, h, yaw: rand() * 6.28 });
for (const [x, z, yaw, width, depth, h] of [
  [20, 14, .2, 6, .60, .55], [24, 9, -.27, 5, .65, .68], [15, 19, -.15, 5, .65, .55],
  [-5, -23, .2, 5.5, .70, .58], [3, -24, -.25, 5, .70, .65], [-24, 17, .6, 4.8, .7, .5]
]) add({ type: 'log', x, z, yaw, width, depth, h });
for (const [x, z, h] of [[25, 20, .75], [26.5, 19, 1.45], [28, 20.5, .7]]) add({ type: 'crate', x, z, yaw: .13, width: 1.35, depth: 1.35, h });
export const PALMS = [
  [-19, 17], [-25, 14], [-30, 8], [-26, 1], [-34, -5], [-30, -13], [-21, -17], [-14, -19],
  [-3, -19], [7, -22], [18, -20], [-9, 13], [-14, 4], [-21, -3], [-35, 12], [-24, 24],
  [5, 21], [2, 28], [-10, -8], [-7, -16], [-32, -20], [26, -14]
].map(([x, z], i) => ({ x, z, h: 5 + rand() * 3.4, lean: .2 + rand() * .6, angle: rand() * Math.PI * 2, seed: i }));
for (const palm of PALMS) add({ type: 'palm', x: palm.x, z: palm.z, r: .30, h: palm.h });
export function terrainClass(x, z) {
  if (isWater(x, z)) return 'water';
  return OBSTACLES.some(o => o.type !== 'palm' && Math.hypot(x-o.x, z-o.z) < (o.r || Math.max(o.width,o.depth)/2)+3.3) ? 'obstacle' : 'sand';
}
export function recommendedTool(terrain, x, z) {
  return terrain === 'water' ? (currentAt(x,z).strength >= 2.8 ? 'jetski' : 'surfboard') : 'exoskeleton';
}
export function makeTerrainTracker(initial = 'sand') { return { stable: initial, candidate: initial, dwell: 0, lastPrompt: -100 }; }
export function advanceTerrainTracker(tracker, terrain, dt, time, enabled = true, canPrompt = true) {
  if (tracker.candidate !== terrain) { tracker.candidate = terrain; tracker.dwell = 0; }
  else tracker.dwell += dt;
  if (tracker.dwell < .7 || tracker.stable === terrain) return null;
  tracker.stable = terrain;
  if (!enabled || !canPrompt || time - tracker.lastPrompt < 12) return null;
  tracker.lastPrompt = time;
  return terrain;
}
export function overlap(x, z, radius, o) {
  if (o.r) {
    const dx = x - o.x, dz = z - o.z, dist = Math.hypot(dx, dz), penetration = o.r + radius - dist;
    if (penetration <= 0) return null;
    return dist > 1e-7 ? { nx: dx / dist, nz: dz / dist, depth: penetration } : { nx: 1, nz: 0, depth: o.r + radius };
  }
  const co = Math.cos(o.yaw), si = Math.sin(o.yaw), dx = x - o.x, dz = z - o.z;
  const lx = dx * co - dz * si, lz = dx * si + dz * co, hx = o.width / 2, hz = o.depth / 2;
  const cx = clamp(lx, -hx, hx), cz = clamp(lz, -hz, hz), ax = lx - cx, az = lz - cz, dist = Math.hypot(ax, az);
  if (dist >= radius) return null;
  let nx, nz, depth;
  if (dist > 1e-7) { nx = ax / dist; nz = az / dist; depth = radius - dist; }
  else if (hx - Math.abs(lx) < hz - Math.abs(lz)) { nx = lx >= 0 ? 1 : -1; nz = 0; depth = hx - Math.abs(lx) + radius; }
  else { nx = 0; nz = lz >= 0 ? 1 : -1; depth = hz - Math.abs(lz) + radius; }
  return { nx: nx * co + nz * si, nz: -nx * si + nz * co, depth };
}
export function makePlayer(zone = 'beach') {
  const p = ZONES[zone];
  return { x: p.x, z: p.z, y: floorAt(p.x, p.z), vx: 0, vz: 0, vy: 0, grounded: true, facing: Math.PI, speed: 0, base: 6, windEffect: 0, currentEffect: 0, water: isWater(p.x, p.z), collision: false, tool: 'foot', toolBonus: 0 };
}
export function stepPlayer(p, input, env, dt) {
  const water = isWater(p.x, p.z), m = Math.hypot(input.x, input.z), moving = m > .025;
  let ix = moving ? input.x / Math.max(1, m) : 0, iz = moving ? input.z / Math.max(1, m) : 0;
  const n = Math.hypot(ix, iz), ux = n > 0 ? ix / n : 0, uz = n > 0 ? iz / n : 0;
  const w = windAt(env.weather, env.windAngle, env.time);
  const flow = currentAt(p.x, p.z, env.reversed);
  const tool = TOOLS[p.tool] || TOOLS.foot, surface = water ? 'water' : 'sand', sprintIndex = input.sprint ? 1 : 0, wasGrounded = p.grounded;
  const base = tool[surface][sprintIndex];
  const windEffect = moving ? (ux * w.x + uz * w.z) * w.strength * tool.wind : 0;
  const flowDot = ux * flow.x + uz * flow.z;
  const currentEffect = water && p.grounded && moving ? flowDot * flow.strength * .9 * (flowDot >= 0 ? tool.currentWith : tool.currentAgainst) : 0;
  const pace = Math.max(1.8, base + windEffect + currentEffect);
  let tx = ix * pace, tz = iz * pace;
  if (water && moving && p.grounded) {
    const along = flow.x * ux + flow.z * uz;
    tx += (flow.x - along * ux) * flow.strength * tool.drift;
    tz += (flow.z - along * uz) * flow.strength * tool.drift;
  }
  const target = softenOutward(tx, tz, p.x, p.z), blend = 1 - Math.exp(-(moving ? 9 : 11) * dt);
  p.vx += (target.x - p.vx) * blend; p.vz += (target.z - p.vz) * blend;
  if (!moving && Math.hypot(p.vx, p.vz) < .025) { p.vx = 0; p.vz = 0; }
  if (input.jump && p.grounded) { p.vy = tool.jump; p.grounded = false; }
  const oldY = p.y;
  p.vy -= 18 * dt; p.y += p.vy * dt;
  p.x += p.vx * dt; p.z += p.vz * dt;
  p.collision = false;
  let support = ridingHeight(p.x,p.z,env);
  for (let pass = 0; pass < 2; pass++) for (const o of OBSTACLES) {
    const hit = overlap(p.x, p.z, .34, o);
    if (!hit || p.y + 1.85 <= o.base) continue;
    if (o.type !== 'palm' && p.vy <= 0 && oldY >= o.top - .12) { support = Math.max(support, o.top); continue; }
    if (o.type !== 'palm' && wasGrounded && moving && p.vy <= 0 && o.top - oldY <= tool.step && o.h <= tool.step && oldY >= o.base - .12) { support = Math.max(support, o.top); continue; }
    if (p.y >= o.top - .04) continue;
    p.x += hit.nx * (hit.depth + .001); p.z += hit.nz * (hit.depth + .001);
    const into = Math.min(0, p.vx * hit.nx + p.vz * hit.nz);
    p.vx -= into * hit.nx; p.vz -= into * hit.nz; p.collision = true;
  }
  support = Math.max(support,ridingHeight(p.x,p.z,env));
  if(wasGrounded&&!input.jump&&isWater(p.x,p.z)&&Math.abs(p.y-support)<.28){p.y=support;p.vy=0;}
  if (p.y <= support && p.vy <= 0) { p.y = support; p.vy = 0; p.grounded = true; }
  else p.grounded = false;
  const q = Math.hypot(p.x / LIMIT.x, p.z / LIMIT.z);
  if (q > .9998) { p.x *= .9998 / q; p.z *= .9998 / q; }
  p.speed = Math.hypot(p.vx, p.vz); p.base = base; p.toolBonus = base - TOOLS.foot[surface][sprintIndex]; p.windEffect = windEffect; p.currentEffect = currentEffect; p.water = water;
  if (moving) p.facing = Math.atan2(-ux, -uz);
  return p;
}
// Surf controls turn the board through an arc. Releasing the controls preserves
// glide; W pumps the face, S checks speed, Shift spends recovered flow energy.
export function stepSurfer(p,input,env,dt) {
  p.energy??=1;p.carve??=0;p.rideTime??=0;p.airTime??=0;p.landing??=0;
  const steer=clamp(input.steer||0,-1,1),pump=clamp(input.pump||0,0,1),brake=clamp(input.brake||0,0,1);
  p.carve+=(steer-p.carve)*(1-Math.exp(-dt*(steer?12:17)));
  p.facing-=p.carve*(.90+Math.min(p.speed,22)*.04)*dt*(p.grounded?1:.55);
  const forward={x:-Math.sin(p.facing),z:-Math.cos(p.facing)},wave=swellAt(p.x,p.z,env.time,env.weather);
  const across=1-Math.abs(forward.x*.53-forward.z*.848),trim=.3+.7*across;
  p.waveDrive=wave.face*trim;p.rideTime+=dt;p.pump=pump;
  const boost=!!input.sprint&&p.energy>.03&&brake<.1;
  p.energy=clamp(p.energy+dt*(boost?-.27:.1+p.waveDrive*.12+Math.abs(p.carve)*.025),0,1);
  p.boosting=boost;
  const w=windAt(env.weather,env.windAngle,env.time),c=currentAt(p.x,p.z,env.reversed);
  p.windEffect=(forward.x*w.x+forward.z*w.z)*w.strength*.18;
  p.currentEffect=(forward.x*c.x+forward.z*c.z)*c.strength*.38;
  p.base=boost?19:pump>0?12:6.2;
  const target=clamp(p.base+p.waveDrive*4+p.windEffect+p.currentEffect-brake*12,1.2,25);
  const response=p.grounded?(brake>0?3.1:target>p.speed?.62:.28):.04;
  const speed=p.speed+(target-p.speed)*(1-Math.exp(-dt*response));
  const velocity=softenOutward(forward.x*speed,forward.z*speed,p.x,p.z);
  p.vx=velocity.x;p.vz=velocity.z;p.x+=p.vx*dt;p.z+=p.vz*dt;p.collision=false;
  const wasGrounded=p.grounded;
  if(input.jump&&p.grounded){p.vy=7.4+wave.face*1.0+pump*.8;p.grounded=false;p.airTime=0;}
  const support=ridingHeight(p.x,p.z,env);
  if(p.grounded){p.y=support;p.vy=0;}else{
    p.vy-=18*dt;p.y+=p.vy*dt;p.airTime+=dt;
    if(p.y<=support&&p.vy<0){p.landing=clamp(-p.vy/10,.2,1);p.y=support;p.vy=0;p.grounded=true;}
  }
  for(const o of OBSTACLES){const hit=overlap(p.x,p.z,.4,o);if(!hit||p.y>=o.top-.05)continue;
    p.x+=hit.nx*(hit.depth+.002);p.z+=hit.nz*(hit.depth+.002);p.collision=true;p.vx*=.45;p.vz*=.45;}
  const q=boundaryWeight(p.x,p.z).q;if(q>.9998){p.x*=.9998/q;p.z*=.9998/q;}
  p.speed=Math.hypot(p.vx,p.vz);p.water=isWater(p.x,p.z);p.toolBonus=p.base-TOOLS.foot.water[0];p.landing*=Math.exp(-dt*7);
  if(wasGrounded&&!p.grounded)p.airTime=0;
  return p;
}
export const relation = dot => dot > .35 ? 'with' : dot < -.35 ? 'against' : 'cross';
export function comboKey(p, input, env) {
  const n = Math.hypot(input.x, input.z);
  if (n < .25 || p.speed < 2 || !p.grounded || p.collision || boundaryWeight(p.x, p.z).q > .86) return null;
  const w = windAt(env.weather, env.windAngle), wx = input.x / n, wz = input.z / n;
  const wr = relation(wx * w.x + wz * w.z);
  if (!p.water) return `${env.weather}:sand:${wr}`;
  const c = currentAt(p.x, p.z, env.reversed), cr = relation(wx * c.x + wz * c.z);
  return `${env.weather}:water:${wr}:${cr}`;
}
