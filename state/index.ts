import { Message } from 'ai'
import { create } from 'zustand'
import { getChats } from '../actions/get-chats'

type AppState = {
  chat:
    | {
        id: string
        name: string
        messages: Message[]
      }
    | null
    | undefined
  chats: {
    id: string
    name: string
    created_at: string
  }[]
  setChats: (chats: AppState['chats']) => void
  setChat: (chat: AppState['chat']) => void
  updateChats: () => Promise<void>
  clearChat: () => void
  getChat: (id: string) => AppState['chat']
}

export const useAppState = create<AppState>((set, get) => ({
  chat: undefined,
  chats: [],
  setChats: (chats) => set({ chats }),
  setChat: (chat) => set({ chat }),
  updateChats: async () => {
    try {
      console.log('Updating chats list from the database')
      const { data, error } = await getChats()
      
      if (error) {
        console.error('Error updating chats:', error)
        return
      }

      if (!data) {
        console.warn('No chat data returned')
        return
      }

      console.log(`Received ${data.length} chats from the database`)
      set({ chats: data })
    } catch (error) {
      console.error('Error in updateChats:', error)
    }
  },
  clearChat: () => set({ 
    chat: { 
      id: '', 
      name: '', 
      messages: [] 
    } 
  }),
  getChat: (id) => {
    const state = get()
    const chat = state.chats.find(c => c.id === id)
    if (!chat) return null
    return {
      id: chat.id,
      name: chat.name,
      messages: state.chat?.id === id ? state.chat.messages : []
    }
  }
}))
