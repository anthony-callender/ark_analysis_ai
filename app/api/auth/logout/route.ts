import { NextResponse } from 'next/server'
import { Client } from 'pg'
import { getSessionCookie, deleteSessionCookie, deleteSession } from '@/utils/auth'

export async function POST() {
  try {
    const token = getSessionCookie()
    if (!token) {
      return NextResponse.json({ message: 'Not logged in' }, { status: 401 })
    }

    const client = new Client({
      connectionString: process.env.DATABASE_URL
    })

    await client.connect()
    await deleteSession(client, token)
    await client.end()

    deleteSessionCookie()

    return NextResponse.json({ message: 'Logged out successfully' })
  } catch (error) {
    console.error('Logout error:', error)
    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 }
    )
  }
} 