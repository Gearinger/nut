/**
 * maplibre 按需加载。
 *
 * 为什么要动态 import：maplibre-gl 打包后约 1MB，是这个应用体积的绝对大头。
 * 静态导入会让登录页（首屏）也必须把它下载完才能渲染——而登录页根本不用地图。
 * 改成按需加载后，未进入地图页的用户不再为地图买单。
 */
let maplibreglPromise = null

export function loadMaplibre() {
  if (!maplibreglPromise) {
    // 地图样式一起按需加载，避免首屏多背一份 CSS
    maplibreglPromise = Promise.all([
      import('maplibre-gl'),
      import('maplibre-gl/dist/maplibre-gl.css'),
    ]).then(([mod]) => mod.default || mod)
  }
  return maplibreglPromise
}

/**
 * 腾讯地图底图（栅格瓦片）
 *
 * 腾讯瓦片有两条私有规则，必须在这里消化掉：
 * 1. 行号是 TMS 方向（0 在最南端），而 maplibre 用 XYZ，需要 ry = 2^z - 1 - y
 * 2. 子域由 (x + ry) % 4 决定，用于分散请求压力
 *
 * 好消息是瓦片服务返回 `access-control-allow-origin: *`，浏览器可以直连，
 * 因此用 maplibre 的 addProtocol 在前端消化规则即可，不需要后端代理。
 *
 * ⚠️ 重要限制：腾讯返回的是服务端渲染好的 PNG，不是 MVT 矢量切片。
 * 所以底图样式只能用腾讯预设的 styleid，无法再自定义道路/水域配色。
 */

export const TMAP_BASEMAPS = [
  { id: 'standard', styleid: 3, label: '标准' },
  { id: 'simple', styleid: 1, label: '简洁' },
  { id: 'grey', styleid: 2, label: '灰色' },
  { id: 'blue', styleid: 4, label: '蓝色' },
]

export const DEFAULT_BASEMAP_ID = 'standard'

export const TMAP_SOURCE_ID = 'tmap-raster'

const PROTOCOL = 'tmap'
// tmap://{styleid}/{z}/{x}/{y}
const TILE_PATTERN = /^tmap:\/\/(\d+)\/(\d+)\/(\d+)\/(\d+)$/

/** 实测有效缩放区间为 3~18，z19 返回近乎空白的瓦片 */
export const TMAP_MAX_ZOOM = 18

export function buildTmapTileUrl(styleid, z, x, y) {
  const ry = 2 ** z - 1 - y
  const s = (x + ry) % 4
  return `https://rt${s}.map.gtimg.com/tile?z=${z}&x=${x}&y=${ry}&type=vector&styleid=${styleid}`
}

export function getBasemapStyleId(id) {
  return (TMAP_BASEMAPS.find((b) => b.id === id) || TMAP_BASEMAPS[0]).styleid
}

let registered = false

/**
 * 注册 tmap:// 协议，全局只需注册一次。
 * 需要 maplibre 的 addProtocol，所以变成异步。
 */
export async function registerTmapProtocol() {
  if (registered) return
  const maplibregl = await loadMaplibre()
  registered = true

  maplibregl.addProtocol(PROTOCOL, async (params, abortController) => {
    const m = TILE_PATTERN.exec(params.url)
    if (!m) {
      throw new Error(`非法的腾讯瓦片 URL: ${params.url}`)
    }
    const [, styleid, z, x, y] = m

    const res = await fetch(buildTmapTileUrl(+styleid, +z, +x, +y), {
      signal: abortController?.signal,
    })
    if (!res.ok) {
      throw new Error(`腾讯瓦片请求失败: HTTP ${res.status}`)
    }
    return { data: new Uint8Array(await res.arrayBuffer()) }
  })
}

/** 构造 maplibre style 对象（raster 源） */
export function buildTmapStyle(styleid) {
  return {
    version: 8,
    sources: {
      [TMAP_SOURCE_ID]: {
        type: 'raster',
        tiles: [`tmap://${styleid}/{z}/{x}/{y}`],
        tileSize: 256,
        maxzoom: TMAP_MAX_ZOOM,
        attribution: '© 腾讯地图',
      },
    },
    layers: [
      {
        id: 'tmap-background',
        type: 'background',
        paint: { 'background-color': '#eae8e4' },
      },
      {
        id: 'tmap-raster-layer',
        type: 'raster',
        source: TMAP_SOURCE_ID,
      },
    ],
  }
}
