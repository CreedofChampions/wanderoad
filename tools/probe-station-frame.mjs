/* Which way does a forecourt FACE? The showroom line-up has to sit on the open apron, not inside
 * the kiosk and not across the driveway, and the station's local frame is only documented by the
 * numbers in buildStation. So ask a real station: put its own spur mouth into local coordinates. */
import { stationsInBox, stationSpur, STATION_APRON_HALF_DEPTH, STATION_APRON_HALF_WIDTH } from '../src/world/props.js';
const SEED = Number(process.argv[2] || 20260726);
const list = stationsInBox(-4000, -4000, 4000, 4000, SEED) || [];
const s = list.find((x) => x.deal) || list[0];
if (!s) { console.log('no station in the box'); process.exit(1); }
const sp = stationSpur(s);
const ca = Math.cos(s.yaw), sa = Math.sin(s.yaw);
const wx = sp.apronX - s.x, wz = sp.apronZ - s.z;
// inverse of blit's rotY: x' = x*ca - z*sa, z' = x*sa + z*ca
const lx = wx * ca + wz * sa, lz = -wx * sa + wz * ca;
console.log(JSON.stringify({
  stations: list.length, dealerships: list.filter((x) => x.deal).length,
  yaw: +s.yaw.toFixed(3), driveway_enters_at_local: [+lx.toFixed(2), +lz.toFixed(2)],
  apron: [STATION_APRON_HALF_WIDTH, STATION_APRON_HALF_DEPTH],
}));
