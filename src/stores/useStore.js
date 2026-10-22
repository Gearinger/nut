import { create } from 'zustand'
import { supabase } from '../lib/supabase'

// 正在标记已读的房间，防止轮询与实时消息同时触发重复写
const pendingReadMarks = new Set()

export const useStore = create((set, get) => ({
  // User
  user: null,
  setUser: (user) => set({ user }),
  
  // Location
  currentLocation: null,
  setCurrentLocation: (location) => set({ currentLocation: location }),
  
  // Notes (位置留言)
  notes: [],
  setNotes: (notes) => set({ notes }),
  fetchNotes: async (lat, lng) => {
    // 先获取留言（只取未过期的：expires_at 为空或晚于当前时间）
    const { data: notesData, error } = await supabase
      .from('nut_messages')
      .select('*')
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
      .filter('latitude', 'gte', lat - 0.05)
      .filter('latitude', 'lte', lat + 0.05)
      .filter('longitude', 'gte', lng - 0.05)
      .filter('longitude', 'lte', lng + 0.05)

    if (error || !notesData) return

    // 获取所有相关用户的信息
    const userIds = [...new Set(notesData.map(n => n.user_id).filter(Boolean))]
    let usersMap = {}

    if (userIds.length > 0) {
      const { data: usersData } = await supabase
        .from('nut_users')
        .select('id, username, avatar_url')
        .in('id', userIds)

      usersData?.forEach(u => { usersMap[u.id] = u })
    }

    // 获取回复
    const noteIds = notesData.map(n => n.id)
    let repliesMap = {}

    if (noteIds.length > 0) {
      const { data: repliesData } = await supabase
        .from('nut_message_replies')
        .select('*')
        .in('message_id', noteIds)
        .order('created_at', { ascending: true })

      if (repliesData && repliesData.length > 0) {
        // 获取回复者的用户信息
        const replyUserIds = [...new Set(repliesData.map(r => r.user_id).filter(Boolean))]
        let replyUsersMap = {}
        
        if (replyUserIds.length > 0) {
          const { data: replyUsersData } = await supabase
            .from('nut_users')
            .select('id, username')
            .in('id', replyUserIds)
          
          replyUsersData?.forEach(u => { replyUsersMap[u.id] = u })
        }
        
        repliesData.forEach(r => {
          if (!repliesMap[r.message_id]) repliesMap[r.message_id] = []
          repliesMap[r.message_id].push({
            ...r,
            nut_users: replyUsersMap[r.user_id] || { username: '匿名' }
          })
        })
      }
    }

    // 合并用户信息和回复到留言
    const enrichedNotes = notesData.map(note => ({
      ...note,
      nut_users: usersMap[note.user_id] || { username: '匿名' },
      replies: repliesMap[note.id] || []
    }))

    set({ notes: enrichedNotes })
  },
  
  // Rooms (聊天室)
  rooms: [],
  myRooms: [],
  setRooms: (rooms) => set({ rooms }),
  fetchRooms: async () => {
    const { data, error } = await supabase
      .from('nut_chats')
      .select('*, nut_users(username)')
      .eq('is_active', true)
    if (!error && data) set({ rooms: data })
  },
  // 获取用户已发言的聊天室
  fetchMyRooms: async (userId) => {
    if (!userId) return
    
    // 先获取用户发过消息的聊天室ID
    const { data: messagesData } = await supabase
      .from('nut_chat_messages')
      .select('chat_id')
      .eq('user_id', userId)
    
    if (!messagesData || messagesData.length === 0) {
      set({ myRooms: [] })
      return
    }
    
    const chatIds = [...new Set(messagesData.map(m => m.chat_id))]
    
    // 获取这些聊天室的信息
    const { data: roomsData } = await supabase
      .from('nut_chats')
      .select('*, nut_users(username)')
      .in('id', chatIds)
      .eq('is_active', true)
    
    set({ myRooms: roomsData || [] })
  },
  
  // Messages
  messages: {},
  setMessages: (roomId, messages) => set({ messages: { ...get().messages, [roomId]: messages } }),
  fetchMessages: async (roomId) => {
    // 先获取消息
    const { data: messagesData, error } = await supabase
      .from('nut_chat_messages')
      .select('*')
      .eq('chat_id', roomId)
      .order('created_at', { ascending: true })

    if (error || !messagesData) return

    // 获取所有相关用户的信息
    const userIds = [...new Set(messagesData.map(m => m.user_id))]
    const { data: usersData } = await supabase
      .from('nut_users')
      .select('id, username, avatar_url')
      .in('id', userIds)

    // 合并用户信息到消息
    const usersMap = {}
    usersData?.forEach(u => { usersMap[u.id] = u })

    const enrichedMessages = messagesData.map(msg => ({
      ...msg,
      nut_users: usersMap[msg.user_id] || { username: '未知用户' }
    }))

    get().setMessages(roomId, enrichedMessages)
  },

  // 标记消息为已读
  markMessagesAsRead: async (roomId, userId) => {
    const currentMessages = get().messages[roomId] || []
    // 没有未读消息就什么都不做，避免每轮轮询都空跑一次写库
    const hasUnread = currentMessages.some(
      msg => msg.user_id !== userId && !(msg.read_by || []).includes(userId)
    )

    if (!hasUnread) return

    // 同一个房间同时只跑一个已读请求：轮询 + 消息到达都会触发，
    // 并发写会把同一批消息标记两次（这个写操作是幂等的，但没必要空跑）
    if (pendingReadMarks.has(roomId)) return
    pendingReadMarks.add(roomId)

    // 服务端用 RPC 一次性追加 read_by，避免未读多少条就发多少次请求
    let data, error
    try {
      const res = await supabase.rpc('mark_room_messages_read', {
        p_chat_id: roomId,
        p_user_id: userId,
      })
      data = res.data
      error = res.error
    } finally {
      pendingReadMarks.delete(roomId)
    }

    if (error || !data) return

    // 本地直接合并变更，省掉一次全量重拉
    const updatedIds = new Set(data.map(row => row.id))
    const nextMessages = currentMessages.map(msg =>
      updatedIds.has(msg.id)
        ? { ...msg, read_by: [...(msg.read_by || []), userId] }
        : msg
    )
    get().setMessages(roomId, nextMessages)
  },
  
  // Active room
  activeRoom: null,
  setActiveRoom: (room) => set({ activeRoom: room }),
  
  // UI State
  activeTab: 'home', // home | chat | profile
  setActiveTab: (tab) => set({ activeTab: tab }),
  
  // Auth
  signOut: async () => {
    await supabase.auth.signOut()
    set({ user: null })
  }
}))
