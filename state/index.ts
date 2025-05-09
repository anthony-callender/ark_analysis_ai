import { Message } from 'ai'
import { create } from 'zustand'
import { getChats } from '@/app/actions/get-chats'
import { saveChat } from '@/app/actions/save-chat'
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
  showSQL: boolean
  setShowSQL: (show: boolean) => void
  toggleShowSQL: () => void
  setChats: (chats: AppState['chats']) => void
  setChat: (chat: AppState['chat']) => void
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
      updateChats: async () => {
        try {
          const now = Date.now();
          const lastUpdate = get().lastUpdateTime;
          
          // Increase throttle time to 3 seconds to avoid excessive API calls
          if (now - lastUpdate < 3000) {
            return;
          }
          
          console.log('Updating chats list from the database');
          const result = await getChats();
          const chatsData = result.chats || [];

          // Only update state if the data has changed
          const currentChats = get().chats;
          
          // Fast comparison using lengths and IDs
          let hasChanged = currentChats.length !== chatsData.length;
          
          if (!hasChanged && chatsData.length > 0) {
            // Do a more detailed comparison if needed
            const currentIds = new Set(currentChats.map((c: any) => c.id));
            const newIds = new Set(chatsData.map((c: any) => c.id));
            
            // Check if any IDs are different
            hasChanged = currentChats.some((c: any) => !newIds.has(c.id)) || 
                        chatsData.some((c: any) => !currentIds.has(c.id));
            
            // If IDs match but we need to check for other changes (like names)
            if (!hasChanged) {
              hasChanged = chatsData.some((newChat: any) => {
                const currentChat = currentChats.find((c: any) => c.id === newChat.id);
                return currentChat && currentChat.name !== newChat.name;
              });
            }
          }
          
          if (hasChanged) {
            console.log(`Updating state with ${chatsData.length} chats`);
            set({ 
              chats: chatsData,
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
    }),
    {
      name: 'ark-analysis-storage',
      partialize: (state) => ({ showSQL: state.showSQL }),
    }
  )
)
