import { ChatApp } from '@/components/chat-app'
import { User } from '@supabase/supabase-js'

export default async function AppPage() {
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

  return <ChatApp user={mockUser} />
}
