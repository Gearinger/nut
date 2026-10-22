/**
 * 坐标系转换测试（WGS-84 <-> GCJ-02）
 * 运行：npm run test:coords
 *
 * 这是纯数学逻辑，不需要浏览器即可验证。
 * 偏移算法来自公开的标准实现，这里验证的是「行为符合预期」而非算法本身。
 */
import {
  wgs84ToGcj02,
  gcj02ToWgs84,
  toDisplayCoords,
  geojsonToGcj02,
} from '../src/lib/coords.js';

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}${extra ? ' — ' + extra : ''}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`);
  }
};

/** 两点球面距离（米） */
function distanceM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// 国内典型城市（WGS-84 近似值）
const CITIES = [
  ['北京', 39.9087, 116.3975],
  ['上海', 31.2304, 121.4737],
  ['武汉', 30.5931, 114.3055],
  ['广州', 23.1291, 113.2644],
  ['深圳', 22.5431, 114.0579],
  ['成都', 30.5728, 104.0668],
];

console.log('--- 1. WGS-84 -> GCJ-02 偏移量应落在合理区间 ---');
for (const [name, lat, lng] of CITIES) {
  const [gLat, gLng] = wgs84ToGcj02(lat, lng);
  const d = distanceM(lat, lng, gLat, gLng);
  // 中国境内 GCJ-02 偏移典型值 300~800m，取 100~1000m 做宽松断言
  ok(
    `${name} 偏移 ${d.toFixed(0)}m 在 100~1000m`,
    d > 100 && d < 1000
  );
}

console.log('--- 2. 往返转换应回到原点（误差 < 1m）---');
for (const [name, lat, lng] of CITIES) {
  const [gLat, gLng] = wgs84ToGcj02(lat, lng);
  const [bLat, bLng] = gcj02ToWgs84(gLat, gLng);
  const d = distanceM(lat, lng, bLat, bLng);
  ok(`${name} 往返误差 ${d.toFixed(3)}m < 1m`, d < 1);
}

console.log('--- 3. 边界框外的坐标不做偏移 ---');
// 注意：GCJ-02 的境内判断用的是一个矩形边界框（72.004~137.8347°E, 0.8293~55.8271°N），
// 它无法精确贴合国界。新加坡（103.82°E, 1.35°N）正好落在框内，也会被偏移——
// 这是公开标准实现的固有特性，不是 bug。这里只断言明确在框外的点。
const ABROAD = [
  ['东京', 35.6762, 139.6503], // 139.65°E > 137.83° 框外
  ['纽约', 40.7128, -74.006], // 西经，框外
  ['伦敦', 51.5074, -0.1278], // 框外
];
for (const [name, lat, lng] of ABROAD) {
  const [gLat, gLng] = wgs84ToGcj02(lat, lng);
  const d = distanceM(lat, lng, gLat, gLng);
  ok(`${name} 偏移 ${d.toFixed(3)}m 应为 0`, d < 0.001);
}

console.log('--- 4. 非法输入不应返回有限数字（否则会被当成有效坐标）---');
// ⚠️ 这个断言必须能真正失败：Number(null) === 0 是 finite，
// 如果实现里只用 Number.isFinite(Number(v)) 做校验，null 会被误判成有效坐标。
for (const bad of [null, undefined, NaN, '', 'abc']) {
  const [a, b] = wgs84ToGcj02(bad, bad);
  const bothNaN = Number.isNaN(a) && Number.isNaN(b);
  ok(
    `输入 ${JSON.stringify(bad)} -> (${a}, ${b}) 应为 NaN 对`,
    bothNaN
  );
}
// 反向自检：确保上面的断言不是恒真（对照组必须失败，否则测试本身是坏的）
{
  const [, controlLng] = wgs84ToGcj02(30.5931, 114.3055);
  const controlBad = Number.isNaN(controlLng);
  ok('对照组：合法坐标不应为 NaN（证明断言非恒真）', controlBad === false);
}

console.log('--- 5. toDisplayCoords 是 wgs84ToGcj02 的语义别名 ---');
{
  const a = toDisplayCoords(30.5931, 114.3055);
  const b = wgs84ToGcj02(30.5931, 114.3055);
  ok('两者结果一致', a[0] === b[0] && a[1] === b[1]);
}

console.log('--- 6. 偏移方向：经度恒向东，纬度方向随位置变化 ---');
// GCJ-02 的经度偏移恒为正（向东），但纬度偏移方向取决于所在位置（北京实测向北 ~155m）。
// 这里只断言经度方向确定、纬度偏移量级合理，不假设纬度朝向。
for (const [name, lat, lng] of CITIES) {
  const [gLat, gLng] = wgs84ToGcj02(lat, lng);
  ok(`${name} 向东偏（经度增大）`, gLng > lng, `Δlng=${(gLng - lng).toFixed(5)}`);
  const dLatM = Math.abs(((gLat - lat) * Math.PI) / 180) * 6371000;
  ok(`${name} 纬度偏移 ${dLatM.toFixed(0)}m 在 0~800m`, dLatM > 0 && dLatM < 800);
}

console.log('--- 7. GeoJSON 整体转换 ---');
{
  // 一个武汉的三角形围栏（WGS-84），GeoJSON 顺序是 [lng, lat]
  const ring = [
    [114.3, 30.59],
    [114.31, 30.59],
    [114.31, 30.6],
    [114.3, 30.59],
  ];
  const fc = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { name: '测试围栏' },
        geometry: { type: 'Polygon', coordinates: [ring] },
      },
    ],
  };

  const out = geojsonToGcj02(fc);

  // 7a. 不修改入参
  ok('原对象未被修改', fc.features[0].geometry.coordinates[0][0][0] === 114.3);

  // 7b. 结构与属性保留
  ok('type 保留', out.type === 'FeatureCollection');
  ok('properties 保留', out.features[0].properties.name === '测试围栏');
  ok('顶点数不变', out.features[0].geometry.coordinates[0].length === 4);

  // 7c. 每个顶点都做了偏移，且偏移量与单点转换一致
  const outRing = out.features[0].geometry.coordinates[0];
  const allShifted = outRing.every(([lng, lat], i) => {
    const [dLat, dLng] = wgs84ToGcj02(ring[i][1], ring[i][0]);
    return Math.abs(lat - dLat) < 1e-12 && Math.abs(lng - dLng) < 1e-12;
  });
  ok('每个顶点与单点转换结果一致', allShifted);

  const moved = outRing.every(([lng, lat], i) => lng !== ring[i][0] && lat !== ring[i][1]);
  ok('每个顶点确实发生了位移（非恒等）', moved);

  // 7d. 闭合环的首尾仍是同一点
  const first = outRing[0];
  const last = outRing[outRing.length - 1];
  ok('闭合环首尾仍闭合', first[0] === last[0] && first[1] === last[1]);
}

console.log('--- 8. GeoJSON 边界情况不崩溃 ---');
{
  ok('null 原样返回', geojsonToGcj02(null) === null);
  ok('缺少 coordinates 的原样返回', JSON.stringify(geojsonToGcj02({ type: 'Point' })) === '{"type":"Point"}');
  const empty = geojsonToGcj02({ type: 'FeatureCollection', features: [] });
  ok('空 FeatureCollection 正常', empty.features.length === 0);
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
if (fail > 0) process.exit(1);
