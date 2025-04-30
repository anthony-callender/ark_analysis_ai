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

  const persistChat = useCallback(async (
    id: string, 
    name: string, 
    messages: Message[],
    silent: boolean = false
  ) => {
    if (savingRef.current) return
    savingRef.current = true;

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
        // Update the chats list in app state
        await updateChats()
        
        // If a new chat name was generated, update the current chat
        if (result.name && chat?.id === id && chat.name !== result.name) {
          console.log('Updating chat name to:', result.name)
          setChat({
            ...chat,
            name: result.name
          })
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

  // Automatically persist the chat whenever it changes
  useEffect(() => {
    if (chat?.id && chat.name) {
      console.log('Chat changed, auto-persisting:', chat.id)
      persistChat(chat.id, chat.name, chat.messages || [], true)
    }
  }, [chat?.id, chat?.name, chat?.messages, persistChat])

  return {
    persistChat
  }
} 