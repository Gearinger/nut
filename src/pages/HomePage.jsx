import { useState, useEffect, useRef, useCallback } from 'react'
// maplibre 不再静态导入：体积约 1MB，登录页不该为它买单。
// 统一走 tmapBasemap 的 loadMaplibre() 按需加载。
import { useStore } from '../stores/useStore'
import { supabase } from '../lib/supabase'
import { getOrCreateArea } from '../lib/areaHelper'
import { checkWriteResult } from '../lib/dbError'
import NoteCard from '../components/NoteCard'
import RoomCard from '../components/RoomCard'
import WriteNoteModal from '../components/WriteNoteModal'
import FenceEditor from '../components/FenceEditor'
import {
  TMAP_BASEMAPS,
  DEFAULT_BASEMAP_ID,
  TMAP_SOURCE_ID,
  TMAP_MAX_ZOOM,
  registerTmapProtocol,
  buildTmapStyle,
  getBasemapStyleId,
  loadMaplibre,
} from '../lib/tmapBasemap'
import {
  FENCE_SHAPE,
  DEFAULT_FENCE_RADIUS,
  FENCE_MIN_RADIUS,
  FENCE_MAX_RADIUS,
  FENCE_MAX_VERTICES,
  calculateDistance,
  makeCirclePolygon,
  polygonCentroid,
  fenceToGeoJSON,
  fenceBoundingRadius,
  clampFenceRadius,
  offsetPoint,
  canInteractInFence,
  fenceSummary,
} from '../lib/fence'
import { wgs84ToGcj02, gcj02ToWgs84, geojsonToGcj02 } from '../lib/coords'

// 附近留言最多展示几条（超出在标题旁说明，不再默默截断——
// 标题写 5 条、列表只渲染 3 条这种数字对不上最容易让人以为数据丢了）。
// 10 是为了「热闹」：附近只摊开 5 条时，地图上明明有一片气泡，
// 列表却只有寥寥几条，看着像没数据。改回 5 只需改这一个常量。
const NEARBY_NOTE_LIMIT = 10

// 按需加载后的 maplibre 模块。地图初始化完成后才有值。
// 用模块级变量而不是 state：Marker / Popup 是在各个 effect 里同步构造的，
// 走 state 会引入一帧延迟，也容易触发额外重渲染。
let maplibregl = null

// 留言内容由用户输入，popup 用 setHTML 渲染前必须转义，避免 XSS
const escapeHtml = (str) =>
  String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]))

const EMPTY_FC = { type: 'FeatureCollection', features: [] }
const FENCE_DRAFT_SOURCE = 'fence-draft'
const ROOM_FENCE_SOURCE = 'room-fences'

const clamp = (v, min, max) => Math.min(Math.max(v, min), max)

/** 补齐闭合点，供 GeoJSON Polygon 使用 */
const closeRing = (pts) => {
  const ring = (pts || []).slice()
  if (ring.length === 0) return ring
  const first = ring[0]
  const last = ring[ring.length - 1]
  if (first[0] !== last[0] || first[1] !== last[1]) {
    ring.push([first[0], first[1]])
  }
  return ring
}

/** 草稿围栏转 GeoJSON：顶点不足 3 个时退化为折线，避免渲染出非法 Polygon */
function buildDraftGeoJSON(draft) {
  if (!draft) return EMPTY_FC
  if (draft.shape === FENCE_SHAPE.POLYGON) {
    const pts = draft.polygon || []
    if (pts.length >= 3) {
      return {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {},
            geometry: { type: 'Polygon', coordinates: [closeRing(pts)] },
          },
        ],
      }
    }
    if (pts.length >= 2) {
      return {
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pts } },
        ],
      }
    }
    return EMPTY_FC
  }
  if (!Number.isFinite(draft.latitude) || !Number.isFinite(draft.longitude)) return EMPTY_FC
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'Polygon',
          coordinates: [
            makeCirclePolygon(
              draft.latitude,
              draft.longitude,
              draft.radius ?? DEFAULT_FENCE_RADIUS
            ),
          ],
        },
      },
    ],
  }
}

