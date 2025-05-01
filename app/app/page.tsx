import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'

import { ChatApp } from '@/components/chat-app'

export default async function AppPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return redirect('/login')
  }

  return <ChatApp user={user} />
}
