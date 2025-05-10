import { Message } from 'ai'
import { create } from 'zustand'
import { getChats } from '../actions/get-chats'
import { persist } from 'zustand/middleware'

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
  localChats: {
    id: string
    name: string
    messages: Message[]
    created_at: string
  }[]
  showSQL: boolean
  setShowSQL: (show: boolean) => void
  toggleShowSQL: () => void
  setChats: (chats: AppState['chats']) => void
  setChat: (chat: AppState['chat']) => void
  addLocalChat: (chat: { id: string, name: string, messages: Message[] }) => void
  updateLocalChat: (chat: { id: string, name: string, messages: Message[] }) => void
  updateChats: () => Promise<void>
  clearChat: () => void
  getChat: (id: string) => AppState['chat']
  lastUpdateTime: number
}

export const useAppState = create<AppState>()(
  persist(
    (set, get) => ({
      chat: undefined,
      chats: [],
      localChats: [],
      showSQL: true, // Default to showing SQL
      lastUpdateTime: 0,
      setShowSQL: (show) => set({ showSQL: show }),
      toggleShowSQL: () => set((state) => ({ showSQL: !state.showSQL })),
      setChats: (chats) => set({ chats }),
      setChat: (chat) => {
        // First make sure it's actually different to avoid unnecessary rerenders
        const current = get().chat;
        
        // If both are null/undefined or have the same ID and are identical, don't update
        if (!chat && !current) return;
        if (!chat || !current) {
          console.log('Chat changed from', current?.id, 'to', chat?.id);
          set({ chat });
          return;
        }
        
        // If the IDs are different, we definitely update
        if (current.id !== chat.id) {
          console.log('Chat ID changed from', current.id, 'to', chat.id);
          set({ chat });
          return;
        }
        
        // Check name changes
        if (current.name !== chat.name) {
          console.log('Chat name changed from', current.name, 'to', chat.name);
          set({ chat });
          return;
        }
        
        // Check if messages have changed - using deep comparison for messages
        const messagesChanged = () => {
          if (!current.messages && !chat.messages) return false;
          if (!current.messages || !chat.messages) return true;
          if (current.messages.length !== chat.messages.length) return true;
          
          // Check each message
          for (let i = 0; i < chat.messages.length; i++) {
            if (chat.messages[i].content !== current.messages[i].content ||
                chat.messages[i].role !== current.messages[i].role) {
              return true;
            }
          }
          
          return false;
        };
        
        // Only update if messages have actually changed and use a flag to prevent recursive updates
        if (messagesChanged()) {
          console.log('Chat messages changed for chat', chat.id, 'from', current.messages?.length, 'to', chat.messages?.length);
          
          // Use setTimeout to break update cycles
          setTimeout(() => {
            set({ chat: {...chat, messages: [...chat.messages]} });
          }, 0);
        }
      },
      addLocalChat: (chat) => {
        const now = new Date().toISOString();
        set({
          localChats: [
            ...get().localChats,
            {
              ...chat,
              created_at: now
            }
          ]
        });
      },
      updateLocalChat: (chat) => {
        set({
          localChats: get().localChats.map(c => 
            c.id === chat.id 
              ? { ...c, ...chat } 
              : c
          )
        });
      },
      updateChats: async () => {
        try {
          const now = Date.now();
          const lastUpdate = get().lastUpdateTime;
          
          // Increase throttle time to 3 seconds to avoid excessive calls
          if (now - lastUpdate < 3000) {
            return;
          }
          
          // Get chats from localStorage only - avoid database operations
          const localChats: any[] = [];
          try {
            // Find all localStorage keys that start with 'chat-'
            for (let i = 0; i < localStorage.length; i++) {
              const key = localStorage.key(i);
              if (key && key.startsWith('chat-')) {
                try {
                  const savedChat = JSON.parse(localStorage.getItem(key) || '{}');
                  if (savedChat.id && savedChat.name) {
                    // Add to local chats
                    localChats.push({
                      id: savedChat.id,
                      name: savedChat.name,
                      created_at: savedChat.lastUpdated || new Date().toISOString()
                    });
                  }
                } catch (e) {
                  console.error('Error parsing localStorage chat:', e);
                }
              }
            }
            
            if (localChats.length > 0) {
              console.log(`Found ${localChats.length} chats in localStorage`);
            }
          } catch (e) {
            console.error('Error reading localStorage:', e);
          }
          
          // Sort by most recent first
          localChats.sort((a, b) => {
            return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
          });
          
          // Update state with localStorage chats
          set({ 
            chats: localChats,
            lastUpdateTime: now
          });
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
    }),
    {
      name: 'ark-analysis-storage',
      partialize: (state) => ({ 
        showSQL: state.showSQL,
        chat: state.chat // Also persist the current chat to localStorage
      }),
    }
  )
)
