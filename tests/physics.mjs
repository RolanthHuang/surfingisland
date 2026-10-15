import assert from 'node:assert/strict';
import { ZONES, LIMIT, OBSTACLES, isWater, floorAt, makePlayer, stepPlayer, comboKey, boundaryWeight } from '../island.js';
const env={weather:'sunny',windAngle:0,reversed:false,time:0};
const results=[];
function check(name,fn){fn();results.push({name,status:'PASS'});}
function simulate(p,input,seconds,settings=env,pin=false){for(let i=0;i<seconds*120;i++){const x=p.x,z=p.z;stepPlayer(p,{...input,jump:input.jump&&i===0},settings,1/120);if(pin){p.x=x;p.z=z;}}return p;}
function pace(zone,dir,settings=env,sprint=false){return simulate(makePlayer(zone),{x:dir[0],z:dir[1],sprint},2,settings,true);}
check('Each quick destination matches its declared surface',()=>{assert.equal(isWater(ZONES.beach.x,ZONES.beach.z),false);assert.equal(isWater(ZONES.lagoon.x,ZONES.lagoon.z),true);assert.equal(isWater(ZONES.obstacles.x,ZONES.obstacles.z),false);assert.equal(isWater(ZONES.current.x,ZONES.current.z),true);});
const sunnyWith=pace('beach',[0,-1]),sunnyAgainst=pace('beach',[0,1]);
const windyWith=pace('beach',[0,-1],{...env,weather:'windy'}),windyAgainst=pace('beach',[0,1],{...env,weather:'windy'});
check('Same terrain: tailwind faster than headwind; storm increases the gap',()=>{assert.ok(sunnyWith.speed>sunnyAgainst.speed+.8);assert.ok(windyWith.speed>windyAgainst.speed+5.8);assert.ok(windyWith.speed>sunnyWith.speed+2);});
const flowWith=pace('lagoon',[1,0]),flowAgainst=pace('lagoon',[1,0],{...env,reversed:true});
check('Reversing current changes speed without changing wind or terrain',()=>{assert.ok(flowWith.speed>flowAgainst.speed+2.6);assert.equal(flowWith.water,true);assert.equal(flowAgainst.water,true);});
check('Current has no speed effect on sand',()=>{assert.ok(Math.abs(pace('beach',[1,0]).speed-pace('beach',[1,0],{...env,reversed:true}).speed)<1e-8);});
check('Sprinting increases speed on both surfaces',()=>{for(const zone of ['beach','lagoon'])assert.ok(pace(zone,[1,0],env,true).speed>pace(zone,[1,0]).speed+3.4);});
check('No input holds position and stops existing motion',()=>{const p=makePlayer('current'),x=p.x,z=p.z;simulate(p,{x:0,z:0},2);assert.equal(p.x,x);assert.equal(p.z,z);p.vx=8;simulate(p,{x:0,z:0},2);assert.ok(p.speed<.01);});
check('Walking through the coast automatically switches to water',()=>{const p=makePlayer();p.x=-8;p.z=30;p.y=floorAt(p.x,p.z);simulate(p,{x:0,z:1},2);assert.ok(p.z>37);assert.equal(p.water,true);});
check('A large rock blocks movement instead of allowing overlap',()=>{const o=OBSTACLES.find(o=>o.type==='rock'&&o.x===30);const p=makePlayer();p.x=30;p.z=25;p.y=floorAt(p.x,p.z);simulate(p,{x:0,z:-1},2);assert.ok(Math.hypot(p.x-o.x,p.z-o.z)>=o.r+.339);assert.ok(p.z>o.z);});
check('A low log stops ordinary running; a jump clears it',()=>{const start=()=>{const p=makePlayer();p.x=20;p.z=16.8;p.y=floorAt(p.x,p.z);return p;};const walk=simulate(start(),{x:0,z:-1},1);assert.ok(walk.z>14.5);const jump=simulate(start(),{x:0,z:-1,jump:true},.75);assert.ok(jump.z<13.7,JSON.stringify(jump));});
check('Jump returns to the surface and cannot be repeated in midair',()=>{const p=makePlayer('lagoon'),floor=p.y;simulate(p,{x:0,z:0,jump:true},.2);assert.ok(p.y>floor+.9);assert.equal(p.grounded,false);const vy=p.vy;stepPlayer(p,{x:0,z:0,jump:true},env,1/120);assert.ok(p.vy<vy);simulate(p,{x:0,z:0},2);assert.equal(p.grounded,true);assert.ok(Math.abs(p.y-floor)<.001);});
check('The soft boundary slows only outward motion and permits a return',()=>{const p=makePlayer('current');p.x=LIMIT.x*.86;p.z=0;p.y=floorAt(p.x,p.z);simulate(p,{x:1,z:0},1);const early=p.vx;simulate(p,{x:1,z:0},20);assert.ok(boundaryWeight(p.x,p.z).q<=1);assert.ok(p.vx<early*.15);simulate(p,{x:-1,z:0},1);assert.ok(p.vx< -3);});
check('All 24 environment combinations are reachable through direction controls',()=>{const combos=new Set();for(const weather of ['sunny','windy'])for(const zone of ['beach','lagoon'])for(let w=0;w<8;w++)for(let d=0;d<32;d++){const e={...env,weather,windAngle:w*Math.PI/4},p=makePlayer(zone);p.speed=5;p.grounded=true;const key=comboKey(p,{x:Math.sin(d*Math.PI/16),z:-Math.cos(d*Math.PI/16)},e);if(key)combos.add(key);}assert.equal(combos.size,24);});
check('Every solid obstacle has a finite collision footprint and height',()=>{for(const o of OBSTACLES){assert.ok(Number.isFinite(o.top)&&o.top>o.base);assert.ok(o.r>0||(o.width>0&&o.depth>0));}});
console.log(JSON.stringify({results,examples:{sunnyTailwind:sunnyWith.speed,sunnyHeadwind:sunnyAgainst.speed,stormTailwind:windyWith.speed,stormHeadwind:windyAgainst.speed,currentForward:flowWith.speed,currentReversed:flowAgainst.speed}},null,2));
