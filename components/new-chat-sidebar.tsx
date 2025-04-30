'use client'

import { Button } from './ui/button'
import { useAppState } from '../state'
import { useChatPersistence } from '@/hooks/use-chat-persistence'
import { v4 } from 'uuid'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Loader2 } from 'lucide-react'

export function NewChatSidebar() {
  const setChat = useAppState((state) => state.setChat)
  const { persistChat } = useChatPersistence()
  const router = useRouter()
  const [isCreating, setIsCreating] = useState(false)

  const handleClick = async () => {
    if (isCreating) return
    setIsCreating(true)
    
    try {
      const newChatId = v4()
      console.log('Creating new chat with ID:', newChatId)
      
      // Set the chat in the app state
      setChat({
        id: newChatId,
        name: 'New Chat', // Will be replaced by generated name
        messages: [],
      })
      
      // Save the chat to the database
      const success = await persistChat(newChatId, 'New Chat', [])
      
      if (success) {
        console.log('Successfully created and persisted new chat')
        if (typeof window !== 'undefined') {
          router.push('/app')
        }
      } else {
        console.error('Failed to persist new chat')
      }
    } catch (error) {
      console.error('Error creating new chat:', error)
    } finally {
      setIsCreating(false)
    }
  }
  
  return (
    <Button 
      variant="ghost" 
      className="w-full" 
      size="lg" 
      onClick={handleClick}
      disabled={isCreating}
    >
      {isCreating ? (
        <span className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          Creating Chat...
        </span>
      ) : (
        'New Chat'
      )}
    </Button>
  )
}
