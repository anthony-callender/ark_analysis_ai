import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DashboardHeader } from '@/components/dashboard-header'

export default async function AdminDashboard() {
  const supabase = await createClient()
  
  // Check if user is authenticated and has super_admin role
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    redirect('/login')
  }
  
  // Get user details from our database
  const { data: userData } = await supabase
    .from('users')
    .select('role, username')
    .eq('id', user.id)
    .single()
  
  // Redirect non-admins (this is a backup to the middleware check)
  if (userData?.role !== 'super_admin') {
    redirect('/access-denied')
  }
  
  // Fetch all dioceses
  const { data: dioceses } = await supabase
    .from('diocese')
    .select('*')
  
  // Fetch all testing centers
  const { data: testingCenters } = await supabase
    .from('testing_centers')
    .select('*')
  
  // Fetch all users
  const { data: users } = await supabase
    .from('users')
    .select('*')
  
  return (
    <div className="min-h-screen flex flex-col">
      <DashboardHeader userRole="Super Admin" userName={userData?.username} />
      
      <div className="p-8 flex-1">
        <h1 className="text-3xl font-bold mb-8">Super Admin Dashboard</h1>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle>Total Dioceses</CardTitle>
              <CardDescription>All registered dioceses</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-4xl font-bold">{dioceses?.length || 0}</p>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="pb-2">
              <CardTitle>Testing Centers</CardTitle>
              <CardDescription>All registered testing centers</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-4xl font-bold">{testingCenters?.length || 0}</p>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="pb-2">
              <CardTitle>Users</CardTitle>
              <CardDescription>All system users</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-4xl font-bold">{users?.length || 0}</p>
            </CardContent>
          </Card>
        </div>
        
        <h2 className="text-2xl font-bold mb-4">System Management</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Diocese Management</CardTitle>
              <CardDescription>Add, edit, or delete dioceses</CardDescription>
            </CardHeader>
            <CardContent>
              <p>Full access to all diocese records and their associated data.</p>
              <button className="mt-4 bg-primary text-white px-4 py-2 rounded">
                Manage Dioceses
              </button>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader>
              <CardTitle>User Management</CardTitle>
              <CardDescription>Manage user accounts and permissions</CardDescription>
            </CardHeader>
            <CardContent>
              <p>Full access to all user management functions.</p>
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