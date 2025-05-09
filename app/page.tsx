import { Hero } from '@/components/hero'
import HowItWorks from '@/components/how-it-works'
import OpenSourceSection from '@/components/open-source-section'
import { cn } from '@/utils/cn'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { createClient } from '@/utils/supabase/server'

const Section = ({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) => (
  <section className={cn('max-w-[1240px] mx-auto', className)}>
    {children}
  </section>
)

export default async function HomePage() {
  const supabase = await createClient()
  
  // Get current user state
  const { data: { user } } = await supabase.auth.getUser()

  return (
    <div className="flex flex-col items-center min-h-screen pt-16 px-4">
      <h1 className="text-4xl font-bold mb-6 text-center">Diocese Management System</h1>
      
      <div className="max-w-3xl text-center mb-12">
        <p className="text-xl mb-4">
          A complete solution for managing dioceses, schools, and student testing data
        </p>
        <p className="text-muted-foreground mb-8">
          Role-based access control allows for safe, secure data management at all levels of the organization
        </p>
        
        <div className="flex flex-wrap gap-4 justify-center">
          {user ? (
            <>
              <Button asChild size="lg">
                <Link href="/app">Go to Dashboard</Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link href="/logout">Logout</Link>
              </Button>
            </>
          ) : (
            <>
              <Button asChild size="lg">
                <Link href="/login">Login</Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link href="/signup">Sign Up</Link>
              </Button>
            </>
          )}
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-5xl">
        <div className="p-6 border rounded shadow-sm">
          <h2 className="text-xl font-bold mb-3">Super Admin</h2>
          <p className="mb-4">Complete system access with the ability to manage all dioceses, schools, and users.</p>
          <Link 
            href="/admin" 
            className="text-primary hover:underline"
          >
            Admin Dashboard →
          </Link>
        </div>
        
        <div className="p-6 border rounded shadow-sm">
          <h2 className="text-xl font-bold mb-3">Diocese Manager</h2>
          <p className="mb-4">Manage all schools and users within a specific diocese.</p>
          <Link 
            href="/diocese-manager" 
            className="text-primary hover:underline"
          >
            Diocese Dashboard →
          </Link>
        </div>
        
        <div className="p-6 border rounded shadow-sm">
          <h2 className="text-xl font-bold mb-3">School Manager</h2>
          <p className="mb-4">Manage students and tests for a specific school.</p>
          <Link 
            href="/school-manager" 
            className="text-primary hover:underline"
          >
            School Dashboard →
          </Link>
        </div>
      </div>
      
      <div className="mt-12 w-full max-w-3xl">
        <h2 className="text-2xl font-bold mb-4 text-center">Public Pages</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Link 
            href="/public" 
            className="p-4 border rounded shadow-sm text-center hover:bg-gray-50"
          >
            Public Page
          </Link>
          <Link 
            href="/?public=true" 
            className="p-4 border rounded shadow-sm text-center hover:bg-gray-50"
          >
            Home (with ?public=true)
          </Link>
          <Link 
            href="/about" 
            className="p-4 border rounded shadow-sm text-center hover:bg-gray-50"
          >
            About Us
          </Link>
          <Link 
            href="/contact" 
            className="p-4 border rounded shadow-sm text-center hover:bg-gray-50"
          >
            Contact
          </Link>
        </div>
      </div>
    </div>
  )
}
