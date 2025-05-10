import { useLocalStorage } from 'usehooks-ts'

export function useAppLocalStorage() {
  // URL encode the special character '?' in the password to avoid parsing issues
  const defaultConnectionString = 'postgresql://postgres.gxhzssazccbjmtopgrsa:Whatistim3%3F@aws-0-us-east-1.pooler.supabase.com:5432/postgres'
  
  const [value, setValue] = useLocalStorage('__app-config__', {
    connectionString: defaultConnectionString,
    openaiApiKey: '',
    model: 'gpt-4o-mini',
  })

  return {
    value,
    setValue,
  }
}
