/**
 * 地理围栏几何工具
 *
 * 围栏两种形状：
 *   circle  —— 中心点 + 半径（米）
 *   polygon —— 顶点环，GeoJSON 顺序 [[lng, lat], ...]，首尾点相同表示闭合
 *
 * 数据库只能按经纬度矩形粗筛，真正的「是否在围栏内」必须在客户端用
 * 球面距离（圆）或射线法（多边形）判定。
 */

const EARTH_RADIUS_M = 6371000; // 地球平均半径（米）
const METERS_PER_DEGREE_LAT = 111320; // 1 纬度对应的距离（米），近似常量

const toRad = (deg) => (deg * Math.PI) / 180;

/** 围栏形状 */
export const FENCE_SHAPE = {
  CIRCLE: 'circle',
  POLYGON: 'polygon',
};

/** 圆形围栏的半径档位（米） */
export const FENCE_RADIUS_OPTIONS = [
  { value: 100, label: '100 m', desc: '一栋楼 / 一家店' },
  { value: 300, label: '300 m', desc: '一个街区' },
  { value: 1000, label: '1 km', desc: '一个园区' },
  { value: 3000, label: '3 km', desc: '一片城区' },
];

export const DEFAULT_FENCE_RADIUS = 300;
export const FENCE_MIN_RADIUS = 50;
export const FENCE_MAX_RADIUS = 5000;
export const FENCE_MIN_VERTICES = 3;
export const FENCE_MAX_VERTICES = 12;

/**
 * 把半径收敛到合法区间。
 *
 * 手绘多边形存的是「外接半径」（仅用于数据库粗筛），顶点拉得开时
 * 很容易算出大于 FENCE_MAX_RADIUS 的值，落库会撞上数据库的
 * radius 检查约束。这里统一夹紧，避免手绘围栏创建失败。
 */
export function clampFenceRadius(value) {
  // 注意：Number(null) === 0 是有限数，必须先把空值挡在外面，
  // 否则 null 会被当成 0 米再夹成 50 米，而不是回落到默认值。
  if (value === null || value === undefined || value === '') return DEFAULT_FENCE_RADIUS;
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_FENCE_RADIUS;
  return Math.min(FENCE_MAX_RADIUS, Math.max(FENCE_MIN_RADIUS, Math.round(n)));
}

/**
 * 两点之间的球面距离（米），Haversine 公式
 */
export function calculateDistance(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}

/**
 * 从某点向北/向东偏移指定米数后的坐标，返回 [lng, lat]
 * 用于放置半径拖拽手柄
 */
export function offsetPoint(lat, lng, northMeters, eastMeters) {
  const cosLat = Math.max(Math.cos(toRad(lat)), 0.01);
  return [
    lng + eastMeters / (METERS_PER_DEGREE_LAT * cosLat),
    lat + northMeters / METERS_PER_DEGREE_LAT,
  ];
}

/** 点是否在圆形围栏内 */
export function pointInCircle(lat, lng, centerLat, centerLng, radiusMeters) {
  if (!Number.isFinite(radiusMeters)) return false;
  return calculateDistance(lat, lng, centerLat, centerLng) <= radiusMeters;
}

/**
 * 点是否在多边形围栏内（射线法）
 * @param ring 顶点数组 [[lng, lat], ...]
 */
export function pointInPolygon(lat, lng, ring) {
  if (!Array.isArray(ring) || ring.length < FENCE_MIN_VERTICES) return false;
  const px = lng;
  const py = lat;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const straddles = yi > py !== yj > py;
    if (straddles && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** 多边形的外接矩形 */
export function polygonBounds(ring) {
  if (!Array.isArray(ring) || ring.length === 0) return null;
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of ring) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return { minLng, maxLng, minLat, maxLat };
}

/** 去掉闭合用的重复尾点，得到不重复的顶点列表 */
function uniqueVertices(ring) {
  const pts = Array.isArray(ring) ? ring.slice() : [];
  if (pts.length > 1) {
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (first[0] === last[0] && first[1] === last[1]) pts.pop();
  }
  return pts;
}

/**
 * 多边形的面积加权质心，返回 [lng, lat]
 * 退化（面积 0）时退回算术平均，避免除零
 */
export function polygonCentroid(ring) {
  const pts = uniqueVertices(ring);
  if (pts.length === 0) return null;
  if (pts.length <= 2) {
    const n = pts.length;
    return [
      pts.reduce((s, p) => s + p[0], 0) / n,
      pts.reduce((s, p) => s + p[1], 0) / n,
    ];
  }
  let area2 = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    const f = xj * yi - xi * yj;
    area2 += f;
    cx += (xj + xi) * f;
    cy += (yj + yi) * f;
  }
  if (area2 === 0) {
    const n = pts.length;
    return [
      pts.reduce((s, p) => s + p[0], 0) / n,
      pts.reduce((s, p) => s + p[1], 0) / n,
    ];
  }
  return [cx / (3 * area2), cy / (3 * area2)];
}

/**
 * 生成圆形围栏的多边形顶点环，用于地图绘制
 * 经度方向按 cos(lat) 换算，否则高纬度画出来是椭圆
 */
