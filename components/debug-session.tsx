'use client'

import { useSession } from 'next-auth/react'

export function DebugSession() {
  const { data: session, status } = useSession()
  
  if (status === 'loading') {
    return <div>Loading session...</div>
  }
  
  if (!session) {
    return <div>Not authenticated</div>
  }
  
  return (
    <div className="p-4 bg-slate-100 rounded-md my-4 overflow-auto max-h-96">
      <h3 className="font-bold text-lg mb-2">Session Debug</h3>
      <pre className="whitespace-pre-wrap text-xs">
        {JSON.stringify(session, null, 2)}
      </pre>
    </div>
  )
} 