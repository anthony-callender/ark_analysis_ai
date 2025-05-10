import NextAuth from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials"
import bcrypt from "bcryptjs"
import { Pool } from "pg"
import { NextAuthOptions } from "next-auth"

// Database connection
// Use the same connection string that your Rails app uses
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
})

// Match Rails app's Devise configuration
const DEVISE_STRETCHES = 12  // Confirmed from config/initializers/devise.rb

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Rails Credentials",
      credentials: {
        login: { 
          label: "Email or Username", 
          type: "text", 
          placeholder: "username@example.com" 
        },
        password: { 
          label: "Password", 
          type: "password" 
        }
      },
      async authorize(credentials) {
        try {
          if (!credentials?.login || !credentials?.password) {
            return null
          }

          // Query for user by email OR username (since Rails app supports both)
          const userResult = await pool.query(
            `SELECT 
              id, 
              email, 
              username, 
              encrypted_password, 
              role, 
              deactivate,
              first_name,
              last_name
            FROM users 
            WHERE (email = $1 OR username = $1) 
            LIMIT 1`,
            [credentials.login]
          )

          const user = userResult.rows[0]
          if (!user) {
            console.log("User not found")
            return null
          }

          // Check if user is deactivated
          if (user.deactivate) {
            console.log("User account is deactivated")
            return null
          }

          // Verify password (no pepper needed as confirmed in devise.rb)
          const passwordToCheck = credentials.password
          const isValid = await bcrypt.compare(
            passwordToCheck,
            user.encrypted_password
          )

          if (!isValid) {
            console.log("Password invalid")
            return null
          }

          // Return user data to be encoded in the JWT
          return {
            id: user.id,
            email: user.email,
            username: user.username,
            role: user.role,
            name: `${user.first_name || ''} ${user.last_name || ''}`.trim()
          }
        } catch (error) {
          console.error("Auth error:", error)
          return null
        }
      }
    })
  ],
  callbacks: {
    async jwt({ token, user }) {
      // Initial sign in
      if (user) {
        token.id = user.id
        token.email = user.email
        token.username = user.username
        token.role = user.role
        token.name = user.name
      }
      return token
    },
    async session({ session, token }) {
      // Send properties to the client
      if (token) {
        session.user.id = token.id
        session.user.email = token.email
        session.user.username = token.username
        session.user.role = token.role
      }
      return session
    }
  },
  pages: {
    signIn: '/login',
  },
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  secret: process.env.NEXTAUTH_SECRET,
}

const handler = NextAuth(authOptions)
export { handler as GET, handler as POST } 