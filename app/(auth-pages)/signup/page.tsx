import Link from 'next/link'
import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import { SubmitButton } from '@/components/submit-button'
import { z } from 'zod'
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
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue 
} from '@/components/ui/select'
import { checkRailsUserByEmail, checkRailsUserByUsername, checkRailsUserAccess } from '@/utils/auth/rails-integration'
import { generateDeviseCompatiblePassword } from '@/utils/auth/devise-password'

const formSchema = z.object({
  email: z.string().email(),
  username: z.string().min(3),
  role: z.enum(['diocese_manager', 'school_manager', 'super_admin']),
  diocese_id: z.number().optional(),
  testing_center_id: z.number().optional(),
})

// Function to map role strings to integers (based on the Rails app's role system)
function mapRoleToInteger(role: string): number {
  switch (role) {
    case 'super_admin':
      return 0; // "Ark Admin" in the Rails application
    case 'diocese_manager':
      return 2; // "Diocese Admin" in the Rails application
    case 'school_manager':
      return 3; // "Center Admin" in the Rails application
    default:
      return 3; // Default to "Center Admin"
  }
}

// Server action for form submission
async function signupAction(formData: FormData) {
  'use server'
  
  const supabase = await createClient()
  
  const formSafeParsed = formSchema.safeParse({
    email: formData.get('email') as string,
    username: formData.get('username') as string,
    role: formData.get('role') as string,
    diocese_id: formData.get('diocese_id') ? parseInt(formData.get('diocese_id') as string) : undefined,
    testing_center_id: formData.get('testing_center_id') ? parseInt(formData.get('testing_center_id') as string) : undefined,
  })

  if (!formSafeParsed.success) {
    return redirect('/signup?errorMessage=' + encodeURIComponent(formSafeParsed.error.message))
  }

  // Verify that either diocese_id or testing_center_id is provided, based on role
  if (formSafeParsed.data.role === 'diocese_manager' && !formSafeParsed.data.diocese_id) {
    return redirect('/signup?errorMessage=Diocese is required for Diocese Managers')
  }
  
  if (formSafeParsed.data.role === 'school_manager' && !formSafeParsed.data.testing_center_id) {
    return redirect('/signup?errorMessage=Testing center is required for School Managers')
  }

  const defaultUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : `http://localhost:${process.env.PORT || 3000}`

  // Check if the user already exists in the Rails app by email
  const railsUserByEmail = await checkRailsUserByEmail(formSafeParsed.data.email)
  
  // Check if the username is already taken in the Rails app
  const railsUserByUsername = await checkRailsUserByUsername(formSafeParsed.data.username)
  
  // If user exists by email, check if they should have access to this app
  if (railsUserByEmail) {
    const accessCheck = checkRailsUserAccess(railsUserByEmail)
    
    if (accessCheck && accessCheck.shouldHaveAccess) {
      return redirect('/signup?errorMessage=You already have an account in our system. Please use the login page and contact support if you need assistance accessing this application.')
    } else if (accessCheck) {
      return redirect('/signup?errorMessage=Your existing account does not have the correct permissions for this application. Please contact support.')
    }
  }
  
  // If the username is already taken in the Rails app
  if (railsUserByUsername) {
    return redirect('/signup?errorMessage=This username is already taken. Please choose a different username.')
  }

  // Create user in Supabase Auth
  const { data, error } = await supabase.auth.signUp({
    email: formSafeParsed.data.email,
    password: formData.get('password') as string,
    options: {
      emailRedirectTo: `${defaultUrl}/api/auth/callback`,
      data: {
        username: formSafeParsed.data.username,
        role: mapRoleToInteger(formSafeParsed.data.role),
        diocese_id: formSafeParsed.data.diocese_id,
        testing_center_id: formSafeParsed.data.testing_center_id,
      }
    },
  })

  if (error) {
    return redirect('/signup?errorMessage=' + encodeURIComponent(error.message))
  }

  // Ensure user ID exists
  if (!data.user?.id) {
    return redirect('/signup?errorMessage=User creation failed')
  }

  // Generate a Devise-compatible encrypted password
  const password = formData.get('password') as string;
  const encryptedPassword = await generateDeviseCompatiblePassword(password);
  
  // Insert user profile in our custom users table
  // First let's generate a random numeric ID since the Rails app expects a numeric primary key
  const randomId = Math.floor(Math.random() * 1000000) + 100000;
  
  const { error: profileError } = await supabase.from('users').insert({
    id: randomId, // Use a generated numeric ID for primary key
    uuid: data.user.id, // Store the Supabase Auth UUID in the uuid column
    username: formSafeParsed.data.username,
    email: formSafeParsed.data.email,
    encrypted_password: encryptedPassword, // Use the bcrypt hashed password
    role: mapRoleToInteger(formSafeParsed.data.role),
    diocese_id: formSafeParsed.data.diocese_id,
    testing_center_id: formSafeParsed.data.testing_center_id,
    created_at: new Date().toISOString(), // Add current timestamp
    updated_at: new Date().toISOString(),  // Also add updated_at for consistency
    sign_in_count: 0, // Common Devise field
    is_complete: false, // Set to false initially
    validated_info: false, // Set to false initially
    terms: false // Set to false initially
  })

  if (profileError) {
    // Clean up auth user if profile creation fails
    await supabase.auth.admin.deleteUser(data.user?.id as string)
    return redirect('/signup?errorMessage=' + encodeURIComponent(profileError.message))
  }

  return redirect('/login?message=Check email to complete signup process')
}

