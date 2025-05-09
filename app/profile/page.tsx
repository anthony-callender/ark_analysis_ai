import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { DashboardHeader } from '@/components/dashboard-header'

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: { error?: string }
}) {
  const supabase = await createClient()
  
  // Get user authentication state
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    redirect('/login')
  }
  
  // Get user details from database
  const { data: userData } = await supabase
    .from('users')
    .select('role, username, email, diocese_id, testing_center_id')
    .eq('id', user.id)
    .single()
  
  if (!userData) {
    redirect('/login')
  }
  
  // Get diocese information if available
  let diocese = null
  if (userData.diocese_id) {
    const { data } = await supabase
      .from('diocese')
      .select('name, full_name')
      .eq('id', userData.diocese_id)
      .single()
    
    diocese = data
  }
  
  // Get testing center information if available
  let testingCenter = null
  if (userData.testing_center_id) {
    const { data } = await supabase
      .from('testing_centers')
      .select('name')
      .eq('id', userData.testing_center_id)
      .single()
    
    testingCenter = data
  }
  
  // Generate dashboard link based on role
  let dashboardLink = '/app'
  if (userData.role === 'super_admin') {
    dashboardLink = '/admin'
  } else if (userData.role === 'diocese_manager') {
    dashboardLink = '/diocese-manager'
  } else if (userData.role === 'school_manager') {
    dashboardLink = '/school-manager'
  }
  
  return (
    <div className="min-h-screen flex flex-col">
      <DashboardHeader 
        userRole={userData.role} 
        userName={userData.username} 
      />
      
      <div className="flex-1 p-8">
        <div className="max-w-2xl mx-auto">
          {searchParams.error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 rounded-md">
              <h3 className="font-semibold">Error</h3>
              <p>{
                searchParams.error === 'no_diocese_assigned' 
                  ? 'You need to be assigned to a diocese to access that page.' 
                  : searchParams.error === 'missing_school_or_diocese'
                    ? 'You need to be assigned to both a diocese and school to access that page.'
                    : searchParams.error
              }</p>
            </div>
          )}
          
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl">User Profile</CardTitle>
              <CardDescription>Your account information</CardDescription>
            </CardHeader>
            
            <CardContent className="space-y-4">
              <div>
                <h3 className="font-medium text-sm text-muted-foreground mb-1">Username</h3>
                <p>{userData.username}</p>
              </div>
              
              <div>
                <h3 className="font-medium text-sm text-muted-foreground mb-1">Email</h3>
                <p>{userData.email}</p>
              </div>
              
              <div>
                <h3 className="font-medium text-sm text-muted-foreground mb-1">Role</h3>
                <p>{userData.role}</p>
              </div>
              
              {diocese && (
                <div>
                  <h3 className="font-medium text-sm text-muted-foreground mb-1">Diocese</h3>
                  <p>{diocese.full_name || diocese.name}</p>
                </div>
              )}
              
              {testingCenter && (
                <div>
                  <h3 className="font-medium text-sm text-muted-foreground mb-1">Testing Center</h3>
                  <p>{testingCenter.name}</p>
                </div>
              )}
            </CardContent>
            
            <CardFooter className="flex gap-4 border-t pt-6">
              <Button asChild>
                <Link href={dashboardLink}>Go to Dashboard</Link>
              </Button>
              
              <Button asChild variant="outline">
                <Link href="/logout">Logout</Link>
              </Button>
            </CardFooter>
          </Card>
        </div>
      </div>
    </div>
  )
} 