import { createBrowserClient } from "@supabase/ssr";
import { Database } from "@/database.types";

export const createClient = () => {
  // In a real production environment, you would NEVER expose the 
  // service role key to the client. This is only for this example 
  // to bypass authentication requirements.
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
};
