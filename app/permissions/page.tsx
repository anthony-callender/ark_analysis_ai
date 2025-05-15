'use client'

import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { DebugSession } from '@/components/debug-session'
import { UserAccessInfo } from '@/components/user-access-info'

export default function PermissionsPage() {
  const { data: session, status } = useSession()
  const [query, setQuery] = useState<string>('SELECT * FROM testing_centers')
  const [result, setResult] = useState<string>('')
  const [loading, setLoading] = useState<boolean>(false)
  
  async function runQuery() {
    setLoading(true)
    try {
      const response = await fetch('/api/run-sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          sql: query,
          connectionString: localStorage.getItem('connectionString') || '' 
        }),
      })
      
      const data = await response.text()
      setResult(data)
    } catch (error) {
      setResult(error instanceof Error ? error.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }
  
  if (status === 'loading') {
    return <div className="flex justify-center items-center h-96">Loading session...</div>
  }
  
  if (!session) {
    return (
      <div className="max-w-4xl mx-auto p-8">
        <h1 className="text-3xl font-bold mb-4">Permission Test</h1>
        <div className="bg-red-100 p-6 rounded-lg">
          <h2 className="font-bold text-lg mb-2">Not Authenticated</h2>
          <p>You must be logged in to access this page and test permissions.</p>
        </div>
      </div>
    )
  }
  
  return (
    <div className="max-w-4xl mx-auto p-8">
      <h1 className="text-3xl font-bold mb-4">Permission Test</h1>
      
      <div className="mb-6">
        <UserAccessInfo />
      </div>
      
      <div className="mb-8">
        <h2 className="text-xl font-semibold mb-2">Test SQL Query</h2>
        <p className="text-sm mb-4">Enter a SQL query to see if you have permission to run it.</p>
        
        <div className="mb-4">
          <textarea
            className="w-full h-32 p-2 border rounded-md"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Enter SQL query..."
          />
        </div>
        
        <div className="mb-4">
          <button
            className="bg-blue-500 text-white px-4 py-2 rounded-md hover:bg-blue-600 disabled:bg-blue-300"
            onClick={runQuery}
            disabled={loading || !query.trim()}
          >
            {loading ? 'Running Query...' : 'Run Query'}
          </button>
        </div>
        
        <div className="mt-4">
          <h3 className="font-semibold mb-2">Result:</h3>
          <div className="bg-gray-100 p-4 rounded-md overflow-auto max-h-64">
            <pre className="whitespace-pre-wrap text-sm">
              {result || 'No result yet'}
            </pre>
          </div>
        </div>
      </div>
      
      <div className="mt-8 border-t pt-4">
        <h2 className="text-xl font-semibold mb-2">Your Session</h2>
        <DebugSession />
      </div>
    </div>
  )
} 