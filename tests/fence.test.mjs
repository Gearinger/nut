/**
 * 围栏几何逻辑测试
 *
 * 运行：npm run test:fence
 *
 * 围栏判定是产品的核心约束（不在围栏内不可发言），
 * 几何算错会直接导致权限失效，所以这部分必须可重复验证。
 */
import {
  calculateDistance, pointInCircle, pointInPolygon, polygonCentroid,
  makeCirclePolygon, polygonBounds, fenceBoundingRadius, fenceCenter,
  isInsideFence, fenceToGeoJSON, formatRadius, fenceSummary,
  normalizePolygon, hasFenceGeometry, canInteractInFence,
  offsetPoint, FENCE_RADIUS_OPTIONS, clampFenceRadius,
  DEFAULT_FENCE_RADIUS, FENCE_MIN_RADIUS, FENCE_MAX_RADIUS,
} from '../src/lib/fence.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;

console.log('--- 1. makeCirclePolygon：各顶点到圆心距离应等于半径 ---');
for (const [name, lat, lng] of [['北京', 39.9042, 116.4074], ['上海', 31.2304, 121.4737], ['广州', 23.1291, 113.2644]]) {
  for (const r of [100, 1000, 3000]) {
    const ring = makeCirclePolygon(lat, lng, r, 64);
    const ds = ring.map(([x, y]) => calculateDistance(lat, lng, y, x));
    const maxErr = Math.max(...ds.map(d => Math.abs(d - r)));
    ok(`${name} r=${r}m 最大误差 ${maxErr.toFixed(1)}m (${(maxErr / r * 100).toFixed(2)}%)`, maxErr / r < 0.02, `实际 ${ds[0].toFixed(1)}`);
  }
}

console.log('--- 2. 圆是闭合的且首尾相同 ---');
{
  const ring = makeCirclePolygon(39.9042, 116.4074, 500);
  ok('顶点数 = steps+1 = 65', ring.length === 65, `实际 ${ring.length}`);
  ok('首尾重合', ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]);
}

console.log('--- 3. pointInCircle ---');
ok('圆心在内', pointInCircle(39.9042, 116.4074, 39.9042, 116.4074, 100));
ok('半径内 50m 在内', pointInCircle(39.9042 + 0.00045, 116.4074, 39.9042, 116.4074, 100));
ok('半径外 200m 在外', !pointInCircle(39.9042 + 0.0018, 116.4074, 39.9042, 116.4074, 100));

console.log('--- 4. pointInPolygon（射线法）---');
const square = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
ok('正方形中心在内', pointInPolygon(0.5, 0.5, square));
ok('x 超出右边界在外', !pointInPolygon(0.5, 1.5, square));
ok('x 超出左边界在外', !pointInPolygon(0.5, -0.5, square));
ok('y 超出上边界在外', !pointInPolygon(1.5, 0.5, square));
ok('顶点过少返回 false', !pointInPolygon(0.5, 0.5, [[0, 0], [1, 1]]));
{
  // 凹多边形（L 形）：(0.9, 0.1) 在缺口内应判为外部
  const L = [[0, 0], [1, 0], [1, 0.4], [0.4, 0.4], [0.4, 1], [0, 1], [0, 0]];
  ok('L 形实心区在内', pointInPolygon(0.2, 0.2, L));
  ok('L 形缺口区在外', !pointInPolygon(0.8, 0.8, L), '射线法对凹多边形失效');
}

console.log('--- 5. polygonCentroid ---');
{
  const c = polygonCentroid(square);
  ok(`正方形质心 = (0.5, 0.5)，实际 (${c[0].toFixed(3)}, ${c[1].toFixed(3)})`, near(c[0], 0.5, 1e-9) && near(c[1], 0.5, 1e-9));
  const rect = [[0, 0], [3, 0], [3, 1], [0, 1], [0, 0]];
  const c2 = polygonCentroid(rect);
  ok(`长方形质心 = (1.5, 0.5)，实际 (${c2[0].toFixed(3)}, ${c2[1].toFixed(3)})`, near(c2[0], 1.5, 1e-9) && near(c2[1], 0.5, 1e-9));
}

console.log('--- 6. polygonBounds ---');
{
  const b = polygonBounds(square);
  ok('外接矩形正确', b.minLng === 0 && b.maxLng === 1 && b.minLat === 0 && b.maxLat === 1);
}

console.log('--- 7. fenceBoundingRadius / fenceCenter ---');
{
  const polyFence = { shape: 'polygon', polygon: square, latitude: 0.5, longitude: 0.5 };
  const r = fenceBoundingRadius(polyFence);
  const expect = calculateDistance(0.5, 0.5, 0, 0);
  ok(`多边形外接半径 ${r.toFixed(0)}m ≈ 到角点 ${expect.toFixed(0)}m`, near(r, expect, 1));
  const c = fenceCenter({ shape: 'polygon', polygon: square });
  ok('多边形无 center 时取质心', c && near(c.lat, 0.5, 1e-9) && near(c.lng, 0.5, 1e-9));
}

console.log('--- 8. isInsideFence 分派 ---');
{
  const circleFence = { shape: 'circle', latitude: 39.9042, longitude: 116.4074, radius: 500 };
  ok('圆形围栏：圈内', isInsideFence(39.9042, 116.4074, circleFence));
  ok('圆形围栏：圈外', !isInsideFence(39.95, 116.4074, circleFence));
  const polyFence = { shape: 'polygon', polygon: square, latitude: 0.5, longitude: 0.5, radius: 999 };
  ok('多边形围栏：内部（忽略 radius）', isInsideFence(0.5, 0.5, polyFence));
  ok('多边形围栏：外部', !isInsideFence(0.5, 5, polyFence));
  ok('null 围栏返回 false', !isInsideFence(1, 1, null));
  ok('坐标为 NaN 返回 false', !isInsideFence(NaN, 1, circleFence));
}

