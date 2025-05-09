import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { getDbUserIdFromToken } from '@/utils/auth/db-session'

import { ChatApp } from '@/components/chat-app'

export default async function AppPage() {
  // For debugging, create a minimal user regardless of auth status
  const effectiveUser = { 
    id: 'debug-user', 
    email: 'tony@fuzati.com',
    role: 'super_admin',
    username: 'tony637'
  } as any
  
  // Log that we're using test user
  console.log('App page: Using test user for debugging')
  
  return <ChatApp user={effectiveUser} />
}
