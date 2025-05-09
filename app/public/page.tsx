import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function PublicPage() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <Card className="w-[600px]">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Public Page</CardTitle>
          <CardDescription>
            This page is accessible to everyone
          </CardDescription>
        </CardHeader>
        <CardContent className="text-center">
          <p className="mb-6">
            This page demonstrates a public route that doesn't redirect authenticated users.
            You can create more routes like this for public-facing content.
          </p>
          
          <div className="grid grid-cols-2 gap-4">
            <Link
              href="/"
              className="py-2 px-4 bg-gray-200 text-gray-800 rounded hover:bg-gray-300"
            >
              Home
            </Link>
            <Link
              href="/login"
              className="py-2 px-4 bg-primary text-white rounded hover:bg-primary/90"
            >
              Login
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  )
} 