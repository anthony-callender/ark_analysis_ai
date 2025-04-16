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
    
    // Test queries
    const testQueries = [
      "What is the average knowledge score for students who attend mass?",
      "Show me test performance by diocese",
      "Which testing centers have the highest scores?",
      "How many students attend mass regularly?",
      "What are the knowledge scores for different grade levels?"
    ];
    
    console.log('\n=== Running Test Queries ===\n');
    
    for (const query of testQueries) {
      console.log(`\nQuery: "${query}"`);
      
      try {
        const results = await vectorStore.searchSchemaInfo(query, 5);
        console.log(`Found ${results.length} relevant schema items:`);
        
        if (results.length > 0) {
          for (const result of results) {
            console.log(`- ${result.type}: ${result.table_name}${result.column_name ? `.${result.column_name}` : ''} (Similarity: ${result.similarity.toFixed(4)})`);
          }
        } else {
          console.log('No relevant schema items found.');
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

// Run the test
testVectorStore().catch(console.error); 