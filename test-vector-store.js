// Test script for the SchemaVectorStore changes
require('dotenv').config();
const { SchemaVectorStore } = require('./utils/vectorStore');

async function testVectorStore() {
  try {
    console.log('Initializing vector store for testing...');
    // Load environment variables
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const openaiApiKey = process.env.OPENAI_API_KEY;
    
    if (!supabaseUrl || !supabaseKey || !openaiApiKey) {
      console.error('Missing required environment variables.');
      console.error('Required: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY');
      return;
    }
    
    // Create vector store instance
    const vectorStore = new SchemaVectorStore(
      supabaseUrl,
      supabaseKey,
      openaiApiKey
    );
    
    await vectorStore.initialize();
    console.log('Vector store initialized successfully');
    
    // Get all documentation from database to verify storage
    await listAllDocumentationInVectorStore(vectorStore);
    
    // Test queries
    const testQueries = [
      "What is the average knowledge score for students who attend mass?",
      "Show me test performance by diocese",
      "Which testing centers have the highest scores?",
      "How many students attend mass regularly?",
      "What are the knowledge scores for different grade levels?",
      "How do I get the academic year for 2023?",
      "What is the hierarchy for accessing subject information?"
    ];
    
    console.log('\n=== Running Test Queries ===\n');
    
    for (const query of testQueries) {
      console.log(`\nQuery: "${query}"`);
      
      try {
        const results = await vectorStore.searchSchemaInfo(query, 20);
        console.log(`Found ${results.length} relevant documentation items:`);
        
        if (results.length > 0) {
          for (const result of results) {
            console.log(`- ${result.type}: ${result.content}`);
            console.log(`  Similarity: ${result.similarity.toFixed(4)}`);
          }
        } else {
          console.log('No relevant documentation found.');
        }
      } catch (error) {
        console.error(`Error searching for query "${query}":`, error);
      }
    }
    
    console.log('\n=== Test Completed ===\n');
    
  } catch (error) {
    console.error('Error testing vector store:', error);
  }
}

// Helper function to list all documentation stored in the vector store
async function listAllDocumentationInVectorStore(vectorStore) {
  try {
    console.log('\n=== Listing All Documentation in Vector Store ===\n');
    
    // Access Supabase directly to get all documentation
    const client = vectorStore.getSupabaseClient();
    const { data, error } = await client
      .from('schema_vectors')
      .select('*')
      .eq('type', 'documentation')
      .order('id');
    
    if (error) {
      throw new Error(`Failed to retrieve documentation: ${error.message}`);
    }
    
    console.log(`Found ${data.length} documentation entries in the vector store:`);
    
    if (data.length > 0) {
      for (let i = 0; i < data.length; i++) {
        console.log(`${i + 1}. ${data[i].content}`);
      }
    } else {
      console.log('No documentation found in the vector store.');
    }
    
    console.log('\n=== End of Documentation Listing ===\n');
    return data;
  } catch (error) {
    console.error('Error listing documentation:', error);
    return [];
  }
}

// Run the test
testVectorStore().catch(console.error); 