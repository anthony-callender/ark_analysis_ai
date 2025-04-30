'use client'

import ChatInterfaceModern from '@/components/chat-interface-modern'
import { createClient } from '@/utils/supabase/client'
import { useEffect, useState } from 'react'
import { User } from '@supabase/supabase-js'
import { Message } from 'ai'

export default function ChatDemo() {
  const supabase = createClient()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const { data } = await supabase.auth.getUser()
        setUser(data.user)
      } catch (error) {
        console.error('Error fetching user:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchUser()
  }, [supabase])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="flex space-x-2">
          <div className="w-3 h-3 rounded-full bg-primary animate-bounce" />
          <div className="w-3 h-3 rounded-full bg-primary animate-bounce [animation-delay:0.2s]" />
          <div className="w-3 h-3 rounded-full bg-primary animate-bounce [animation-delay:0.4s]" />
        </div>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen px-4">
        <h1 className="text-2xl font-bold mb-4">Sign in Required</h1>
        <p className="text-muted-foreground mb-6">
          Please sign in to use the chat interface
        </p>
        <a 
          href="/login"
          className="bg-primary text-primary-foreground px-4 py-2 rounded-md"
        >
          Sign In
        </a>
      </div>
    )
  }

  // Example messages for demonstration
  const demoChat = {
    id: "demo-chat",
    name: "SQL Analysis Demo",
    messages: [
      { 
        id: "1", 
        role: "assistant" as const, 
        content: "Hello! I'm your database analysis assistant. How can I help you today?" 
      },
      { 
        id: "2", 
        role: "user" as const, 
        content: "Can you show me the top 5 users in my database?" 
      },
      {
        id: "3",
        role: "assistant" as const,
        content: "I'd be happy to help you find the top 5 users in your database. Let me query that for you:\n\n```sql\nSELECT \n  id, \n  username, \n  email, \n  created_at, \n  last_login_at\nFROM users\nORDER BY last_login_at DESC\nLIMIT 5;\n```\n\nThis query will return the 5 most recently active users, sorted by their last login time. If you need different criteria for \"top users\" (like most purchases, highest activity, etc.), let me know and I can adjust the query accordingly."
      },
      {
        id: "4",
        role: "user" as const,
        content: "Can you also show me the total number of purchases by user?"
      },
      {
        id: "5",
        role: "assistant" as const,
        content: "Certainly! Here's a query to show the total number of purchases by each user, sorted by the highest number of purchases first:\n\n```sql\nSELECT\n  u.id,\n  u.username,\n  u.email,\n  COUNT(p.id) as total_purchases,\n  SUM(p.amount) as total_spent\nFROM users u\nLEFT JOIN purchases p ON u.id = p.user_id\nGROUP BY u.id, u.username, u.email\nORDER BY total_purchases DESC;\n```\n\nThis query will:\n\n1. Count the number of purchases for each user\n2. Calculate the total amount spent by each user\n3. Sort the results by the number of purchases in descending order\n\nThe LEFT JOIN ensures that even users with no purchases will be included in the results (with a count of 0)."
      }
    ] as Message[]
  }

  return (
    <div className="flex flex-col h-screen w-full">
      <ChatInterfaceModern 
        chat={demoChat} 
        user={user} 
      />
    </div>
  )
} 