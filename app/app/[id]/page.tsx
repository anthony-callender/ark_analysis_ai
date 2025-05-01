import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'

import { ChatApp } from '@/components/chat-app'
import { Message } from 'ai'

type ChatPageParams = {
  params: Promise<{ id: string }>
}

export default async function ChatPage({ params }: ChatPageParams) {
  // Await the params to get the id
  const { id } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return redirect('/login')
  }

  const { data: chat } = await supabase
    .from('chats')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (!chat) {
    return redirect('/app')
  }

  return (
    <ChatApp 
      user={user}
      chatId={id}
      initialChat={{
        id: chat.id,
        name: chat.name,
        messages: JSON.parse(chat.messages as string) as Message[],
      }}
    />
  )
}
