import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function AboutPage() {
  return (
    <div className="flex items-center justify-center min-h-screen p-8">
      <Card className="w-full max-w-3xl">
        <CardHeader className="text-center">
          <CardTitle className="text-3xl">About Diocese Management System</CardTitle>
          <CardDescription className="text-xl">
            Role-based access control for diocese data management
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <p>
            The Diocese Management System is a comprehensive solution designed to manage educational data 
            across multiple levels of the diocese structure. Our system implements role-based access 
            controls to ensure data security and privacy.
          </p>
          
          <h2 className="text-2xl font-bold">User Roles</h2>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong>Super Admin</strong> - Complete access to all dioceses, schools, and user data throughout the system.
            </li>
            <li>
              <strong>Diocese Manager</strong> - Can manage all schools, testing centers, and users within their assigned diocese.
            </li>
            <li>
              <strong>School Manager</strong> - Can manage students and testing data for their specific school only.
            </li>
          </ul>
          
          <h2 className="text-2xl font-bold mt-6">Data Security</h2>
          <p>
            Our system enforces strict access controls to ensure users can only access data relevant to their role.
            Database queries are filtered based on user permissions, and middleware prevents unauthorized access
            to protected routes.
          </p>
          
          <div className="flex justify-center mt-8">
            <Link 
              href="/"
              className="py-2 px-4 bg-primary text-white rounded hover:bg-primary/90"
            >
              Return to Home
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  )
} 