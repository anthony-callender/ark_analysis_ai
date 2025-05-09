import Link from 'next/link'
import { handleLoginFormAction } from '@/app/actions/auth'
import { redirect } from 'next/navigation'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'

// Don't need these now since we've disabled auth checks temporarily
// import { cookies } from 'next/headers'
// import { getDbUserIdFromToken } from '@/utils/auth/db-session'
// import { createClient } from '@/utils/supabase/server'

// Unusual for Next.js 15, but the error suggests we need to await searchParams
export default async function Login({
  searchParams
}: {
  // Make searchParams a Promise to match error requirement
  searchParams: Promise<{ message?: string; errorMessage?: string }>
}) {
  // Await to fix the error
  const params = await searchParams
  const message = params?.message
  const errorMessage = params?.errorMessage
  
  // For debugging, skip all auth checks/redirects temporarily

  return (
    <div className="flex h-screen w-full flex-col items-center justify-center">
      <Link
        href="/"
        className="absolute left-8 top-8 py-2 px-4 rounded-md no-underline text-foreground bg-btn-background hover:bg-btn-background-hover flex items-center group text-sm"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="mr-2 h-4 w-4 transition-transform group-hover:-translate-x-1"
        >
          <polyline points="15 18 9 12 15 6" />
        </svg>{' '}
        Back
      </Link>

      <Card className="mx-auto max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">Login</CardTitle>
          <CardDescription>
            Enter your credentials to login to your account
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4">
            <form action={handleLoginFormAction} className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="m@example.com"
                  required
                />
              </div>
              
              <div className="grid gap-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  required
                />
              </div>

              <button 
                type="submit" 
                className="bg-blue-600 text-white py-2 px-4 rounded hover:bg-blue-700"
              >
                Login
              </button>
              
              {message && (
                <p className="mt-4 p-4 text-center rounded bg-green-100 text-green-700">
                  {message}
                </p>
              )}
              
              {errorMessage && (
                <p className="mt-4 p-4 text-center rounded bg-red-100 text-red-700">
                  {errorMessage}
                </p>
              )}
            </form>
          </div>
        </CardContent>
        <CardFooter className="flex flex-col items-center">
          <div className="text-sm text-muted-foreground mt-2">
            Don't have an account? <Link href="/signup" className="text-primary underline">Sign up</Link>
          </div>
        </CardFooter>
      </Card>
    </div>
  )
}
