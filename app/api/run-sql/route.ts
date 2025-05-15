import { NextResponse } from 'next/server'
import { runSql } from '@/actions/run-sql'

export async function POST(request: Request) {
  try {
    const { sql, connectionString } = await request.json()
    
    if (!sql || !connectionString) {
      return NextResponse.json(
        { error: 'SQL query and connection string are required' },
        { status: 400 }
      )
    }
    
    const result = await runSql(sql, connectionString)
    
    return NextResponse.json({ result })
  } catch (error) {
    console.error('Error running SQL:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
} 