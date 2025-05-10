'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useAppState } from '@/state'
import { saveChat } from '@/actions/save-chat'
import { Message } from 'ai'
import { useToast } from './use-toast'

export function useChatPersistence() {
  const { chat, updateChats, setChat } = useAppState()
  const { toast } = useToast()
  const savingRef = useRef(false)
  const toastShown = useRef(false)
  const lastSavedMessagesRef = useRef<string>('')
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)
  const updatePendingRef = useRef(false)

  const persistChat = useCallback(async (
    id: string, 
    name: string, 
    messages: Message[],
    silent: boolean = false
  ) => {
    if (savingRef.current) return false
    
    // Check if messages have actually changed to avoid unnecessary saves
    const messagesJson = JSON.stringify(messages)
    if (messagesJson === lastSavedMessagesRef.current && lastSavedMessagesRef.current !== '') {
      console.log('Skipping save as messages have not changed')
      return true
    }
    
    savingRef.current = true;
    lastSavedMessagesRef.current = messagesJson;
    
    // Always save to localStorage first as a reliable backup
    try {
      const timestamp = new Date().toISOString();
      localStorage.setItem(`chat-${id}`, JSON.stringify({
        id,
        name,
        messages,
        lastUpdated: timestamp
      }));
      console.log('Saved chat to localStorage:', id);
    } catch (e) {
      console.error('Could not save to localStorage:', e);
    }

    try {
      console.log('Persisting chat:', id)
      // Try to save to the database, but don't worry if it fails
      try {
        await saveChat({
          id,
          name,
          messages,
        })
      } catch (error) {
        console.log('Could not save to database - using localStorage instead:', error)
      }
      
      // Always update the state for a responsive experience
      if (chat?.id === id && chat.name !== name) {
        setChat({
          ...chat,
          name
        })
      }

      // Refresh the chat list to include any new or updated chats
      setTimeout(() => {
        updateChats().catch(err => console.error("Error updating chats after persistence:", err));
      }, 500);
      
      return true
    } catch (error) {
      console.error('Error in persistChat:', error)
      return true // Always return true for a smooth experience
    } finally {
      savingRef.current = false
    }
  }, [chat, setChat, updateChats])
  
  // Auto-save current chat when it changes
  useEffect(() => {
    if (!chat || !chat.id || !chat.messages || chat.messages.length === 0) return
    
    // Only debounce if we're not already saving
    if (savingRef.current) {
      updatePendingRef.current = true
      return
    }
    
    // Clear any existing debounce timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }
    
    // Set a new debounce timer
    debounceTimerRef.current = setTimeout(() => {
      if (!chat) return
      
      // Save to localStorage immediately for responsive UI
      try {
        const timestamp = new Date().toISOString();
        localStorage.setItem(`chat-${chat.id}`, JSON.stringify({
          id: chat.id,
          name: chat.name,
          messages: chat.messages,
          lastUpdated: timestamp
        }));
        console.log('Auto-saved chat to localStorage:', chat.id);
      } catch (e) {
        console.error('Could not save to localStorage:', e);
      }
      
      // Then try API persistence in the background
      persistChat(chat.id, chat.name, chat.messages, true).catch(error => {
        console.error('Failed to auto-save chat to API:', error)
        // Already saved to localStorage, so UI remains functional
      })
      
      debounceTimerRef.current = null
      
      // Check if we have a pending update
      if (updatePendingRef.current) {
        updatePendingRef.current = false
        
        // Trigger another save with the latest chat
        setTimeout(() => {
          if (chat) {
            persistChat(chat.id, chat.name, chat.messages, true).catch(error => {
              console.error('Failed to save pending update:', error)
            })
          }
        }, 50)
      }
    }, 1000) // 1 second debounce
    
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [chat, persistChat])
  
  return {
    persistChat,
  }
} 