'use server'

import OpenAI from 'openai'

export async function validateOpenaiKey(apiKey: string): Promise<string> {
  if (!apiKey) {
    return 'API key is required'
  }

  // Check basic format
  if (!apiKey.startsWith('sk-')) {
    return 'Invalid API key format'
  }

  const openai = new OpenAI({
    apiKey,
  })

  try {
    // Try to make a simple API call to verify the key
    const models = await openai.models.list()
    
    if (models && models.data && models.data.length > 0) {
      return 'Valid API key'
    } else {
      return 'API key appears valid but unable to retrieve models'
    }
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('401') || error.message.includes('unauthorized')) {
        return 'Invalid or expired API key'
      }
      return `API key validation error: ${error.message}`
    }
    
    return 'Unknown error validating API key'
  }
}