// Define interfaces for diocese and testing center
interface Diocese {
  id: number;
  name: string;
}

interface TestingCenter {
  id: number;
  name: string;
  diocese_id: number;
}

// Force dynamic rendering to ensure searchParams are available
export const dynamic = 'force-dynamic'

export default async function Signup({
  searchParams,
}: {
  searchParams: Promise<{ message?: string; errorMessage?: string }>
}) {
  // Await the searchParams promise
  const params = await searchParams
  const message = params?.message
  const errorMessage = params?.errorMessage
  
  const supabase = await createClient()
  
  // Fetch dioceses for the dropdown - using correct table name
  const { data: dioceses } = await supabase.from('dioceses').select('id, name')
  
  // Fetch testing centers for the dropdown
  const { data: testingCenters } = await supabase.from('testing_centers').select('id, name, diocese_id')

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
          <CardTitle className="text-2xl">Sign Up</CardTitle>
          <CardDescription>
            Create your account
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4">
            <form action={signupAction} className="grid gap-4">
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
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  name="username"
                  type="text"
                  placeholder="username"
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
              
              <div className="grid gap-2">
                <Label htmlFor="role">Role</Label>
                <Select name="role" defaultValue="school_manager">
                  <SelectTrigger>
                    <SelectValue placeholder="Select a role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="school_manager">School Manager</SelectItem>
                    <SelectItem value="diocese_manager">Diocese Manager</SelectItem>
                    <SelectItem value="super_admin">Super Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div className="grid gap-2">
                <Label htmlFor="diocese_id">Diocese</Label>
                <Select name="diocese_id">
                  <SelectTrigger>
                    <SelectValue placeholder="Select a diocese" />
                  </SelectTrigger>
                  <SelectContent>
                    {dioceses?.map((diocese: Diocese) => (
                      <SelectItem key={diocese.id} value={diocese.id.toString()}>
                        {diocese.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              <div className="grid gap-2">
                <Label htmlFor="testing_center_id">Testing Center</Label>
                <Select name="testing_center_id">
                  <SelectTrigger>
                    <SelectValue placeholder="Select a testing center" />
                  </SelectTrigger>
                  <SelectContent>
                    {testingCenters?.map((center: TestingCenter) => (
                      <SelectItem key={center.id} value={center.id.toString()}>
                        {center.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <button 
                type="submit" 
                className="bg-blue-600 text-white py-2 px-4 rounded hover:bg-blue-700"
              >
                Sign Up
              </button>
              
              {/* Display messages if they exist */}
              {message && (
                <div className="mt-4 p-4 text-center rounded bg-green-100 text-green-700">
                  {message}
                </div>
              )}
              
              {errorMessage && (
                <div className="mt-4 p-4 text-center rounded bg-red-100 text-red-700">
                  {errorMessage}
                </div>
              )}
            </form>
          </div>
        </CardContent>
        <CardFooter className="flex flex-col items-center">
          <div className="text-sm text-muted-foreground mt-2">
            Already have an account? <Link href="/login" className="text-primary underline">Login</Link>
          </div>
        </CardFooter>
      </Card>
    </div>
  )
} 