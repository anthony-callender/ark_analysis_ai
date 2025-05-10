import "next-auth"

// Extend the built-in session types
declare module "next-auth" {
  interface Session {
    user: {
      id: string
      email: string
      username: string
      role: string
      name?: string
      image?: string
    }
  }

  interface User {
    id: string
    email: string
    username: string
    role: string
    name?: string
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string
    email: string
    username: string
    role: string
    name?: string
  }
} 