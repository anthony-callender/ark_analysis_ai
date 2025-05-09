import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DashboardHeader } from '@/components/dashboard-header'

export default async function DioceseManagerDashboard() {
  const supabase = await createClient()
  
  // Check if user is authenticated
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    redirect('/login')
  }
  
  // Get user details from our database
  const { data: userData } = await supabase
    .from('users')
    .select('role, diocese_id, username')
    .eq('id', user.id)
    .single()
  
  // Redirect users without diocese_manager role (backup to middleware check)
  if (userData?.role !== 'diocese_manager' && userData?.role !== 'super_admin') {
    redirect('/access-denied')
  }
  
  // Redirect if no diocese assigned
  if (!userData?.diocese_id) {
    redirect('/profile?error=no_diocese_assigned')
  }
  
  // Get diocese information
  const { data: diocese } = await supabase
    .from('dioceses')
    .select('*')
    .eq('id', userData.diocese_id)
    .single()
  
  // Get testing centers for this diocese
  const { data: testingCenters } = await supabase
    .from('testing_centers')
    .select('*')
    .eq('diocese_id', userData.diocese_id)
  
  // Get users for this diocese
  const { data: users } = await supabase
    .from('users')
    .select('*')
    .eq('diocese_id', userData.diocese_id)
  
  return (
    <div className="min-h-screen flex flex-col">
      <DashboardHeader userRole="Diocese Manager" userName={userData?.username} />
      
      <div className="p-8 flex-1">
        <h1 className="text-3xl font-bold mb-8">
          Diocese Manager: {diocese?.full_name || 'Loading...'}
        </h1>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle>Diocese</CardTitle>
              <CardDescription>Management details</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <p><strong>ID:</strong> {diocese?.id}</p>
                <p><strong>Name:</strong> {diocese?.name}</p>
                <p><strong>Full Name:</strong> {diocese?.full_name}</p>
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="pb-2">
              <CardTitle>Testing Centers</CardTitle>
              <CardDescription>Schools in your diocese</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-4xl font-bold">{testingCenters?.length || 0}</p>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="pb-2">
              <CardTitle>Users</CardTitle>
              <CardDescription>Users in your diocese</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-4xl font-bold">{users?.length || 0}</p>
            </CardContent>
          </Card>
        </div>
        
        <h2 className="text-2xl font-bold mb-4">Diocese Management</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Testing Center Management</CardTitle>
              <CardDescription>Manage schools in your diocese</CardDescription>
            </CardHeader>
            <CardContent>
              <p>View and manage all testing centers in your diocese.</p>
              <button className="mt-4 bg-primary text-white px-4 py-2 rounded">
                Manage Testing Centers
              </button>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader>
              <CardTitle>Diocese User Management</CardTitle>
              <CardDescription>Manage users in your diocese</CardDescription>
            </CardHeader>
            <CardContent>
              <p>Manage school managers and other users in your diocese.</p>
              <button className="mt-4 bg-primary text-white px-4 py-2 rounded">
                Manage Users
              </button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
} 