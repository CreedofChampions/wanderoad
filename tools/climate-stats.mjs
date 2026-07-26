import { climateAt } from '../src/world/biomes.js';
const SEED=1337; const E=[],T=[],M=[];
for(let i=0;i<200;i++)for(let j=0;j<200;j++){
  const x=(i-100)*420, z=(j-100)*420;
  const c=climateAt(x,z,SEED); E.push(c.e); T.push(c.t); M.push(c.m);
}
const q=(a,p)=>{const s=[...a].sort((x,y)=>x-y);return s[Math.floor(p*(s.length-1))];};
for(const [n,a] of [['e',E],['t',T],['m',M]])
  console.log(n, 'min',q(a,0).toFixed(3),'p10',q(a,.1).toFixed(3),'p25',q(a,.25).toFixed(3),'p50',q(a,.5).toFixed(3),'p75',q(a,.75).toFixed(3),'p90',q(a,.9).toFixed(3),'max',q(a,1).toFixed(3));
// joint: how often is it hot & dry / low & wet
let hotdry=0, lowwet=0, highcold=0;
for(let i=0;i<E.length;i++){ if(T[i]>0.7&&M[i]<0.3)hotdry++; if(E[i]<0.3&&M[i]>0.7)lowwet++; if(E[i]>0.7&&T[i]<0.35)highcold++; }
console.log('hot&dry',(100*hotdry/E.length).toFixed(1)+'%','low&wet',(100*lowwet/E.length).toFixed(1)+'%','high&cold',(100*highcold/E.length).toFixed(1)+'%');