console.log('--- 9. normalizePolygon（DB 可能返回字符串）---');
{
  ok('数组原样返回', normalizePolygon(square) === square);
  ok('JSON 字符串可解析', JSON.stringify(normalizePolygon(JSON.stringify(square))) === JSON.stringify(square));
  ok('非法字符串返回 null', normalizePolygon('{bad json') === null);
  ok('null 返回 null', normalizePolygon(null) === null);
}

console.log('--- 10. fenceToGeoJSON ---');
{
  const circleFence = { id: 'r1', name: '测试', shape: 'circle', latitude: 39.9042, longitude: 116.4074, radius: 300 };
  const gj = fenceToGeoJSON(circleFence);
  ok('圆形产出 Polygon Feature', gj && gj.geometry.type === 'Polygon' && gj.geometry.coordinates[0].length === 65);
  ok('携带 properties', gj.properties.id === 'r1' && gj.properties.name === '测试');
  const polyFence = { id: 'r2', shape: 'polygon', polygon: square };
  ok('多边形产出 Polygon Feature', fenceToGeoJSON(polyFence).geometry.coordinates[0].length === 5);
  ok('缺少坐标返回 null', fenceToGeoJSON({ shape: 'circle' }) === null);
}

console.log('--- 11. formatRadius / fenceSummary ---');
ok('500 -> 500 m', formatRadius(500) === '500 m');
ok('1000 -> 1 km', formatRadius(1000) === '1 km');
ok('1500 -> 1.5 km', formatRadius(1500) === '1.5 km');
ok('圆形摘要', fenceSummary({ shape: 'circle', radius: 300 }).includes('300 m'));
ok('多边形摘要含顶点数', fenceSummary({ shape: 'polygon', polygon: square }).includes('4'));

console.log('--- 12. 档位配置 ---');
ok('四档半径', FENCE_RADIUS_OPTIONS.length === 4);
ok('档位升序', FENCE_RADIUS_OPTIONS.every((o, i, a) => i === 0 || o.value > a[i - 1].value));

console.log('--- 13. offsetPoint（半径手柄定位）---');
{
  const [lng, lat] = offsetPoint(39.9042, 116.4074, 0, 1000);
  const d = calculateDistance(39.9042, 116.4074, lat, lng);
  ok(`向东 1000m 实际 ${d.toFixed(1)}m（误差 ${(Math.abs(d - 1000) / 10).toFixed(2)}%）`, Math.abs(d - 1000) / 1000 < 0.01);
  ok('向东不改变纬度', near(lat, 39.9042, 1e-9));
  const [lng2, lat2] = offsetPoint(39.9042, 116.4074, 1000, 0);
  ok(`向北 1000m 实际 ${calculateDistance(39.9042, 116.4074, lat2, lng2).toFixed(1)}m`, Math.abs(calculateDistance(39.9042, 116.4074, lat2, lng2) - 1000) / 1000 < 0.01);
  ok('向北不改变经度', near(lng2, 116.4074, 1e-9));
}

console.log('--- 14. hasFenceGeometry ---');
ok('圆形有坐标即算有围栏', hasFenceGeometry({ shape: 'circle', latitude: 31.2, longitude: 121.4, radius: 300 }));
ok('坐标为 null 不算', !hasFenceGeometry({ shape: 'circle', latitude: null, longitude: null }));
ok('多边形顶点足够算有', hasFenceGeometry({ shape: 'polygon', polygon: square }));
ok('多边形顶点不足不算', !hasFenceGeometry({ shape: 'polygon', polygon: [[0, 0], [1, 1]] }));
ok('null 不算', !hasFenceGeometry(null));

console.log('--- 15. canInteractInFence（历史房间兼容）---');
{
  const legacy = { shape: 'circle', latitude: null, longitude: null };
  ok('无围栏几何的历史房间放行', canInteractInFence(31.2, 121.4, legacy));
  const real = { shape: 'circle', latitude: 39.9042, longitude: 116.4074, radius: 500 };
  ok('围栏内放行', canInteractInFence(39.9042, 116.4074, real));
  ok('围栏外拦截', !canInteractInFence(39.95, 116.4074, real));
}

console.log('--- 16. clampFenceRadius（防止外接半径撞数据库约束）---');
ok('正常值原样返回', clampFenceRadius(300) === 300, String(clampFenceRadius(300)));
ok('超出上限夹到 5000', clampFenceRadius(12000) === FENCE_MAX_RADIUS, String(clampFenceRadius(12000)));
ok('低于下限夹到 50', clampFenceRadius(10) === FENCE_MIN_RADIUS, String(clampFenceRadius(10)));
ok('小数取整', clampFenceRadius(300.6) === 301, String(clampFenceRadius(300.6)));
ok('NaN 回落到默认值', clampFenceRadius(NaN) === DEFAULT_FENCE_RADIUS);
ok('null 回落到默认值', clampFenceRadius(null) === DEFAULT_FENCE_RADIUS);
ok('边界值保持', clampFenceRadius(FENCE_MAX_RADIUS) === FENCE_MAX_RADIUS && clampFenceRadius(FENCE_MIN_RADIUS) === FENCE_MIN_RADIUS);

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
