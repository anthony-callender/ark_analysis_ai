import { createClient } from '@/utils/supabase/server'

export const dynamic = 'force-dynamic'

export default async function DebugPage() {
  const supabase = await createClient()
  let results = []
  
  // Get tables from Supabase
  const { data: tables, error: tablesError } = await supabase
    .from('pg_catalog.pg_tables')
    .select('tablename')
    .eq('schemaname', 'public')

  // Try to get dioceses with corrected table name
  const { data: diocesesData, error: diocesesError } = await supabase
    .from('dioceses')
    .select('*')
    .limit(10)
  
  // Try with original table name
  const { data: dioceseData, error: dioceseError } = await supabase
    .from('diocese')
    .select('*')
    .limit(10)
  
  // Try to get testing centers
  const { data: testingCenters, error: testingCentersError } = await supabase
    .from('testing_centers')
    .select('*')
    .limit(10)
  
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Database Debug Page</h1>
      
      <div className="mb-8">
        <h2 className="text-xl font-semibold mb-2">Tables in Database</h2>
        {tablesError ? (
          <div className="text-red-500">Error getting tables: {tablesError.message}</div>
        ) : (
          <pre className="bg-gray-100 p-4 rounded">{JSON.stringify(tables, null, 2)}</pre>
        )}
      </div>
      
      <div className="mb-8">
        <h2 className="text-xl font-semibold mb-2">Dioceses Table (plural)</h2>
        {diocesesError ? (
          <div className="text-red-500">Error: {diocesesError.message}</div>
        ) : (
          <pre className="bg-gray-100 p-4 rounded">{JSON.stringify(diocesesData, null, 2)}</pre>
        )}
      </div>
      
      <div className="mb-8">
        <h2 className="text-xl font-semibold mb-2">Diocese Table (singular)</h2>
        {dioceseError ? (
          <div className="text-red-500">Error: {dioceseError.message}</div>
        ) : (
          <pre className="bg-gray-100 p-4 rounded">{JSON.stringify(dioceseData, null, 2)}</pre>
        )}
      </div>
      
      <div className="mb-8">
        <h2 className="text-xl font-semibold mb-2">Testing Centers</h2>
        {testingCentersError ? (
          <div className="text-red-500">Error: {testingCentersError.message}</div>
        ) : (
          <pre className="bg-gray-100 p-4 rounded">{JSON.stringify(testingCenters, null, 2)}</pre>
        )}
      </div>
    </div>
  )
} 