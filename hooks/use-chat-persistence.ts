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

    try {
      console.log('Persisting chat:', id)
      const result = await saveChat({
        id,
        name,
        messages,
      })

      if (result.error) {
        console.error('Error persisting chat:', result.error)
        if (!silent && !toastShown.current) {
          toast({
            title: 'Error saving chat',
            description: result.error,
            variant: 'destructive',
          })
          toastShown.current = true
        }
        return false
      } else {
        // If a new chat name was generated, update the current chat
        if (result.name && chat?.id === id && chat.name !== result.name) {
          console.log('Updating chat name to:', result.name)
          setChat({
            ...chat,
            name: result.name
          })
        }
        
        // Set a flag to update chats later (outside of this function)
        if (!updatePendingRef.current) {
          updatePendingRef.current = true;
          setTimeout(() => {
            updateChats().catch(console.error);
            updatePendingRef.current = false;
          }, 2000); // Delay update to prevent rapid cycles
        }
        
        return true
      }
    } catch (error) {
      console.error('Error in persistChat:', error)
      if (!silent && !toastShown.current) {
        toast({
          title: 'Error saving chat',
          description: 'Failed to save chat',
          variant: 'destructive',
        })
        toastShown.current = true
      }
      return false
    } finally {
      savingRef.current = false
    }
  }, [chat, toast, updateChats, setChat])

  // Automatically persist the chat whenever it changes, but with debouncing
  useEffect(() => {
    if (chat?.id && chat.name && chat.messages) {
      // Cancel any pending debounce
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      
      // Setup a new debounce timer (1000ms)
      debounceTimerRef.current = setTimeout(() => {
        // Check if messages have changed since last save
        const messagesJson = JSON.stringify(chat.messages);
        if (messagesJson !== lastSavedMessagesRef.current) {
          console.log('Debounced auto-persisting:', chat.id);
          persistChat(chat.id, chat.name, chat.messages || [], true);
        }
      }, 1000);
    }
    
    // Cleanup on unmount
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [chat?.id, chat?.name, chat?.messages, persistChat]);

  return {
    persistChat
  }
} 