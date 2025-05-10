import { User } from '@supabase/supabase-js'
import { ChatApp } from '@/components/chat-app'

type ChatPageParams = {
  params: Promise<{ id: string }>
}

export default async function ChatPage({ params }: ChatPageParams) {
  // Await the params to get the id
  const { id } = await params

  // Create a mock user object that conforms to the Supabase User type
  const mockUser: User = {
    id: '00000000-0000-0000-0000-000000000000',
    email: 'anonymous@example.com',
    app_metadata: {},
    user_metadata: {},
    aud: 'authenticated',
    created_at: new Date().toISOString(),
    role: '',
    confirmed_at: ''
  }

  // We no longer check the database
  // Chat data will be loaded from localStorage on the client side

  return (
    <ChatApp 
      user={mockUser}
      chatId={id}
      // Pass only the ID - the component will load data from localStorage
      initialChat={undefined}
    />
  )
}
