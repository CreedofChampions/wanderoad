import { Vehicle } from '../src/car/vehicle.js';
import { PHYSICS_DT } from '../src/car/tuning.js';
const FLAT={surface:()=>({y:0,grip:1,rough:0,surfaceKind:'tarmac',onRoad:1,dominant:0}),height:()=>0};
const car=new Vehicle({tier:'sports',terrain:FLAT,preset:'off'});
car.placeAt(0,0,0); car.vz=40; car.vx=0;
const IN={steer:0.30,throttle:0.30,brake:0,handbrake:0,analogue:true};
console.log('  t     v    slip°  yawRate  latG   steerA°  aF°    aR°   fyF/fyR');
for(let i=0;i<=120*5;i++){
  car._step(PHYSICS_DT,IN);
  if(i%60===0){
    const g=Math.abs(car.speed)*Math.abs(car.yawRate)/9.81;
    console.log(
      (i*PHYSICS_DT).toFixed(2).padStart(5),
      Math.abs(car.speed).toFixed(1).padStart(6),
      (car.slip*57.3).toFixed(1).padStart(6),
      car.yawRate.toFixed(3).padStart(8),
      g.toFixed(2).padStart(6),
      (car.steerAngle*57.3).toFixed(1).padStart(7),
      (car.wheels[0].slipAngle*57.3).toFixed(1).padStart(6),
      (car.wheels[2].slipAngle*57.3).toFixed(1).padStart(6));
  }
}
