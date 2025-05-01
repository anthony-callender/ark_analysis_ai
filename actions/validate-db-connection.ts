'use server'

import { Client } from 'pg'

export async function validateDbConnection(connectionString: string): Promise<string> {
  if (!connectionString) {
    return 'Connection string is required'
  }

  const client = new Client({
    connectionString,
  })

  try {
    // Try to connect
    await client.connect()
    
    // Run a simple query to verify connection
    const result = await client.query('SELECT NOW() as current_time')
    
    // Properly close the connection
    await client.end()
    
    if (result.rows.length > 0) {
      return 'Valid connection'
    } else {
      return 'Connected but failed to execute test query'
    }
  } catch (error) {
    // Close the connection if it was opened
    try {
      await client.end()
    } catch (e) {
      // Ignore errors during cleanup
    }
    
    if (error instanceof Error) {
      return `Connection error: ${error.message}`
    }
    
    return 'Unknown connection error'
  }
}
