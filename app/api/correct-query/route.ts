import { createOpenAI } from '@ai-sdk/openai'
import { generateText } from 'ai'
import { headers } from 'next/headers'

// Helper function to clean SQL code of any markdown or extra content
function cleanSqlCode(sql: string): string {
  console.log("Original SQL response:", sql);
  
  // Remove markdown code block markers if they exist
  let cleaned = sql.replace(/^```sql\n|^```\n|```$/gm, '');
  
  // Remove any explanatory text before the SQL (if the model added it despite instructions)
  if (cleaned.includes("SELECT") && !cleaned.trim().startsWith("SELECT")) {
    cleaned = cleaned.substring(cleaned.indexOf("SELECT"));
  }
  
  console.log("Cleaned SQL:", cleaned);
  return cleaned.trim();
}

export async function POST(req: Request) {
  try {
    const headers_ = await headers()
    const connectionString = headers_.get('x-connection-string')
    const openaiApiKey = process.env.OPENAI_API_KEY
    
    if (!openaiApiKey) {
      return new Response('Missing OpenAI API key', { status: 500 })
    }

    if (!connectionString) {
      return new Response('Missing connection string', { status: 400 })
    }

    const { sqlCode } = await req.json()
    
    if (!sqlCode) {
      return new Response('No SQL code provided', { status: 400 })
    }

    console.log("SQL Code received by API:", sqlCode);
    
    const openai = createOpenAI({
      apiKey: openaiApiKey,
    })

    const result = await generateText({
      model: openai('gpt-4.1-mini'),
      system: `
      You are a specialized SQL correction assistant focused on PostgreSQL. Your task is to fix errors in SQL code.
      
      CRITICAL INSTRUCTIONS:
      1. Return ONLY the corrected SQL code - no explanations, no comments, no backticks
      2. Fix syntax errors like missing commas, incorrect keywords, incorrect syntax
      3. Fix other common errors (column references, table joins, etc.)
      4. Preserve the overall structure and intent of the query
      5. Ensure proper SQL statement termination
      6. Your output should be ONLY the corrected SQL code ready to execute
      
      Example input: "SELECT column1 column2 FROM table"
      Example output: "SELECT column1, column2 FROM table"
      
      DO NOT preface with explanations. DO NOT wrap in code blocks. ONLY return the SQL code.
      `,
      prompt: sqlCode,
    })

    // Clean the result to ensure only SQL code is returned
    const correctedSql = cleanSqlCode(result.text);
    
    return new Response(JSON.stringify({ correctedSql }), {
      headers: {
        'Content-Type': 'application/json'
      }
    })
  } catch (error) {
    console.error('Error in query correction:', error)
    return new Response('Error correcting query', { status: 500 })
  }
} 