export default function HomePage() {
  const {
    user,
    currentLocation, setCurrentLocation,
    notes, rooms, setActiveTab, setActiveRoom,
    fetchNotes, fetchRooms
  } = useStore()
  
  const mapContainer = useRef(null)
  const map = useRef(null)
  const noteMarkersRef = useRef([])
  const meMarkerRef = useRef(null)
  const [mapReady, setMapReady] = useState(false)
  const [viewState, setViewState] = useState({
    latitude: 31.2304,
    longitude: 121.4737,
    zoom: 14
  })
  const [showWriteModal, setShowWriteModal] = useState(false)
  const [basemapId, setBasemapId] = useState(DEFAULT_BASEMAP_ID)
  const [showBasemapPicker, setShowBasemapPicker] = useState(false)
  // 定位状态：'locating' | 'ok' | 'failed'，失败时把原因透出给用户，不再静默落到默认城市
  const [locateStatus, setLocateStatus] = useState('locating')
  const [locateError, setLocateError] = useState('')
  // 定位成功后只跳一次视野，避免用户手动拖动地图后被反复拉回
  const hasCenteredRef = useRef(false)
  // 定位成功后自增，用于触发"把地图飞到当前位置"的 effect
  const [locateSeq, setLocateSeq] = useState(0)

  // 围栏草稿：null 表示编辑器未打开
  const [fenceDraft, setFenceDraft] = useState(null)
  const [creatingRoom, setCreatingRoom] = useState(false)
  // 拖拽手柄期间不能反向写回手柄位置，否则会与拖拽手势打架
  const draggingRef = useRef(false)
  const draftRef = useRef(null)
  const vertexMarkersRef = useRef([])
  const centerMarkerRef = useRef(null)
  const radiusMarkerRef = useRef(null)

  useEffect(() => {
    draftRef.current = fenceDraft
  }, [fenceDraft])

  // Initialize map
  // WebGL 不可用（虚拟机 / 远程桌面 / 显卡驱动被禁）时 maplibre 会直接 throw，
  // 不兜底的话异常冒泡导致 React 整树卸载 → 白屏。降级为无地图模式，功能仍可用。
  const [mapFailed, setMapFailed] = useState(false)
  // 地图加载中：按需 import 有网络往返，不能让用户盯着一块空白
  const [mapLoading, setMapLoading] = useState(true)

  useEffect(() => {
    if (map.current || mapFailed) return
    let cancelled = false
    let mapInstance

    const boot = async () => {
      // 注册 tmap:// 协议，消化腾讯瓦片的 TMS 行号翻转规则
      await registerTmapProtocol()
      // 按需加载 maplibre（约 1MB），加载失败也要给明确反馈而不是白屏
      try {
        maplibregl = await loadMaplibre()
      } catch (err) {
        console.warn('地图库加载失败，降级为无地图模式:', err)
        if (!cancelled) {
          setMapFailed(true)
          setMapLoading(false)
        }
        return
      }
      if (cancelled) return

      try {
        mapInstance = new maplibregl.Map({
          container: mapContainer.current,
          style: buildTmapStyle(getBasemapStyleId(DEFAULT_BASEMAP_ID)),
          center: [viewState.longitude, viewState.latitude],
          zoom: viewState.zoom,
          maxZoom: TMAP_MAX_ZOOM,
        })
      } catch (err) {
        // 典型报错：webglcontextcreationerror / Failed to initialize WebGL
        console.warn('地图初始化失败，降级为无地图模式:', err)
        if (!cancelled) {
          setMapFailed(true)
          setMapLoading(false)
        }
        return
      }
      if (cancelled) {
        // 组件已卸载：立刻销毁，避免残留 WebGL context
        mapInstance.remove()
        return
      }

      map.current = mapInstance
      setMapLoading(false)

      mapInstance.on('load', () => setMapReady(true))

      // 用 moveend 而非 move：move 每帧都触发 setState，会导致整页高频重渲染
      mapInstance.on('moveend', () => {
        setViewState({
          latitude: mapInstance.getCenter().lat,
          longitude: mapInstance.getCenter().lng,
          zoom: mapInstance.getZoom(),
        })
      })
    }

    boot()

    // 必须销毁地图实例，否则切换 tab 反复挂载会累积 WebGL context 直至地图黑屏
    return () => {
      cancelled = true
      if (mapInstance) mapInstance.remove()
      map.current = null
      setMapReady(false)
      // 地图重建后要允许再次居中，否则切回首页时视野会退回初始的默认城市
      hasCenteredRef.current = false
    }
  }, [])

  // 请求一次定位。抽成 useCallback 是因为「重新定位」按钮也要复用这段逻辑
  const requestLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setLocateStatus('failed')
      setLocateError('当前浏览器不支持定位')
      return
    }

    setLocateStatus('locating')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords
        setCurrentLocation({ lat: latitude, lng: longitude })
        setLocateStatus('ok')
        setLocateError('')
        // 自增触发 flyTo effect，而不是在这里直接调 flyTo：
        // 这里执行时地图 style 往往还没加载完，此时 flyTo 会被 maplibre 静默丢弃，
        // 结果就是地图永远停在初始的默认城市（上海）——这正是"我在武汉却显示上海"的根因
        setLocateSeq((n) => n + 1)
      },
      (err) => {
        // 不再静默回落到默认城市：那样用户会身处一个完全陌生的城市而不自知
        setLocateStatus('failed')
        const reason =
          {
            1: '定位权限被拒绝，请点击地址栏左侧的权限图标允许定位',
            2: '无法获取位置（可能缺少 GPS / WiFi 信号）',
            3: '定位超时',
          }[err.code] || err.message || '定位失败'
        setLocateError(reason)
        console.warn('定位失败:', err.code, err.message)
      },
      {
        // 首次定位在 macOS 上常常要 5~10 秒，5s 太短会直接超时
        timeout: 15000,
        maximumAge: 30000,
        enableHighAccuracy: true,
      }
    )
  }, [setCurrentLocation])

  // Get current location
  useEffect(() => {
    requestLocation()
  }, [requestLocation])

  // 定位成功 + 地图就绪 之后再把视野飞过去。
  // 两个条件缺一不可：地图没 ready 时 flyTo 无效，位置没拿到时没有目标。
  useEffect(() => {
    if (!mapReady || !currentLocation || !map.current) return
    if (hasCenteredRef.current) return
    hasCenteredRef.current = true
    const [dLat, dLng] = wgs84ToGcj02(currentLocation.lat, currentLocation.lng)
    map.current.flyTo({ center: [dLng, dLat], zoom: 15 })
  }, [mapReady, currentLocation, locateSeq])

  // 在地图上打点：附近留言 + 我的位置
  useEffect(() => {
    const mapInstance = map.current
    if (!mapInstance || !mapReady) return

    notes.forEach((note) => {
      const lat = Number(note.latitude)
      const lng = Number(note.longitude)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return

      // 数据库存的是 WGS-84，底图是 GCJ-02，画之前必须转换，否则会有 300~800m 偏移
      const [dLat, dLng] = wgs84ToGcj02(lat, lng)

      const el = document.createElement('div')
      el.className = 'map-marker note-marker'
      el.textContent = '📝'

      const popup = new maplibregl.Popup({ offset: 24, closeButton: false }).setHTML(
        `<div class="map-popup"><span class="popup-author">${escapeHtml(note.nut_users?.username || '匿名')}</span><p>${escapeHtml(note.content || '')}</p></div>`
      )

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([dLng, dLat])
        .setPopup(popup)
        .addTo(mapInstance)

      noteMarkersRef.current.push(marker)
    })

    if (currentLocation) {
      const [dLat, dLng] = wgs84ToGcj02(currentLocation.lat, currentLocation.lng)
      const el = document.createElement('div')
      el.className = 'map-marker me-marker'
      meMarkerRef.current = new maplibregl.Marker({ element: el })
        .setLngLat([dLng, dLat])
        .addTo(mapInstance)
    }

    return () => {
      noteMarkersRef.current.forEach((m) => {
        try { m.remove() } catch { /* 地图实例已销毁时忽略 */ }
      })
      noteMarkersRef.current = []
      try { meMarkerRef.current?.remove() } catch { /* 同上 */ }
      meMarkerRef.current = null
    }
  }, [notes, currentLocation, mapReady])

  // 已有聊天室的围栏：让用户看到附近划定了哪些区域
  useEffect(() => {
    const mapInstance = map.current
    if (!mapInstance || !mapReady) return

    if (!mapInstance.getSource(ROOM_FENCE_SOURCE)) {
      mapInstance.addSource(ROOM_FENCE_SOURCE, { type: 'geojson', data: EMPTY_FC })
      mapInstance.addLayer({
        id: 'room-fences-fill',
        type: 'fill',
        source: ROOM_FENCE_SOURCE,
        paint: { 'fill-color': '#0F6E56', 'fill-opacity': 0.1 },
      })
      mapInstance.addLayer({
        id: 'room-fences-line',
        type: 'line',
        source: ROOM_FENCE_SOURCE,
        paint: {
          'line-color': '#0F6E56',
          'line-width': 1.5,
          'line-dasharray': [3, 2],
        },
      })
    }

    // 围栏几何存的是 WGS-84，渲染到腾讯底图前整体转 GCJ-02
    const features = rooms.map((room) => fenceToGeoJSON(room)).filter(Boolean)
    mapInstance.getSource(ROOM_FENCE_SOURCE).setData(
      geojsonToGcj02({ type: 'FeatureCollection', features })
    )
  }, [rooms, mapReady])

  // 草稿围栏：实时反映编辑器里的形状
  useEffect(() => {
    const mapInstance = map.current
    if (!mapInstance || !mapReady) return

    if (!mapInstance.getSource(FENCE_DRAFT_SOURCE)) {
      mapInstance.addSource(FENCE_DRAFT_SOURCE, { type: 'geojson', data: EMPTY_FC })
      mapInstance.addLayer({
        id: 'fence-draft-fill',
        type: 'fill',
        source: FENCE_DRAFT_SOURCE,
        paint: { 'fill-color': '#534AB7', 'fill-opacity': 0.16 },
      })
      mapInstance.addLayer({
        id: 'fence-draft-line',
        type: 'line',
        source: FENCE_DRAFT_SOURCE,
        paint: {
          'line-color': '#534AB7',
          'line-width': 2,
          'line-dasharray': [2, 1.5],
        },
      })
    }

    mapInstance
      .getSource(FENCE_DRAFT_SOURCE)
      .setData(geojsonToGcj02(buildDraftGeoJSON(fenceDraft)))
  }, [fenceDraft, mapReady])

  // 圆形围栏：中心与半径都可拖拽
  // 依赖只取 shape，不取 lat/lng/radius——否则拖动过程中 effect 重跑会重建 marker，手势直接断掉
  useEffect(() => {
    const mapInstance = map.current
    const draft = draftRef.current
    if (!mapInstance || !mapReady || !draft || draft.shape !== FENCE_SHAPE.CIRCLE) return

    // draft 里存的是 WGS-84（写库用），marker 要画在 GCJ-02 底图上，所以进出都要转
    const [cLat, cLng] = wgs84ToGcj02(draft.latitude, draft.longitude)
    const centerEl = document.createElement('div')
    centerEl.className = 'fence-handle fence-handle-center'
    const centerMarker = new maplibregl.Marker({ element: centerEl, draggable: true })
      .setLngLat([cLng, cLat])
      .addTo(mapInstance)
    centerMarkerRef.current = centerMarker

    centerMarker.on('dragstart', () => { draggingRef.current = true })
    centerMarker.on('drag', () => {
      const p = centerMarker.getLngLat()
      // 拖出来的是底图坐标（GCJ-02），转回 WGS-84 再存
      const [wLat, wLng] = gcj02ToWgs84(p.lat, p.lng)
      setFenceDraft((d) =>
        d && d.shape === FENCE_SHAPE.CIRCLE ? { ...d, latitude: wLat, longitude: wLng } : d
      )
    })
    centerMarker.on('dragend', () => { draggingRef.current = false })

    const [hLng, hLat] = offsetPoint(draft.latitude, draft.longitude, 0, draft.radius ?? DEFAULT_FENCE_RADIUS)
    const [dLatH, dLngH] = wgs84ToGcj02(hLat, hLng)
    const handleEl = document.createElement('div')
    handleEl.className = 'fence-handle fence-handle-radius'
    const radiusMarker = new maplibregl.Marker({ element: handleEl, draggable: true })
      .setLngLat([dLngH, dLatH])
      .addTo(mapInstance)
    radiusMarkerRef.current = radiusMarker

    radiusMarker.on('dragstart', () => { draggingRef.current = true })
    radiusMarker.on('drag', () => {
      const p = radiusMarker.getLngLat()
      const c = draftRef.current
      if (!c || !Number.isFinite(c.latitude) || !Number.isFinite(c.longitude)) return
      // 半径是真实距离，两端必须放在同一个坐标系里算，这里统一转回 WGS-84
      const [wLat, wLng] = gcj02ToWgs84(p.lat, p.lng)
      const r = clamp(
        calculateDistance(c.latitude, c.longitude, wLat, wLng),
        FENCE_MIN_RADIUS,
        FENCE_MAX_RADIUS
      )
      setFenceDraft((d) =>
        d && d.shape === FENCE_SHAPE.CIRCLE ? { ...d, radius: Math.round(r) } : d
      )
    })
    radiusMarker.on('dragend', () => { draggingRef.current = false })

    return () => {
      try { centerMarker.remove() } catch { /* 地图已销毁 */ }
      try { radiusMarker.remove() } catch { /* 同上 */ }
      centerMarkerRef.current = null
      radiusMarkerRef.current = null
    }
  }, [mapReady, fenceDraft?.shape])

  // 手柄位置跟随半径/中心变化（拖拽期间跳过，避免与手势冲突）
  useEffect(() => {
    if (draggingRef.current || fenceDraft?.shape !== FENCE_SHAPE.CIRCLE) return
    const [lng, lat] = offsetPoint(
      fenceDraft.latitude,
      fenceDraft.longitude,
      0,
      fenceDraft.radius ?? DEFAULT_FENCE_RADIUS
    )
    const [dLatH, dLngH] = wgs84ToGcj02(lat, lng)
    const [dLatC, dLngC] = wgs84ToGcj02(fenceDraft.latitude, fenceDraft.longitude)
    radiusMarkerRef.current?.setLngLat([dLngH, dLatH])
    centerMarkerRef.current?.setLngLat([dLngC, dLatC])
  }, [fenceDraft?.radius, fenceDraft?.latitude, fenceDraft?.longitude, fenceDraft?.shape])

  // 多边形围栏：点击地图逐点添加
  useEffect(() => {
    const mapInstance = map.current
    if (!mapInstance || !mapReady || fenceDraft?.shape !== FENCE_SHAPE.POLYGON) return

    const onClick = (e) => {
      // 点击拿到的是底图坐标（GCJ-02），存成 WGS-84
      const [wLat, wLng] = gcj02ToWgs84(e.lngLat.lat, e.lngLat.lng)
      setFenceDraft((d) => {
        if (!d || d.shape !== FENCE_SHAPE.POLYGON) return d
        const pts = d.polygon || []
        if (pts.length >= FENCE_MAX_VERTICES) return d
        return { ...d, polygon: [...pts, [wLng, wLat]] }
      })
    }

    mapInstance.on('click', onClick)
    const canvas = mapInstance.getCanvas()
    canvas.style.cursor = 'crosshair'

    return () => {
      mapInstance.off('click', onClick)
      canvas.style.cursor = ''
    }
  }, [mapReady, fenceDraft?.shape])

  // 多边形顶点编号
  useEffect(() => {
    const mapInstance = map.current
    if (!mapInstance || !mapReady || fenceDraft?.shape !== FENCE_SHAPE.POLYGON) return

    const markers = (fenceDraft.polygon || []).map(([lng, lat], i) => {
      const [dLat, dLng] = wgs84ToGcj02(lat, lng)
      const el = document.createElement('div')
      el.className = 'fence-vertex'
      el.textContent = String(i + 1)
      return new maplibregl.Marker({ element: el }).setLngLat([dLng, dLat]).addTo(mapInstance)
    })
    vertexMarkersRef.current = markers

    return () => {
      markers.forEach((m) => {
        try { m.remove() } catch { /* 地图已销毁 */ }
      })
      vertexMarkersRef.current = []
    }
  }, [mapReady, fenceDraft?.shape, fenceDraft?.polygon])

  // 切换底图：只换 source 的瓦片模板，不重建 style，避免影响已添加的 marker
  const handleSwitchBasemap = (id) => {
    setBasemapId(id)
    setShowBasemapPicker(false)

    const source = map.current?.getSource(TMAP_SOURCE_ID)
    if (source?.setTiles) {
      source.setTiles([`tmap://${getBasemapStyleId(id)}/{z}/{x}/{y}`])
    }
  }

  // 当前位置是否落在某个聊天室的围栏内
  // 用 canInteractInFence 而非 isInsideFence：迁移前创建的房间没有围栏字段，
  // 严格判定会让它们全部显示成「超出围栏」
  const isInsideRoomFence = (room) =>
    canInteractInFence(currentLocation?.lat, currentLocation?.lng, room)

  // 进入聊天室：不在围栏内也允许进入，但为只读（由 ChatPage 置灰并禁用输入）
  const handleJoinRoom = (room) => {
    setActiveRoom(room)
    setActiveTab('chat')
  }

  // 打开围栏编辑器：以当前位置为圆心初始化一个圆形围栏
  const openFenceEditor = () => {
    let lat = currentLocation?.lat
    let lng = currentLocation?.lng
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      // 兜底用地图视野中心，但 getCenter() 返回的是底图坐标（GCJ-02），要转回 WGS-84
      ;[lat, lng] = gcj02ToWgs84(viewState.latitude, viewState.longitude)
    }
    setFenceDraft({
      shape: FENCE_SHAPE.CIRCLE,
      latitude: lat,
      longitude: lng,
      radius: DEFAULT_FENCE_RADIUS,
      polygon: null,
    })
  }

  const closeFenceEditor = () => setFenceDraft(null)

  const handleCreateRoom = async ({ name, fence }) => {
    if (!user) {
      alert('请先登录')
      return
    }
    setCreatingRoom(true)
    try {
      const isPolygon = fence.shape === FENCE_SHAPE.POLYGON
      const ring = isPolygon ? closeRing(fence.polygon || []) : null
      if (isPolygon && (!ring || ring.length < 4)) {
        alert('手绘围栏至少需要 3 个顶点')
        return
      }

      // 多边形的中心取质心，否则中心点可能落在围栏之外
      let latitude = fence.latitude
      let longitude = fence.longitude
      if (isPolygon) {
        const centroid = polygonCentroid(ring)
        if (!centroid) {
          alert('围栏顶点无效，请重新绘制')
          return
        }
        longitude = centroid[0]
        latitude = centroid[1]
      }

      const normalized = { ...fence, latitude, longitude, polygon: ring }
      const payload = {
        created_by: user.id,
        name,
        latitude,
        longitude,
        radius: isPolygon
          ? clampFenceRadius(fenceBoundingRadius(normalized))
          : clampFenceRadius(fence.radius),
        shape: fence.shape,
        polygon: ring,
      }

      // nut_chats.area_id 是 NOT NULL，仍需挂一个区域
      const area = await getOrCreateArea(latitude, longitude)
      if (!area) {
        alert(
          '无法获取区域信息：nut_areas 查询或写入失败。\n' +
            '常见原因是该表未对当前账号开放写入（RLS），请检查 insert 策略。'
        )
        return
      }
      payload.area_id = area.id

      const result = await supabase
        .from('nut_chats')
        .insert(payload)
        .select()
        .single()

      // 统一走结果校验：不只看 error，也确认真的取回了写入的行
      const failure = checkWriteResult(result, '创建')
      if (failure) {
        alert(failure)
        return
      }

      closeFenceEditor()
      setActiveRoom(result.data)
      setActiveTab('chat')
      fetchRooms()
    } finally {
      setCreatingRoom(false)
    }
  }

  const handleRefreshNotes = () => {
    if (currentLocation) {
      fetchNotes(currentLocation.lat, currentLocation.lng)
    }
  }

  return (
    <div className="home-page">
      {/* 地图区域：底图切换与 FAB 相对它定位。
          在 PC 分栏布局下这些浮层会自动留在地图内，不会跑到侧边栏上。 */}
      <div className="map-area">
        <div className="map-container" ref={mapContainer} />

        {/* 地图库按需加载中：1MB 的 chunk 有网络往返，不能让用户盯着一块空白 */}
        {mapLoading && !mapFailed && (
          <div className="map-loading">
            <span className="loading" role="status">地图加载中…</span>
          </div>
        )}

        {/* WebGL 不可用的降级提示：不白屏，告知用户功能仍在 */}
        {mapFailed && (
          <div className="locate-banner locate-error">
            <span className="locate-icon">🗺️</span>
            <span className="locate-text">
              当前环境不支持 WebGL，地图无法显示（常见于虚拟机 / 远程桌面）。下方的留言与聊天室列表不受影响，仍可正常使用。
            </span>
            <button className="locate-retry" onClick={() => window.location.reload()}>
              重试
            </button>
          </div>
        )}

        {/* 定位状态：定位失败时明确告知原因并给重试入口。
            之前失败会静默回落到默认城市，用户会身处陌生城市而不自知。 */}
        {locateStatus !== 'ok' && (
          <div className={`locate-banner locate-${locateStatus}`}>
            {locateStatus === 'locating' ? (
              <>
                <span className="locate-spinner" />
                正在定位…
              </>
            ) : (
              <>
                <span className="locate-icon">⚠️</span>
                <span className="locate-text">{locateError}</span>
                <button
                  className="locate-retry"
                  onClick={() => {
                    hasCenteredRef.current = false
                    requestLocation()
                  }}
                >
                  重新定位
                </button>
              </>
            )}
          </div>
        )}

        {/* 底图切换（腾讯地图预设风格） */}
        <div className="basemap-switcher">
          <button
            className="basemap-toggle"
            onClick={() => setShowBasemapPicker((v) => !v)}
          >
            🗺️ {TMAP_BASEMAPS.find((b) => b.id === basemapId)?.label || '底图'}
          </button>
          {showBasemapPicker && (
            <div className="basemap-menu">
              {TMAP_BASEMAPS.map((b) => (
                <button
                  key={b.id}
                  className={`basemap-option${b.id === basemapId ? ' active' : ''}`}
                  onClick={() => handleSwitchBasemap(b.id)}
                >
                  {b.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* FAB buttons：绘制围栏时让位给编辑器面板 */}
        {!fenceDraft && (
          <>
            <button className="fab note-fab" onClick={() => setShowWriteModal(true)}>
              📝
            </button>
            <button className="fab room-fab" onClick={openFenceEditor}>
              💬
            </button>
          </>
        )}

        {/* 围栏编辑器：贴在地图底部，PC 分栏下也不会越界 */}
        {fenceDraft && (
          <FenceEditor
            draft={fenceDraft}
            onChange={setFenceDraft}
            onSubmit={handleCreateRoom}
            onClose={closeFenceEditor}
            loading={creatingRoom}
          />
        )}
      </div>

      {/* Bottom sheets */}
      <div className="bottom-sheet">
        <div className="nearby-list">
          {/* 标题数字必须等于实际渲染条数：被截断时明确写出来，
              不能出现「标题 5 条、列表只有 3 条」这种对不上的情况 */}
          <div className="sheet-section-header">
            <h3>📝 附近留言 ({Math.min(notes.length, NEARBY_NOTE_LIMIT)})</h3>
            {notes.length > NEARBY_NOTE_LIMIT && (
              <span className="list-hint">共 {notes.length} 条，显示最新 {NEARBY_NOTE_LIMIT} 条</span>
            )}
          </div>
          <div className="notes-list">
            {notes
              .slice()
              .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
              .slice(0, NEARBY_NOTE_LIMIT)
              .map(note => (
                <NoteCard key={note.id} note={note} onRefresh={handleRefreshNotes} />
              ))}
          </div>

          <div className="sheet-section-header">
            <h3>💬 热门聊天 ({rooms.length})</h3>
            {/* 横向滚动在触屏上不明显，给一句可见提示（PC 下改成纵向堆叠，这句由 CSS 隐藏） */}
            {rooms.length > 1 && (
              <span className="list-hint swipe-hint">滑动查看全部 {rooms.length} 个 →</span>
            )}
          </div>
          <div className="rooms-scroll">
            {rooms.length === 0 ? (
              <p className="empty">附近还没有聊天室，点地图画一个吧</p>
            ) : (
              rooms.map(room => (
                <RoomCard
                  key={room.id}
                  room={room}
                  onJoin={handleJoinRoom}
                  insideFence={isInsideRoomFence(room)}
                  fenceText={fenceSummary(room)}
                />
              ))
            )}
          </div>
        </div>
      </div>

      {/* Modals */}
      {showWriteModal && (
        <WriteNoteModal 
          location={currentLocation} 
          onClose={() => setShowWriteModal(false)}
          onSuccess={handleRefreshNotes}
        />
      )}
    </div>
  )
}
