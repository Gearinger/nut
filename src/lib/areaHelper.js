import { supabase } from './supabase'

// 根据位置获取或创建区域
// 默认区域半径为 1000 米
export async function getOrCreateArea(lat, lng, radius = 1000) {
  // 先查找附近是否有已存在的区域（简单的范围查询）
  const { data: existingAreas } = await supabase
    .from('nut_areas')
    .select('*')
    .gte('latitude', lat - 0.01)
    .lte('latitude', lat + 0.01)
    .gte('longitude', lng - 0.01)
    .lte('longitude', lng + 0.01)
    .limit(1)

  if (existingAreas && existingAreas.length > 0) {
    return existingAreas[0]
  }

  // 没有找到，创建新区域
  const areaName = `区域 ${lat.toFixed(2)}, ${lng.toFixed(2)}`
  const { data: newArea, error } = await supabase
    .from('nut_areas')
    .insert({
      name: areaName,
      latitude: lat,
      longitude: lng,
      radius_meters: radius
    })
    .select()
    .single()

  if (error) {
    console.error('创建区域失败:', error)
    return null
  }

  return newArea
}
