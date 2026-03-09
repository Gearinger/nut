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
    const { data, error } = await supabase
      .from('notes')
      .select('*, users(nickname, avatar_url)')
      .filter('lat', 'gte', lat - 0.05)
      .filter('lat', 'lte', lat + 0.05)
      .filter('lng', 'gte', lng - 0.05)
      .filter('lng', 'lte', lng + 0.05)
    if (!error && data) set({ notes: data })
  },
  
  // Rooms (聊天室)
  rooms: [],
  setRooms: (rooms) => set({ rooms }),
  fetchRooms: async (lat, lng) => {
    const { data, error } = await supabase
      .from('rooms')
      .select('*, users(nickname)')
      .filter('lat', 'gte', lat - 0.1)
      .filter('lat', 'lte', lat + 0.1)
    if (!error && data) set({ rooms: data })
  },
  
  // Messages
  messages: {},
  setMessages: (roomId, messages) => set({ messages: { ...get().messages, [roomId]: messages } }),
  fetchMessages: async (roomId) => {
    const { data, error } = await supabase
      .from('messages')
      .select('*, users(nickname, avatar_url)')
      .eq('room_id', roomId)
      .order('created_at', { ascending: true })
    if (!error && data) get().setMessages(roomId, data)
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
