import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { DashboardHeader } from '@/components/dashboard-header'
import { getDbUserIdFromToken } from '@/utils/auth/db-session'
import { createAdminClient } from '@/utils/supabase/admin'

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const cookieStore = await cookies()
  
  // Get Supabase user
  const { data: { user } } = await supabase.auth.getUser()
  
  // Check for database auth token if Supabase user is missing
  let dbUserId: number | null = null
  if (!user) {
    const dbToken = cookieStore.get('db-auth-token')?.value
    dbUserId = getDbUserIdFromToken(dbToken)
    if (!dbUserId) {
      return redirect('/login')
    }
  }
  
  // Fetch user details from database
  let userData: { role: number; username: string } | null = null
  if (user) {
    const { data } = await supabase
      .from('users')
      .select('role, username')
      .eq('uuid', user.id)
      .single()
    userData = data as any
  } else if (dbUserId) {
    // Use admin client to bypass RLS
    const admin = createAdminClient()
    const { data } = await admin
      .from('users')
      .select('role, username')
      .eq('id', dbUserId)
      .single()
    userData = data as any
  }
  
  if (!userData) {
    return redirect('/login')
  }
  
  // convert role to string for header
  const roleName = userData.role === 0 ? 'super_admin' : userData.role === 2 ? 'diocese_manager' : 'school_manager';
  
  return (
    <div className="min-h-screen flex flex-col">
      <DashboardHeader 
        userRole={roleName} 
        userName={userData.username} 
      />
      <div className="flex-1">
        {children}
      </div>
    </div>
  )
}
