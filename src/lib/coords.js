/**
 * 坐标系转换：WGS-84 <-> GCJ-02
 *
 * 为什么需要这个模块：
 * - 浏览器 navigator.geolocation（以及 iOS/Android 的 GPS）返回的是 **WGS-84**，
 *   这是国际通用的 GPS 原始坐标。
 * - 腾讯地图 / 高德 / 谷歌中国区底图使用的是 **GCJ-02**（俗称火星坐标），
 *   它是在 WGS-84 基础上加了非线性偏移的加密坐标系。
 * - 把 WGS-84 坐标直接画到 GCJ-02 底图上，会产生 **300~800 米** 的固定偏移，
 *   看起来就是"我的位置跟实际差了几个街区"。
 *
 * 项目约定（务必遵守）：
 *   1. 数据库存储、围栏判定、距离计算 —— 统一用 **WGS-84**（标准 GPS 坐标）
 *   2. 渲染到腾讯底图之前 —— 统一转换成 **GCJ-02**
 *   这样存储层保持标准，只有最后一步显示做适配。
 */

const PI = Math.PI
// 克拉索夫斯基椭球长半轴（GCJ-02 使用的椭球参数）
const A = 6378245.0
// 椭球偏心率的平方（双精度实际只能表示到约 17 位有效数字，多写会被静默截断）
const EE = 0.006693421622965943

/**
 * 严格转数字：只有真正的数字（或数字字符串）才返回数值，其余一律 NaN。
 *
 * ⚠️ 不能用 Number.isFinite(Number(v))：Number(null) === 0、Number('') === 0 都是 finite，
 * 会把「没有坐标」误判成「坐标是 (0,0)」——那可是大西洋上的一点，
 * 会导致留言/围栏全部跑到几内亚湾去。
 */
function toFiniteNum(v) {
  if (v === null || v === undefined || v === '') return NaN
  const n = Number(v)
  return Number.isFinite(n) ? n : NaN
}

/**
 * 判断是否在中国境外 —— 境外不做偏移（GCJ-02 只对中国境内加密）
 */
function outOfChina(lat, lng) {
  return !(lng > 72.004 && lng < 137.8347 && lat > 0.8293 && lat < 55.8271)
}

function transformLat(x, y) {
  let ret =
    -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x))
  ret += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0
  ret += ((20.0 * Math.sin(y * PI) + 40.0 * Math.sin((y / 3.0) * PI)) * 2.0) / 3.0
  ret += ((160.0 * Math.sin((y / 12.0) * PI) + 320.0 * Math.sin((y * PI) / 30.0)) * 2.0) / 3.0
  return ret
}

function transformLng(x, y) {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x))
  ret += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0
  ret += ((20.0 * Math.sin(x * PI) + 40.0 * Math.sin((x / 3.0) * PI)) * 2.0) / 3.0
  ret += ((150.0 * Math.sin((x / 12.0) * PI) + 300.0 * Math.sin((x / 30.0) * PI)) * 2.0) / 3.0
  return ret
}

/**
 * WGS-84 -> GCJ-02
 * @param {number} lat 纬度（WGS-84）
 * @param {number} lng 经度（WGS-84）
 * @returns {[number, number]} [lat, lng]（GCJ-02）
 */
export function wgs84ToGcj02(lat, lng) {
  const wLat = toFiniteNum(lat)
  const wLng = toFiniteNum(lng)
  if (!Number.isFinite(wLat) || !Number.isFinite(wLng)) return [NaN, NaN]
  if (outOfChina(wLat, wLng)) return [wLat, wLng]

  let dLat = transformLat(wLng - 105.0, wLat - 35.0)
  let dLng = transformLng(wLng - 105.0, wLat - 35.0)

  const radLat = (wLat / 180.0) * PI
  let magic = Math.sin(radLat)
  magic = 1 - EE * magic * magic
  const sqrtMagic = Math.sqrt(magic)

  dLat = (dLat * 180.0) / (((A * (1 - EE)) / (magic * sqrtMagic)) * PI)
  dLng = (dLng * 180.0) / ((A / sqrtMagic) * Math.cos(radLat) * PI)

  return [wLat + dLat, wLng + dLng]
}

/**
 * GCJ-02 -> WGS-84
 * 用两次迭代逼近：先按偏移量做一次反向估算，再用估算值重算偏移，精度可达厘米级。
 * @param {number} lat 纬度（GCJ-02）
 * @param {number} lng 经度（GCJ-02）
 * @returns {[number, number]} [lat, lng]（WGS-84）
 */
export function gcj02ToWgs84(lat, lng) {
  const gLat = toFiniteNum(lat)
  const gLng = toFiniteNum(lng)
  if (!Number.isFinite(gLat) || !Number.isFinite(gLng)) return [NaN, NaN]
  if (outOfChina(gLat, gLng)) return [gLat, gLng]

  // 第 0 次近似：偏移方向一致，直接减掉
  let [tLat, tLng] = wgs84ToGcj02(gLat, gLng)
  let wLat = gLat - (tLat - gLat)
  let wLng = gLng - (tLng - gLng)

  // 迭代 2 次收敛
  for (let i = 0; i < 2; i++) {
    ;[tLat, tLng] = wgs84ToGcj02(wLat, wLng)
    wLat = gLat - (tLat - wLat)
    wLng = gLng - (tLng - wLng)
  }
  return [wLat, wLng]
}

/**
 * 把 WGS-84 坐标转成渲染用的 GCJ-02。
 * 所有要画到腾讯底图上的点（留言、围栏、我的位置）都必须过这一层。
 */
export function toDisplayCoords(lat, lng) {
  return wgs84ToGcj02(lat, lng)
}

/**
 * 把整个 GeoJSON（Feature / FeatureCollection / Geometry）从 WGS-84 转成 GCJ-02。
 *
 * 围栏是 GeoJSON 结构，逐点手写转换很容易漏，统一在这里递归处理。
 * 支持 Point / LineString / Polygon / MultiPolygon 及对应的 Feature 包装。
 *
 * @template {object} T
 * @param {T} geojson
 * @returns {T} 新的对象，不修改入参
 */
export function geojsonToGcj02(geojson) {
  if (!geojson || typeof geojson !== 'object') return geojson

  if (geojson.type === 'FeatureCollection') {
    return {
      ...geojson,
      features: (geojson.features || []).map((f) => geojsonToGcj02(f)),
    }
  }

  if (geojson.type === 'Feature') {
    return { ...geojson, geometry: geojsonToGcj02(geojson.geometry) }
  }

  if (!geojson.type || !geojson.coordinates) return geojson

  const convert = (coords, type) => {
    switch (type) {
      case 'Point':
        return toDisplayLngLat(coords)
      case 'LineString':
      case 'MultiPoint':
        return coords.map((c) => convert(c, 'Point'))
      case 'Polygon':
        return coords.map((ring) => ring.map((c) => convert(c, 'Point')))
      case 'MultiLineString':
        return coords.map((line) => line.map((c) => convert(c, 'Point')))
      case 'MultiPolygon':
        return coords.map((poly) =>
          poly.map((ring) => ring.map((c) => convert(c, 'Point')))
        )
      default:
        return coords
    }
  }

  return { ...geojson, coordinates: convert(geojson.coordinates, geojson.type) }
}

/** GeoJSON 内部是 [lng, lat] 顺序，转回 [lng, lat] */
function toDisplayLngLat(position) {
  if (!Array.isArray(position) || position.length < 2) return position
  const [lng, lat] = position
  const [dLat, dLng] = wgs84ToGcj02(lat, lng)
  return [dLng, dLat, ...position.slice(2)]
}