export function makeCirclePolygon(lat, lng, radiusMeters, steps = 64) {
  const cosLat = Math.max(Math.cos(toRad(lat)), 0.01);
  const ring = [];
  for (let i = 0; i < steps; i++) {
    const angle = (i / steps) * 2 * Math.PI;
    const dLat = (radiusMeters * Math.cos(angle)) / METERS_PER_DEGREE_LAT;
    const dLng =
      (radiusMeters * Math.sin(angle)) / (METERS_PER_DEGREE_LAT * cosLat);
    ring.push([lng + dLng, lat + dLat]);
  }
  ring.push([ring[0][0], ring[0][1]]); // 闭合
  return ring;
}

/** 围栏外扩半径：多边形取质心到最远顶点的距离，用于数据库粗筛 */
export function fenceBoundingRadius(fence) {
  if (!fence) return DEFAULT_FENCE_RADIUS;
  if (fence.shape === FENCE_SHAPE.POLYGON && Array.isArray(fence.polygon)) {
    const pts = uniqueVertices(fence.polygon);
    if (pts.length === 0) return DEFAULT_FENCE_RADIUS;
    let center;
    if (Number.isFinite(fence.latitude) && Number.isFinite(fence.longitude)) {
      center = [fence.longitude, fence.latitude];
    } else {
      center = polygonCentroid(pts);
    }
    return pts.reduce(
      (max, [lng, lat]) =>
        Math.max(max, calculateDistance(center[1], center[0], lat, lng)),
      0
    );
  }
  return Number.isFinite(fence.radius) ? fence.radius : DEFAULT_FENCE_RADIUS;
}

/** 围栏中心点，多边形取质心 */
export function fenceCenter(fence) {
  if (!fence) return null;
  if (Number.isFinite(fence.latitude) && Number.isFinite(fence.longitude)) {
    return { lat: fence.latitude, lng: fence.longitude };
  }
  if (fence.shape === FENCE_SHAPE.POLYGON && Array.isArray(fence.polygon)) {
    const c = polygonCentroid(fence.polygon);
    return c ? { lat: c[1], lng: c[0] } : null;
  }
  return null;
}

/**
 * 判定某个位置是否在围栏内——围栏准入的唯一入口
 */
export function isInsideFence(lat, lng, fence) {
  if (!fence || !Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (fence.shape === FENCE_SHAPE.POLYGON) {
    const ring = normalizePolygon(fence.polygon);
    if (ring && ring.length >= FENCE_MIN_VERTICES) {
      return pointInPolygon(lat, lng, ring);
    }
  }
  return pointInCircle(
    lat,
    lng,
    fence.latitude,
    fence.longitude,
    Number.isFinite(fence.radius) ? fence.radius : DEFAULT_FENCE_RADIUS
  );
}

/**
 * 围栏是否有可用的几何数据
 * 迁移前创建的历史房间没有围栏字段，此时不应把所有人挡在外面
 */
export function hasFenceGeometry(fence) {
  if (!fence) return false;
  if (fence.shape === FENCE_SHAPE.POLYGON) {
    const ring = normalizePolygon(fence.polygon);
    return !!ring && ring.length >= FENCE_MIN_VERTICES;
  }
  // 注意不能只写 Number.isFinite(Number(v))：Number(null) 是 0，会被误判成有效坐标
  return isFiniteCoord(fence.latitude) && isFiniteCoord(fence.longitude);
}

/** 坐标是否可用：null / undefined / 空串都不算 */
function isFiniteCoord(v) {
  return v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
}

/**
 * 是否可以在该围栏内交互——围栏准入对外使用的判断
 * 无围栏几何（历史数据）时放行，避免一次迁移把老房间全部变只读
 */
export function canInteractInFence(lat, lng, fence) {
  if (!hasFenceGeometry(fence)) return true;
  return isInsideFence(lat, lng, fence);
}

/**
 * 归一化 polygon 字段：数据库可能返回 JSON 字符串、PostGIS 文本或数组
 */
export function normalizePolygon(polygon) {
  if (Array.isArray(polygon)) return polygon;
  if (typeof polygon === 'string') {
    try {
      const parsed = JSON.parse(polygon);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** 围栏转 GeoJSON Feature，供地图 source 使用 */
export function fenceToGeoJSON(fence, props = {}) {
  if (!fence) return null;
  let ring = null;
  if (fence.shape === FENCE_SHAPE.POLYGON) {
    ring = normalizePolygon(fence.polygon);
  } else if (
    Number.isFinite(fence.latitude) &&
    Number.isFinite(fence.longitude)
  ) {
    ring = makeCirclePolygon(
      fence.latitude,
      fence.longitude,
      Number.isFinite(fence.radius) ? fence.radius : DEFAULT_FENCE_RADIUS
    );
  }
  if (!ring || ring.length < FENCE_MIN_VERTICES) return null;
  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [ring] },
    properties: { id: fence.id, name: fence.name, ...props },
  };
}

/** 半径的人读格式 */
export function formatRadius(meters) {
  const m = Number(meters);
  if (!Number.isFinite(m)) return '—';
  if (m < 1000) return `${Math.round(m)} m`;
  const km = m / 1000;
  return `${Number.isInteger(km) ? km : km.toFixed(1)} km`;
}

/** 围栏摘要文案，用于卡片与聊天页提示 */
export function fenceSummary(fence) {
  if (!fence) return '未设置围栏';
  if (fence.shape === FENCE_SHAPE.POLYGON) {
    const ring = normalizePolygon(fence.polygon);
    const n = ring ? uniqueVertices(ring).length : 0;
    return `自定义区域 · ${n} 个顶点`;
  }
  return `半径 ${formatRadius(fence.radius ?? DEFAULT_FENCE_RADIUS)}`;
}
