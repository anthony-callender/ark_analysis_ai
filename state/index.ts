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
  lastUpdateTime: number
}

export const useAppState = create<AppState>((set, get) => ({
  chat: undefined,
  chats: [],
  lastUpdateTime: 0,
  setChats: (chats) => set({ chats }),
  setChat: (chat) => {
    // First make sure it's actually different to avoid unnecessary rerenders
    const current = get().chat;
    if (
      current?.id !== chat?.id || 
      current?.name !== chat?.name || 
      JSON.stringify(current?.messages) !== JSON.stringify(chat?.messages)
    ) {
      console.log('Setting chat state:', chat?.id, 'with', chat?.messages?.length, 'messages');
      set({ chat });
    }
  },
  updateChats: async () => {
    try {
      const now = Date.now();
      const lastUpdate = get().lastUpdateTime;
      
      // Increase throttle time to 3 seconds to avoid excessive API calls
      if (now - lastUpdate < 3000) {
        return;
      }
      
      console.log('Updating chats list from the database');
      const { data, error } = await getChats();

      if (error) {
        console.error('Error updating chats:', error);
        return;
      }

      if (!data) {
        console.warn('No chat data returned');
        return;
      }

      // Only update state if the data has changed
      const currentChats = get().chats;
      
      // Fast comparison using lengths and IDs
      let hasChanged = currentChats.length !== data.length;
      
      if (!hasChanged && data.length > 0) {
        // Do a more detailed comparison if needed
        const currentIds = new Set(currentChats.map(c => c.id));
        const newIds = new Set(data.map(c => c.id));
        
        // Check if any IDs are different
        hasChanged = currentChats.some(c => !newIds.has(c.id)) || 
                     data.some(c => !currentIds.has(c.id));
        
        // If IDs match but we need to check for other changes (like names)
        if (!hasChanged) {
          hasChanged = data.some((newChat, i) => {
            const currentChat = currentChats.find(c => c.id === newChat.id);
            return currentChat && currentChat.name !== newChat.name;
          });
        }
      }
      
      if (hasChanged) {
        console.log(`Updating state with ${data.length} chats`);
        set({ 
          chats: data,
          lastUpdateTime: now
        });
      } else {
        // Still update the timestamp to prevent redundant calls
        set({ lastUpdateTime: now });
      }
    } catch (error) {
      console.error('Error in updateChats:', error);
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
    const state = get();
    const chat = state.chats.find(c => c.id === id);
    if (!chat) return null;
    return {
      id: chat.id,
      name: chat.name,
      messages: state.chat?.id === id ? state.chat.messages : []
    }
  }
}))
