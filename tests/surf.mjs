import assert from 'node:assert/strict';
import { makePlayer,stepPlayer,stepSurfer,swellAt,ridingHeight,boundaryWeight,LIMIT } from '../island.js';
const results=[];
const fresh=()=>{const p=makePlayer('surf');p.tool='surfboard';p.facing=-.95;p.speed=7;p.energy=1;return p;};
function run(p,input,seconds,weather='sunny',pin=false){let time=0;for(let i=0;i<seconds*120;i++){time+=1/120;const x=p.x,z=p.z;stepSurfer(p,{...input,jump:input.jump&&i===0},{weather,windAngle:Math.PI/4,reversed:false,time},1/120);if(pin){p.x=x;p.z=z;}}return p;}
function check(name,fn){fn();results.push(name);}
check('A released board keeps gliding; pumping and boosting add real speed',()=>{
 const coast=run(fresh(),{},2),pump=run(fresh(),{pump:1},2),boost=run(fresh(),{pump:1,sprint:true},2);
 assert.ok(coast.speed>4);assert.ok(pump.speed>coast.speed+2);assert.ok(boost.speed>pump.speed+3);assert.ok(boost.energy<.6);
 const before=boost.energy;run(boost,{},1);assert.ok(boost.energy>before);
});
check('D turns right and A turns left from a forward-facing board; release promptly ends the turn',()=>{
 const right=fresh();right.x=85;right.z=50;right.facing=0;const rightX=right.x;
 stepSurfer(right,{steer:1},{weather:'sunny',windAngle:0,time:0},1/120);assert.ok(Math.abs(right.facing)<.01);
 run(right,{steer:1},1);assert.ok(right.x>rightX+2,'D must turn toward the right side of a rear-facing camera.');assert.ok(right.facing<-.6);
 const left=fresh();left.x=85;left.z=50;left.facing=0;const leftX=left.x;
 run(left,{steer:-1},1);assert.ok(left.x<leftX-2,'A must turn toward the left side of a rear-facing camera.');
 run(right,{},.3);assert.ok(Math.abs(right.carve)<.01,'Released steering must stop turning promptly.');
});
check('Both weather states support the board on each actual moving wave, including troughs',()=>{
 for(const weather of ['sunny','windy']){const p=fresh();for(let i=0;i<3600;i++){
  const env={weather,windAngle:0,reversed:false,time:i/120};p.x=78;p.z=45;stepSurfer(p,{},env,1/120);
  assert.ok(Math.abs(p.y-ridingHeight(p.x,p.z,env))<1e-8);assert.equal(p.grounded,true);
 }}
 assert.ok(Math.abs(swellAt(78,45,2).height-swellAt(78,45,3).height)>.3);
});
check('A pop leaves the wave and lands without accumulating a vertical offset',()=>{
 const p=run(fresh(),{jump:true,pump:1},.2);assert.equal(p.grounded,false);assert.ok(p.y>.8);
 run(p,{},2);assert.equal(p.grounded,true);assert.ok(Number.isFinite(p.y));
});
check('Exploration tools and the jet ski also stay on the new large swells',()=>{
 for(const tool of ['foot','jetski','exoskeleton']){const p=fresh();p.tool=tool;p.x=78;p.z=45;p.speed=0;p.vx=0;p.vz=0;
  p.y=ridingHeight(p.x,p.z,{weather:'windy',time:0});
  for(let i=0;i<1200;i++){const env={weather:'windy',windAngle:0,reversed:false,time:i/120};stepPlayer(p,{x:0,z:0},env,1/120);
   assert.ok(Math.abs(p.y-ridingHeight(p.x,p.z,env))<1e-6,tool+' must not fall through the wave.');}
 }
});
check('The larger surf area is finite, slows outward travel and allows carving back',()=>{
 const p=fresh();p.x=LIMIT.x*.97;p.z=0;p.facing=-Math.PI/2;p.speed=18;
 run(p,{pump:1},10);assert.ok(boundaryWeight(p.x,p.z).q<=1);assert.ok(p.speed<2);
 const x=p.x;p.facing=Math.PI/2;run(p,{pump:1},2);assert.ok(p.x<x-5);
});
console.log(JSON.stringify({surfChecks:results,status:'PASS'},null,2));
