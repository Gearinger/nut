import { create } from 'zustand'
import { supabase } from '../lib/supabase'

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
  fetchNotes: async (lat, lng, radius = 5000) => {
    // 先获取留言
    const { data: notesData, error } = await supabase
      .from('nut_messages')
      .select('*')
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
    // 获取当前用户未读的、非自己发送的消息
    const unreadMessages = currentMessages.filter(
      msg => msg.user_id !== userId && !(msg.read_by || []).includes(userId)
    )

    if (unreadMessages.length === 0) return

    // 批量更新已读状态
    for (const msg of unreadMessages) {
      const newReadBy = [...(msg.read_by || []), userId]
      await supabase
        .from('nut_chat_messages')
        .update({ read_by: newReadBy })
        .eq('id', msg.id)
    }

    // 重新获取消息以更新状态
    get().fetchMessages(roomId)
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
