import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DashboardHeader } from '@/components/dashboard-header'

export default async function SchoolManagerDashboard() {
  const supabase = await createClient()
  
  // Check if user is authenticated
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    redirect('/login')
  }
  
  // Get user details from our database
  const { data: userData } = await supabase
    .from('users')
    .select('role, diocese_id, testing_center_id, username')
    .eq('id', user.id)
    .single()
  
  // Validate user has required data
  if (!userData?.testing_center_id || !userData?.diocese_id) {
    redirect('/profile?error=missing_school_or_diocese')
  }
  
  // Get diocese information
  const { data: diocese } = await supabase
    .from('diocese')
    .select('*')
    .eq('id', userData.diocese_id)
    .single()
  
  // Get testing center information
  const { data: testingCenter } = await supabase
    .from('testing_centers')
    .select('*')
    .eq('id', userData.testing_center_id)
    .single()
  
  // In a real app, we would query students by testing center ID
  // This is just placeholder data since the table doesn't exist yet
  const students = [] // Placeholder for actual student data
  
  return (
    <div className="min-h-screen flex flex-col">
      <DashboardHeader userRole="School Manager" userName={userData?.username} />
      
      <div className="p-8 flex-1">
        <h1 className="text-3xl font-bold mb-8">
          School Manager: {testingCenter?.name || 'Loading...'}
        </h1>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle>School</CardTitle>
              <CardDescription>Your testing center</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <p><strong>ID:</strong> {testingCenter?.id}</p>
                <p><strong>Name:</strong> {testingCenter?.name}</p>
                <p><strong>Diocese:</strong> {diocese?.name}</p>
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="pb-2">
              <CardTitle>Students</CardTitle>
              <CardDescription>Students in your testing center</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-4xl font-bold">{students?.length || 0}</p>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="pb-2">
              <CardTitle>Test Sections</CardTitle>
              <CardDescription>Active test sections</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-4xl font-bold">0</p>
              <p className="text-sm text-muted-foreground">No active sections</p>
            </CardContent>
          </Card>
        </div>
        
        <h2 className="text-2xl font-bold mb-4">School Management</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Student Management</CardTitle>
              <CardDescription>Manage your students</CardDescription>
            </CardHeader>
            <CardContent>
              <p>View and manage students in your testing center.</p>
              <button className="mt-4 bg-primary text-white px-4 py-2 rounded">
                Manage Students
              </button>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader>
              <CardTitle>Test Management</CardTitle>
              <CardDescription>Manage testing sessions</CardDescription>
            </CardHeader>
            <CardContent>
              <p>View and manage tests for your testing center.</p>
              <button className="mt-4 bg-primary text-white px-4 py-2 rounded">
                Manage Tests
              </button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
} 