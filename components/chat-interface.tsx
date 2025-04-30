'use client'

import { useAppLocalStorage } from '@/hooks/use-app-local-storage'
import Chat from './chat'
import ChatInterfaceModern from './chat-interface-modern'
import ConnectionForm from './connection-form'

import { useEffect, useMemo } from 'react'
import { Message } from 'ai'
import { User } from '@supabase/supabase-js'
import { useAppState } from '@/state'
import { useIsMounted } from '@/hooks/use-is-mounted'
import { v4 } from 'uuid'

export default function ChatInterface({
  chat: chatProp,
  user,
}: {
  chat:
    | {
        id: string
        name: string
        messages: Message[]
      }
    | undefined
  user: User
}) {
  const { value, setValue } = useAppLocalStorage()
  const { setChat, chat: chatState, clearChat } = useAppState()

  const isMounted = useIsMounted()

  useEffect(() => {
    if (chatProp) {
      setChat(chatProp)
    } else {
      setChat({
        id: v4(),
        name: 'New Chat',
        messages: [],
      })
    }

    // Cleanup function to help with memory management when component unmounts
    return () => {
      clearChat();
    };
  }, [setChat, chatProp, clearChat])

  const shouldShowChat = useMemo(() => {
    if (!isMounted) return false
    return !!value.connectionString
  }, [isMounted, value.connectionString])

  if (!isMounted) return null
  if (!chatState?.id) return null

  return (
    <>
      {shouldShowChat ? (
        <ChatInterfaceModern chat={chatState} user={user} />
      ) : (
        <ConnectionForm setConnectionString={setValue} />
      )}
    </>
  )
}
