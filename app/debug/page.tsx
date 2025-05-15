'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { DebugSession } from '@/components/debug-session'
import { UserAccessInfo } from '@/components/user-access-info'
import { addConstraintsToQuery } from '@/utils/auth-permissions'

export default function DebugPage() {
  const { data: session, status } = useSession()
  const [originalQuery, setOriginalQuery] = useState('SELECT * FROM testing_centers')
  const [modifiedQuery, setModifiedQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  
  async function processQuery() {
    setLoading(true)
    setError('')
    try {
      const result = await addConstraintsToQuery(originalQuery)
      setModifiedQuery(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }
  
  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Role-Based Query Debug</h1>
      
      <div className="mb-4">
        <UserAccessInfo />
      </div>
      
      <div className="grid grid-cols-2 gap-4">
        <div>
          <h2 className="text-lg font-semibold mb-2">Original Query</h2>
          <textarea 
            className="w-full h-32 p-2 border rounded"
            value={originalQuery}
            onChange={(e) => setOriginalQuery(e.target.value)}
          />
        </div>
        
        <div>
          <h2 className="text-lg font-semibold mb-2">Modified Query</h2>
          <div className="w-full h-32 p-2 border rounded bg-gray-50 overflow-auto">
            {loading ? 'Processing...' : modifiedQuery || 'No query processed yet'}
          </div>
        </div>
      </div>
      
      {error && (
        <div className="mt-4 p-3 bg-red-100 text-red-700 rounded">
          {error}
        </div>
      )}
      
      <div className="mt-4">
        <button 
          onClick={processQuery}
          disabled={loading}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-blue-300"
        >
          Process Query
        </button>
      </div>
      
      <div className="mt-8">
        <DebugSession />
      </div>
    </div>
  )
} 