// Script to load structured documentation data
// Usage: node scripts/load_structured_documentation.js

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { SchemaVectorStore } = require('../utils/vectorStore');
const { getPublicTablesWithColumns, getForeignKeyConstraints } = require('../app/api/chat/utils');

// Load documentation from JSON file
function loadStructuredDocumentation() {
  try {
    const data = fs.readFileSync(path.join(__dirname, '../tmp/structured_documentation.json'), 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error loading structured documentation:', error);
    process.exit(1);
  }
}

async function main() {
  try {
    console.log('Loading structured documentation into vector store...');
    
    // Check environment variables
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const openaiApiKey = process.env.OPENAI_API_KEY;
    const connectionString = process.env.POSTGRES_URL;
    
    if (!supabaseUrl || !supabaseKey || !openaiApiKey || !connectionString) {
      console.error('Missing required environment variables. Please check your .env file.');
      process.exit(1);
    }
    
    // Create vector store instance
    console.log('Initializing vector store...');
    const vectorStore = new SchemaVectorStore(
      supabaseUrl,
      supabaseKey,
      openaiApiKey
    );
    
    await vectorStore.initialize();
    
    // Load structured documentation
    console.log('Loading structured documentation from file...');
    const documentation = loadStructuredDocumentation();
    console.log(`Loaded ${documentation.length} documentation entries`);
    
    // Clear existing vectors
    console.log('Clearing existing vectors...');
    await vectorStore.clearVectorStore();
    
    // Get tables and constraints from database
    console.log('Fetching database schema...');
    const targetTables = [
      'subject_areas',
      'testing_centers',
      'dioceses',
      'domains',
      'testing_sections',
      'ark_admin_dashes',
      'school_classes',
      'testing_section_students',
      'testing_center_dashboards',
      'tc_grade_levels_snapshot_dcqs',
      'tc_grade_levels_snapshots',
      'diocese_student_snapshot_dcqs',
      'diocese_student_snapshot_grade_levels',
    ];
    
    const tables = await getPublicTablesWithColumns(connectionString, targetTables);
    const constraints = await getForeignKeyConstraints(connectionString);
    
    // Store schema info in vector store with new structured documentation
    console.log('Storing schema information with structured documentation...');
    await vectorStore.storeSchemaInfo(tables, constraints, documentation);
    
    console.log('Successfully loaded structured documentation into vector store!');
    console.log('You can now test the retrieval with:');
    console.log('http://localhost:3000/api/chat?action=test_retrieval&query=your query');
    
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main(); 