'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useToast } from '@/hooks/use-toast'
import { useAppLocalStorage } from '@/hooks/use-app-local-storage'
import { validateDbConnection } from '@/actions/validate-db-connection'
import { validateOpenaiKey } from '@/actions/validate-openai-key'

export default function SettingsPage() {
  const { value, setValue } = useAppLocalStorage()
  const [connectionString, setConnectionString] = useState(value.connectionString || '')
  const [openaiApiKey, setOpenaiApiKey] = useState(value.openaiApiKey || '')
  const [model, setModel] = useState(value.model || 'gpt-4o-mini')
  const [isLoading, setIsLoading] = useState(false)
  const { toast } = useToast()
  const router = useRouter()

  async function handleSave() {
    setIsLoading(true)
    
    try {
      // Validate connection string if provided
      if (connectionString) {
        const validationResult = await validateDbConnection(connectionString)
        if (validationResult !== 'Valid connection') {
          throw new Error(`Database connection error: ${validationResult}`)
        }
      }
      
      // Validate OpenAI API key if provided
      if (openaiApiKey) {
        const openaiResult = await validateOpenaiKey(openaiApiKey)
        if (openaiResult !== 'Valid API key') {
          throw new Error('Invalid OpenAI API key')
        }
      }
      
      // Save to local storage
      setValue({
        connectionString,
        openaiApiKey,
        model: model || 'gpt-4o-mini',
      })
      
      toast({
        title: 'Settings saved',
        description: 'Your connection settings have been saved successfully.',
      })
      
      // Navigate back to app
      router.push('/app')
      
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'An unknown error occurred',
        variant: 'destructive',
      })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="container mx-auto py-8">
      <Card className="max-w-2xl mx-auto">
        <CardHeader>
          <CardTitle>Connection Settings</CardTitle>
          <CardDescription>
            Configure your database connection and AI settings
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <label htmlFor="connectionString" className="text-sm font-medium">
              Database Connection String
            </label>
            <Input
              id="connectionString"
              placeholder="postgresql://username:password@localhost:5432/database"
              value={connectionString}
              onChange={(e) => setConnectionString(e.target.value)}
              className="w-full"
            />
            <p className="text-xs text-muted-foreground">
              Your connection string is stored locally in your browser and never sent to our servers.
            </p>
          </div>
          
          <div className="space-y-2">
            <label htmlFor="openaiApiKey" className="text-sm font-medium">
              OpenAI API Key
            </label>
            <Input
              id="openaiApiKey"
              type="password"
              placeholder="sk-..."
              value={openaiApiKey}
              onChange={(e) => setOpenaiApiKey(e.target.value)}
              className="w-full"
            />
            <p className="text-xs text-muted-foreground">
              Optional: Use your own OpenAI API key for better control and billing.
            </p>
          </div>
          
          <div className="pt-4 flex justify-end space-x-2">
            <Button variant="outline" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isLoading}>
              {isLoading ? 'Saving...' : 'Save Settings'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
} 