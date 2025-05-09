import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function AccessDenied() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <Card className="w-[400px]">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl text-red-600">Access Denied</CardTitle>
          <CardDescription>
            You do not have permission to access this resource
          </CardDescription>
        </CardHeader>
        <CardContent className="text-center">
          <p className="mb-4">
            Your current user role does not have sufficient privileges to access this page.
          </p>
          <Link
            href="/app"
            className="inline-block py-2 px-4 bg-primary text-white rounded hover:bg-primary/90"
          >
            Return to Dashboard
          </Link>
        </CardContent>
      </Card>
    </div>
  )
} 