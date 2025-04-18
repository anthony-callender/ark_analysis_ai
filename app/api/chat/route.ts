import { createOpenAI } from '@ai-sdk/openai'
import {
  streamText,
  convertToCoreMessages,
  tool,
  smoothStream,
  appendResponseMessages,
  generateText,
} from 'ai'
import { headers } from 'next/headers'
import { z } from 'zod'
import { DIOCESE_CONFIG } from '@/config/diocese'
import {
  getExplainForQuery,
  getForeignKeyConstraints,
  getIndexes,
  getIndexStatsUsage,
  getPublicTablesWithColumns,
  getTableStats,
} from './utils'
import { createClient } from '@/utils/supabase/server'
import { revalidatePath } from 'next/cache'
import { SchemaVectorStore, StructuredDocumentation } from '@/utils/vectorStore'

// Define the list of target tables for vector store
const TARGET_TABLES = [
  {
    "id": "chunk_01",
    "title": "Filtering by user role",
    "content": "Always filter by user role when querying the tables testing_section_students or user_answers. Teachers have role = 5; Students have role = 7. Tables may contain mixed roles; never assume a single user type without explicit filtering.",
    "metadata": {
      "category": "Filtering rules",
      "tables": ["testing_section_students", "user_answers"],
      "columns": ["role"],
      "keywords": ["teacher", "student", "role id"]
    }
  },
  {
    "id": "chunk_02",
    "title": "ID-based grouping & joins",
    "content": "Use IDs—not name strings—for GROUP BY clauses, JOIN conditions, and filtering.",
    "metadata": {
      "category": "Query‑writing rules",
      "keywords": ["group by", "join", "ids", "names"]
    }
  },
  {
    "id": "chunk_03",
    "title": "Academic‑year time filters",
    "content": "When a query refers to \"last year\", use academic_year_id = current_year_id - 1. Do not use current_year = FALSE.",
    "metadata": {
      "category": "Time windows",
      "tables": ["academic_years"],
      "columns": ["academic_year_id", "current_year"],
      "keywords": ["last year", "time filter"]
    }
  },
  {
    "id": "chunk_04",
    "title": "Academic‑year ID map",
    "content": "Mapping of academic_years.id to calendar years: 2020 → 1, 2021 → 2, 2022 → 3, 2023 → 4, 2024 → 5.",
    "metadata": {
      "category": "Reference tables",
      "tables": ["academic_years"],
      "columns": ["id"],
      "keywords": ["year map"]
    }
  },
  {
    "id": "chunk_05",
    "title": "Knowledge‑score formula",
    "content": "Score formula: (knowledge_score / NULLIF(knowledge_total,0)) * 100. Always cast to float: knowledge_score::float / knowledge_total::float. Filter out NULLs with WHERE knowledge_score IS NOT NULL AND knowledge_total IS NOT NULL.",
    "metadata": {
      "category": "Score rules",
      "tables": ["testing_section_students"],
      "columns": ["knowledge_score", "knowledge_total"],
      "keywords": ["score", "NULLIF", "float cast"]
    }
  },
  {
    "id": "chunk_06",
    "title": "Diocese naming convention",
    "content": "Each diocese name starts with either 'Diocese of ___' or 'Archdiocese of ___'. Use that full prefix in filters.",
    "metadata": {
      "category": "Naming rules",
      "tables": ["dioceses"],
      "columns": ["name"],
      "keywords": ["diocese", "archdiocese"]
    }
  },
  {
    "id": "chunk_07",
    "title": "Hierarchy – average score for subject & grade",
    "content": "To answer 'What is the average score in [subject] for [grade level]?', join tables in this order: dioceses → testing_centers → testing_sections → testing_section_students.",
    "metadata": {
      "category": "Hierarchy",
      "question_template": "avg score subject grade",
      "tables": ["dioceses", "testing_centers", "testing_sections", "testing_section_students"],
      "keywords": ["average score", "grade", "subject"]
    }
  },
  {
    "id": "chunk_08",
    "title": "Hierarchy – average score for subject by grade in diocese",
    "content": "To answer 'What is the average score for [subject] in [diocese] by grade?', use the path: dioceses → testing_centers → testing_sections → testing_section_students.",
    "metadata": {
      "category": "Hierarchy",
      "question_template": "avg score subject diocese grade",
      "tables": ["dioceses", "testing_centers", "testing_sections", "testing_section_students"],
      "keywords": ["average score", "grade", "diocese"]
    }
  },
  {
    "id": "chunk_09",
    "title": "Hierarchy – average score over time period",
    "content": "For 'What is the average score in [subject] over the past [time period]?', use the same hierarchy and add academic_year filters.",
    "metadata": {
      "category": "Hierarchy",
      "question_template": "avg score subject time period",
      "tables": ["dioceses", "testing_centers", "testing_sections", "testing_section_students", "academic_years"],
      "keywords": ["average score", "time period", "academic years"]
    }
  },
  {
    "id": "chunk_10",
    "title": "Hierarchy – subject ID lookup",
    "content": "To resolve a subject name to its ID, join subject_areas → testing_section_students.",
    "metadata": {
      "category": "Hierarchy",
      "tables": ["subject_areas", "testing_section_students"],
      "keywords": ["subject id"]
    }
  },
  {
    "id": "chunk_11",
    "title": "Subject‑areas reference",
    "content": "subject_areas.id mapping: Theology = 1, Reading = 2, Math = 3.",
    "metadata": {
      "category": "Reference tables",
      "tables": ["subject_areas"],
      "columns": ["id", "name"],
      "keywords": ["subject areas"]
    }
  },
  {
    "id": "chunk_12",
    "title": "Domain scores table usage",
    "content": "Use testing_section_student_domain_scores for domain‑related questions. Key fields: knowledge_score, affinity_score, knowledge_total, affinity_total, domain_id.",
    "metadata": {
      "category": "Domain scores",
      "tables": ["testing_section_student_domain_scores"],
      "columns": ["domain_id", "knowledge_score", "affinity_score"],
      "keywords": ["domain", "score"]
    }
  },
  {
    "id": "chunk_13",
    "title": "Table – dioceses",
    "content": "Stores each diocese: id (PK), name, address_line_1, address_line_2, city, state, zipcode, country, deactivate (boolean).",
    "metadata": {
      "category": "Table docs",
      "tables": ["dioceses"],
      "keywords": ["diocese table"]
    }
  },
  {
    "id": "chunk_14",
    "title": "Table – testing_centers",
    "content": "testing_centers: id (PK), name, address_line_1, address_line_2, city, state, zipcode, country, diocese_id → dioceses(id).",
    "metadata": {
      "category": "Table docs",
      "tables": ["testing_centers"]
    }
  },
  {
    "id": "chunk_15",
    "title": "Table – testing_sections",
    "content": "testing_sections: id (PK), testing_center_id → testing_centers(id), academic_year_id → academic_years(id).",
    "metadata": {
      "category": "Table docs",
      "tables": ["testing_sections"]
    }
  },
  {
    "id": "chunk_16",
    "title": "Table – testing_section_students",
    "content": "testing_section_students: id (PK), user_id, testing_section_id, grade_level, knowledge_score, knowledge_total, subject_area_id, academic_year_id, status, completed_date, progress, scored_status, percentile_rank, pre_test, role, assorted diocese‑specific scores.",
    "metadata": {
      "category": "Table docs",
      "tables": ["testing_section_students"]
    }
  },
  {
    "id": "chunk_17",
    "title": "Table – testing_section_student_domain_scores",
    "content": "testing_section_student_domain_scores: id (PK), testing_section_student_id, domain_id, knowledge_score, knowledge_total, affinity_score, affinity_total.",
    "metadata": {
      "category": "Table docs",
      "tables": ["testing_section_student_domain_scores"]
    }
  },
  {
    "id": "chunk_18",
    "title": "Table – users",
    "content": "users: id (PK), role. Role IDs: Teachers = 5, Students = 7.",
    "metadata": {
      "category": "Table docs",
      "tables": ["users"],
      "columns": ["id", "role"],
      "keywords": ["user count", "teacher", "student"]
    }
  },
  {
    "id": "chunk_19",
    "title": "Domain ID reference",
    "content": "Domain names used in testing_section_student_domain_scores: Reading, Mathematics, Virtue, Sacraments & Liturgy, Prayer, Morality, Living Discipleship, Creed & Salvation History.",
    "metadata": {
      "category": "Reference tables",
      "tables": ["domains", "testing_section_student_domain_scores"],
      "columns": ["domain_id", "name"],
      "keywords": ["domain names"]
    }
  },
  {
    "id": "tmpl_01",
    "title": "Template – average teacher knowledge score per domain",
    "content": "Question: What is the average teacher's knowledge score for each domain?\nSQL:\nSELECT\n    d.name AS domain_name,\n    AVG(CAST(tsssd.knowledge_score AS FLOAT) / tsssd.knowledge_total) * 100 AS average_domain_performance\nFROM\n    testing_section_students tss\nJOIN\n    testing_section_student_domain_scores tsssd\n        ON tss.id = tsssd.testing_section_student_id\nJOIN\n    domains d\n        ON tsssd.domain_id = d.id\nJOIN\n    users u\n        ON u.id = tss.user_id\nWHERE\n    (u.role = 5 OR (u.role IS NULL AND tss.grade_level IS NOT NULL))\nGROUP BY\n    d.name\nORDER BY\n    average_domain_performance DESC;",
    "metadata": {
      "category": "Report templates",
      "tables": ["testing_section_students", "testing_section_student_domain_scores", "domains", "users"],
      "keywords": ["average", "knowledge score", "teacher", "domain"]
    }
  },
  {
    "id": "tmpl_02",
    "title": "Template – Eucharist answers by grade",
    "content": "Question: What is the count and percentage of students in each grade level who selected all possible answers to the question "What is the Eucharist?" (question_id = 651)\nSQL:\nSELECT\n    tss.grade_level,\n    COUNT(DISTINCT CASE WHEN ua.answer_id = 4081 THEN ua.user_id END) AS symbol_count,\n    COUNT(DISTINCT CASE WHEN ua.answer_id = 4091 THEN ua.user_id END) AS real_body_blood_count,\n    COUNT(DISTINCT CASE WHEN ua.answer_id = 4101 THEN ua.user_id END) AS staff_symbol_count,\n    COUNT(DISTINCT CASE WHEN ua.answer_id = 4111 THEN ua.user_id END) AS ring_count,\n    (COUNT(DISTINCT CASE WHEN ua.answer_id = 4081 THEN ua.user_id END) * 100.0) / NULLIF(COUNT(DISTINCT ua.user_id), 0) AS symbol_pct,\n    (COUNT(DISTINCT CASE WHEN ua.answer_id = 4091 THEN ua.user_id END) * 100.0) / NULLIF(COUNT(DISTINCT ua.user_id), 0) AS real_body_blood_pct,\n    (COUNT(DISTINCT CASE WHEN ua.answer_id = 4101 THEN ua.user_id END) * 100.0) / NULLIF(COUNT(DISTINCT ua.user_id), 0) AS staff_symbol_pct,\n    (COUNT(DISTINCT CASE WHEN ua.answer_id = 4111 THEN ua.user_id END) * 100.0) / NULLIF(COUNT(DISTINCT ua.user_id), 0) AS ring_pct\nFROM user_answers ua\nINNER JOIN testing_section_students tss ON tss.id = ua.testing_section_student_id\nINNER JOIN users u ON u.id = ua.user_id\nWHERE\n    ua.question_id = 651\n    AND u.role = 7\nGROUP BY\n    tss.grade_level;",
    "metadata": {
      "category": "Report templates",
      "tables": ["user_answers", "testing_section_students", "users"],
      "keywords": ["Eucharist", "question 651", "grade‑level breakdown"]
    }
  },
  {
    "id": "tmpl_03",
    "title": "Template – confess Mortal sins vs knowledge score",
    "content": "Question: What is the average knowledge score for students who believe that we must confess our Mortal sins and should confess venial sins? (question_id = 432)\nSQL:\nSELECT\n    a.body AS answer_name,\n    AVG((CAST(tss.knowledge_score AS FLOAT) / tss.knowledge_total) * 100) AS average_score\nFROM user_answers ua\nINNER JOIN testing_section_students tss ON tss.id = ua.testing_section_student_id\nINNER JOIN users u ON u.id = ua.user_id\nINNER JOIN answers a ON a.id = ua.answer_id\nWHERE\n    ua.question_id = 432\n    AND ua.answer_id IN (1520, 1522, 1523, 1524)\n    AND u.role = 7\nGROUP BY a.body\nORDER BY average_score DESC;",
    "metadata": {
      "category": "Report templates",
      "tables": ["user_answers", "testing_section_students", "users", "answers"],
      "keywords": ["confession", "question 432", "average score"]
    }
  },
  {
    "id": "tmpl_04",
    "title": "Template – Real Presence belief by grade",
    "content": "Question: What is the count and percentage of students in each grade level who selected all possible answers to the question "The Eucharist we receive at Mass is truly the Body and Blood of Jesus Christ?" (question_id = 436)\nSQL:\nSELECT\n    tss.grade_level,\n    COUNT(DISTINCT CASE WHEN ua.answer_id = 1538 THEN ua.user_id END) AS believe_count,\n    COUNT(DISTINCT CASE WHEN ua.answer_id = 1540 THEN ua.user_id END) AS not_believe_count,\n    COUNT(DISTINCT CASE WHEN ua.answer_id = 1539 THEN ua.user_id END) AS struggle_count,\n    COUNT(DISTINCT CASE WHEN ua.answer_id = 1542 THEN ua.user_id END) AS not_know_count,\n    (COUNT(DISTINCT CASE WHEN ua.answer_id = 1538 THEN ua.user_id END) * 100.0) / NULLIF(COUNT(DISTINCT ua.user_id), 0) AS believe,\n    (COUNT(DISTINCT CASE WHEN ua.answer_id = 1540 THEN ua.user_id END) * 100.0) / NULLIF(COUNT(DISTINCT ua.user_id), 0) AS not_believe,\n    (COUNT(DISTINCT CASE WHEN ua.answer_id = 1539 THEN ua.user_id END) * 100.0) / NULLIF(COUNT(DISTINCT ua.user_id), 0) AS struggle,\n    (COUNT(DISTINCT CASE WHEN ua.answer_id = 1542 THEN ua.user_id END) * 100.0) / NULLIF(COUNT(DISTINCT ua.user_id), 0) AS not_know\nFROM user_answers ua\nINNER JOIN testing_section_students tss ON tss.id = ua.testing_section_student_id\nINNER JOIN users u ON u.id = ua.user_id\nWHERE\n    ua.question_id = 436\n    AND u.role = 7\nGROUP BY\n    tss.grade_level;",
    "metadata": {
      "category": "Report templates",
      "tables": ["user_answers", "testing_section_students", "users"],
      "keywords": ["Real Presence", "question 436", "grade distribution"]
    }
  },
  {
    "id": "tmpl_05",
    "title": "Template – avg score for students w/ practice & belief (AY 2022‑23)",
    "content": "Question: What is the average knowledge score for students who attend Mass, have been baptized, and believe in real presence for the academic year 2022‑2023? (academic_year_id = 3)\nSQL:\nSELECT\n    q.body AS question_name,\n    a.body AS answer_name,\n    (CAST(SUM(CASE WHEN tss.academic_year_id = 3 THEN tss.knowledge_score ELSE 0 END) AS FLOAT) / NULLIF(SUM(CASE WHEN tss.academic_year_id = 3 THEN tss.knowledge_total ELSE 0 END), 0)) * 100 AS average_score_academic_year_3\nFROM user_answers ua\nINNER JOIN testing_section_students tss ON tss.id = ua.testing_section_student_id\nINNER JOIN answers a ON a.id = ua.answer_id\nINNER JOIN questions q ON q.id = ua.question_id\nINNER JOIN users u ON u.id = ua.user_id\nWHERE\n    u.role = 7\n    AND (\n        (ua.question_id = 7121 AND ua.answer_id IN (29901, 29911, 29921))\n        OR (ua.question_id = 7111 AND ua.answer_id IN (29891, 29881, 29871, 29861))\n        OR (ua.question_id = 436 AND ua.answer_id IN (1538, 1540, 1539, 1542))\n    )\nGROUP BY q.body, a.body\nORDER BY q.body, a.body;",
    "metadata": {
      "category": "Report templates",
      "tables": ["user_answers", "testing_section_students", "answers", "questions", "users"],
      "keywords": ["academic_year_id 3", "practice & belief", "average score"]
    }
  },
  {
    "id": "tmpl_06",
    "title": "Template – avg student vs teacher knowledge score",
    "content": "Question: What is the average knowledge score for students and teachers?\nSQL:\nSELECT\n    AVG(CASE WHEN u.role = 5 THEN CAST(tss.knowledge_score AS FLOAT) / tss.knowledge_total END) * 100 AS teacher_avg_score,\n    AVG(CASE WHEN u.role = 7 THEN CAST(tss.knowledge_score AS FLOAT) / tss.knowledge_total END) * 100 AS student_avg_score\nFROM testing_section_students tss\nINNER JOIN users u ON u.id = tss.user_id\nWHERE u.role IN (5, 7);",
    "metadata": {
      "category": "Report templates",
      "tables": ["testing_section_students", "users"],
      "keywords": ["average", "student", "teacher"]
    }
  },
  {
    "id": "tmpl_07",
    "title": "Template – student score vs teacher practice & belief (AY 2022‑23)",
    "content": "Question: What is the average knowledge score for students with teachers who attend Mass, have been baptized, and believe in real presence for the academic year 2022‑2023? (academic_year_id = 3)\nSQL:\nSELECT\n    ta.question_id AS teacher_question,\n    tq.body AS teacher_question_name,\n    ta.answer_id AS teacher_answer,\n    a.body AS teacher_answer_text,\n    (CAST(SUM(tss.knowledge_score) AS FLOAT) / SUM(tss.knowledge_total)) * 100 AS average_score\nFROM testing_section_students tss\nINNER JOIN users s ON s.id = tss.user_id AND s.role = 7\nINNER JOIN testing_sections ts ON ts.id = tss.testing_section_id\nINNER JOIN users t ON t.id = ts.user_id AND t.role = 5\nINNER JOIN user_answers ta ON ta.user_id = t.id AND ta.question_id IN (7121, 7111, 436)\nINNER JOIN questions tq ON tq.id = ta.question_id\nINNER JOIN answers a ON a.id = ta.answer_id\nWHERE tss.academic_year_id = 3\nGROUP BY ta.question_id, tq.body, ta.answer_id, a.body\nORDER BY ta.question_id, ta.answer_id;",
    "metadata": {
      "category": "Report templates",
      "tables": ["testing_section_students", "users", "testing_sections", "user_answers", "questions", "answers"],
      "keywords": ["teacher practice", "student score", "academic_year_id 3"]
    }
  },
  {
    "id": "tmpl_08",
    "title": "Template – total students & teachers (AY 2023‑24)",
    "content": "Question: What is the total number of students and teachers for the academic year 2023‑2024? (academic_year_id = 4)\nSQL:\nSELECT\n    COUNT(DISTINCT CASE WHEN u.role = 7 THEN tss.user_id END) AS total_students,\n    COUNT(DISTINCT CASE WHEN u.role = 5 THEN tss.user_id END) AS total_teachers\nFROM testing_section_students tss\nINNER JOIN users u ON u.id = tss.user_id\nWHERE tss.academic_year_id IN (4);",
    "metadata": {
      "category": "Report templates",
      "tables": ["testing_section_students", "users"],
      "keywords": ["count", "students", "teachers", "academic_year_id 4"]
    }
  }
] ;

// Create a singleton vector store
let vectorStoreInstance: SchemaVectorStore | null = null;
let schemaStored = false;

// Helper function to get or create vector store instance
async function getVectorStore(apiKey: string): Promise<SchemaVectorStore> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase configuration');
    throw new Error('Server configuration error');
  }
  
  if (!vectorStoreInstance) {
    console.log('Creating new vector store instance');
    vectorStoreInstance = new SchemaVectorStore(
      supabaseUrl,
      supabaseServiceKey,
      apiKey
    );
    await vectorStoreInstance.initialize();
  }
  
  return vectorStoreInstance;
}

// Force rebuild of schema vectors with filtered tables
export async function GET(req: Request) {
  const searchParams = new URL(req.url).searchParams;
  const action = searchParams.get('action');
  
  if (action === 'update_schema') {
    try {
      // Get the database connection string
      const connectionString = process.env.POSTGRES_URL;
      if (!connectionString) {
        return new Response('Missing database connection string', { status: 500 });
      }
      
      // Create Postgres client
      const { Pool } = require('pg');
      const pool = new Pool({ connectionString });
      
      console.log('Updating schema_vectors table to add title column...');
      
      // Add title column to schema_vectors table if it doesn't exist
      await pool.query(`
        ALTER TABLE public.schema_vectors 
        ADD COLUMN IF NOT EXISTS title TEXT;
      `);
      
      // Update the match_schema_vectors function to return the title column
      await pool.query(`
        CREATE OR REPLACE FUNCTION match_schema_vectors(
          query_embedding VECTOR(1536),
          match_threshold FLOAT,
          match_count INT
        )
        RETURNS TABLE (
          id TEXT,
          content TEXT,
          type TEXT,
          similarity FLOAT,
          table_name TEXT,
          column_name TEXT,
          metadata JSONB,
          title TEXT
        )
        LANGUAGE plpgsql
        AS $$
        BEGIN
          RETURN QUERY
          SELECT
            sv.id,
            sv.content,
            sv.type,
            1 - (sv.embedding <=> query_embedding) as similarity,
            sv.table_name,
            sv.column_name,
            sv.metadata,
            sv.title
          FROM
            schema_vectors sv
          WHERE
            1 - (sv.embedding <=> query_embedding) > match_threshold
          ORDER BY
            sv.embedding <=> query_embedding
          LIMIT match_count;
        END;
        $$;
      `);
      
      await pool.end();
      
      return new Response('Schema updated successfully. Title column added to schema_vectors table.', { 
        status: 200 
      });
    } catch (error) {
      console.error('Error updating schema:', error);
      return new Response(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`, { 
        status: 500 
      });
    }
  } else if (action === 'rebuild_vectors') {
    try {
      // Get the vector store
      const projectOpenaiApiKey = process.env.OPENAI_API_KEY;
      if (!projectOpenaiApiKey) {
        return new Response('Missing OpenAI API Key', { status: 500 });
      }
      
      const vectorStore = await getVectorStore(projectOpenaiApiKey);
      
      // Clear existing vectors
      await vectorStore.clearVectorStore();
      
      // Reset schema stored flag
      schemaStored = false;
      
      return new Response('Vector store cleared. It will be rebuilt on the next query with filtered tables.', { 
        status: 200 
      });
    } catch (error) {
      console.error('Error rebuilding vector store:', error);
      return new Response(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`, { 
        status: 500 
      });
    }
  } else if (action === 'test_retrieval') {
    try {
      const projectOpenaiApiKey = process.env.OPENAI_API_KEY;
      if (!projectOpenaiApiKey) {
        return new Response('Missing OpenAI API Key', { status: 500 });
      }
      
      const vectorStore = await getVectorStore(projectOpenaiApiKey);
      const testQuery = searchParams.get('query') || 'knowledge score mass attendance';
      
      // Get all documentation from the vector store
      const supabase = vectorStore.getSupabaseClient();
      const { data: allDocs, error: docsError } = await supabase
        .from('schema_vectors')
        .select('*')
        .eq('type', 'documentation')
        .order('id');
        
      if (docsError) {
        return new Response(`Error fetching documentation: ${docsError.message}`, { status: 500 });
      }
      
      // Test retrieval with threshold = 0.29
      const relevantInfo = await vectorStore.searchSchemaInfo(testQuery, 20);
      
      // Format for display
      const results = {
        query: testQuery,
        threshold: 0.29,
        total_docs_in_store: allDocs.length,
        docs_retrieved: relevantInfo.length,
        all_documentation: allDocs.map(doc => ({ id: doc.id, content: doc.content })),
        retrieved_documentation: relevantInfo.map(doc => ({ 
          content: doc.content, 
          similarity: (doc as any).similarity
        }))
      };
      
      return new Response(JSON.stringify(results, null, 2), { 
        status: 200,
        headers: {
          'Content-Type': 'application/json'
        }
      });
    } catch (error) {
      console.error('Error testing retrieval:', error);
      return new Response(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`, { 
        status: 500 
      });
    }
  }
  
  return new Response(`
    Available actions:
    - ?action=update_schema - Update the schema_vectors table to add the title column
    - ?action=rebuild_vectors - Clear and rebuild the vector store
    - ?action=test_retrieval&query=your query here - Test documentation retrieval with a specific query
  `, { 
    status: 200,
    headers: {
      'Content-Type': 'text/plain'
    }
  });
}

// Allow streaming responses up to 30 seconds
export const maxDuration = 30

export async function POST(req: Request) {
  const startTime = Date.now();
  console.log('POST request started at:', new Date().toISOString());
  
  const client = await createClient()
  const { data } = await client.auth.getUser()
  const user = data.user
  if (!user) {
    console.log('Unauthorized: No user found')
    return new Response('Unauthorized', { status: 401 })
  }

  const { messages, id } = await req.json()
  console.log('Request payload:', { id, messageCount: messages?.length })

  const headers_ = await headers()
  const connectionString = headers_.get('x-connection-string')
  const openaiApiKey = headers_.get('x-openai-api-key')
  const model = headers_.get('x-model')

  if (!id) {
    console.log('Bad request: No id provided')
    return new Response('No id provided', { status: 400 })
  }

  const idParsed = z.string().uuid().safeParse(id)
  if (!idParsed.success) {
    console.log('Bad request: Invalid UUID format', id)
    return new Response('Invalid id', { status: 400 })
  }

  // check if the chat exists
  const { data: chat, error } = await client
    .from('chats')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    console.error('Database error when fetching chat:', error)
    return new Response('Error fetching chat', { status: 500 })
  }

  // is chat from user
  if (chat && chat.user_id !== user.id) {
    console.log('Unauthorized: Chat belongs to different user', {
      chatUserId: chat.user_id,
      requestUserId: user.id,
    })
    return new Response('Unauthorized', { status: 401 })
  }

  if (!connectionString) {
    console.log('Bad request: Missing connection string')
    return new Response('No connection string provided', { status: 400 })
  }

  const projectOpenaiApiKey = process.env.OPENAI_API_KEY
  if (!projectOpenaiApiKey) {
    console.error('Missing OpenAI API key in environment')
    return new Response('Server configuration error', { status: 500 })
  }

  const openai = createOpenAI({
    apiKey: projectOpenaiApiKey,
  })

  const shouldUpdateChats = !chat
  
  console.log(`Setup time: ${Date.now() - startTime}ms`);
  const vectorStoreStartTime = Date.now();
  
  // Get or create vector store instance
  let vectorStore: SchemaVectorStore;
  try {
    vectorStore = await getVectorStore(projectOpenaiApiKey);
    console.log(`Vector store initialization: ${Date.now() - vectorStoreStartTime}ms`);
  } catch (error) {
    console.error('Error initializing vector store:', error);
    return new Response('Error initializing vector store', { status: 500 });
  }

  const result = streamText({
    model: openai('gpt-4o'),
    messages: convertToCoreMessages(messages),
    system: `
     You are a PostgreSQL Query Generator Agent. Your primary responsibility is to generate accurate and efficient SQL queries based on user requests.
     
     IMPORTANT: This application uses a focused set of tables specifically selected for key analytical questions. 
     
     The tools available to you serve the following purposes:
     - getPublicTablesWithColumns: Returns ALL tables and their structure available for querying
     - getRelevantDocumentation: Returns documentation relevant to the specific query, including schema guidance, table usage details, and query patterns

      When generating queries:
     1. First call getPublicTablesWithColumns to see all available tables
     2. Then call getRelevantDocumentation to get documentation relevant to your specific query
     3. Only use tables from the returned list - never reference tables not in this list
     4. Include all required filters and joins as specified in the documentation
     5. Use proper score calculations with NULLIF and type casting
     6. Follow the guidance provided by getRelevantDocumentation
     7. Present the final SQL query in a code block
    `,
    maxSteps: 22,
    tools: {
      getPublicTablesWithColumns: tool({
        description:
          'Retrieves a list of tables and their columns from the connected PostgreSQL database.',
        execute: async () => {
          const tablesTimerId = `getPublicTablesWithColumns-${Date.now()}`;
          console.time(tablesTimerId);
          const tables = await getPublicTablesWithColumns(connectionString)
          
          // Only store schema in vector store if not already stored
          if (tables && tables.length > 0 && !schemaStored) {
            try {
              console.log('Storing schema in vector store (first time only)');
              const schemaTimerId = `storeSchema-${Date.now()}`;
              console.time(schemaTimerId);
              
              const constraints = await getForeignKeyConstraints(connectionString)
              
              // Filter tables to only include target tables
              const filteredTables = Array.isArray(tables) 
                ? tables.filter((table: any) => TARGET_TABLES.includes(table.tableName))
                : [];
              
              console.log(`Filtered ${Array.isArray(tables) ? tables.length : 0} tables to ${filteredTables.length} target tables`);
              
              // Fix type issue - cast tables to the correct type for storeSchemaInfo
              const typedTables = filteredTables as unknown as Array<{
                description?: {
                  requiresDioceseFilter: boolean;
                  joinPath: string;
                  hasDirectDioceseColumn: boolean;
                  example: string;
                };
                tableName: string;
                schemaName: string;
                columns: Array<{
                  name: string;
                  type: string;
                  isNullable: boolean;
                }>;
              }>;
              
              // Filter constraints to only include relationships between target tables
              const filteredConstraints = Array.isArray(constraints)
                ? constraints.filter((constraint: any) => 
                    TARGET_TABLES.includes(constraint.tableName) && 
                    TARGET_TABLES.includes(constraint.foreignTableName)
                  )
                : [];
              
              console.log(`Filtered ${Array.isArray(constraints) ? constraints.length : 0} constraints to ${filteredConstraints.length} relevant constraints`);
              
              // Fix type issue with constraints
              const typedConstraints = filteredConstraints as unknown as Array<{
                constraintName: string;
                tableName: string;
                columnName: string;
                foreignTableName: string;
                foreignColumnName: string;
              }>;
              
              const storedCount = await vectorStore.storeSchemaInfo(typedTables, typedConstraints, DOCUMENTATION)
              console.log(`Stored ${storedCount} documentation vector entries`);
              schemaStored = true;
              
              console.timeEnd(schemaTimerId);
            } catch (error) {
              console.error('Error storing schema in vector store:', error)
            }
          } else {
            console.log('Schema already stored, skipping vectorization');
          }
          
          console.timeEnd(tablesTimerId);
          
          // Return only the target tables to ensure consistency with vector store
          const filteredTablesToReturn = Array.isArray(tables) 
            ? tables.filter((table: any) => TARGET_TABLES.includes(table.tableName))
            : [];
            
          console.log(`Returning ${filteredTablesToReturn.length} target tables to the model`);
          return filteredTablesToReturn;
        },
        parameters: z.object({}),
      }),

      getRelevantDocumentation: tool({
        description: `Find relevant structured documentation for answering queries about database schema, query patterns, and database rules. This will retrieve semantically similar documentation based on your natural language query. Documentation entries include table descriptions, query patterns, business rules, and other helpful context. Each entry has a title, content, and metadata with categories and keywords.`,
        parameters: z.object({
          query: z.string().describe('The natural language query to find relevant documentation'),
        }),
        execute: async ({ query }) => {
          try {
            const infoTimerId = `getRelevantDocumentation-${Date.now()}`;
            console.time(infoTimerId);
            
            // Search for relevant information
            const relevantInfo = await vectorStore.searchSchemaInfo(query, 20);
            
            // Format the results
            console.log(`Found ${relevantInfo.length} relevant documentation entries (threshold: 0.29)`);
            
            if (relevantInfo.length === 0) {
              return 'No relevant documentation found for this query. Please try a different query or ask about specific tables or columns.';
            }
            
            console.timeEnd(infoTimerId);
            return relevantInfo.map((info: any) => info.content).join('\n\n');
          } catch (error) {
            console.error('Error retrieving documentation:', error);
            return `Error retrieving documentation: ${error instanceof Error ? error.message : 'Unknown error'}`;
          }
        },
      }),

      getExplainForQuery: tool({
        description:
          "Analyzes and optimizes a given SQL query, providing a detailed execution plan in JSON format.",
        execute: async ({ query }) => {
          // Extract table names from the query using a different approach to avoid iterator issues
          const tableRegex = /\b(from|join)\s+([a-zA-Z0-9_]+)\b/gi;
          const tablesInQuery: string[] = [];
          let match;
          
          while ((match = tableRegex.exec(query)) !== null) {
            tablesInQuery.push(match[2].toLowerCase());
          }
          
          // Check if any table in the query is not in our target tables
          const targetTablesLower = TARGET_TABLES.map(t => t.toLowerCase());
          const nonTargetTables = tablesInQuery.filter(
            table => !targetTablesLower.includes(table)
          );
          
          if (nonTargetTables.length > 0) {
            console.warn(`Query references non-target tables: ${nonTargetTables.join(', ')}`);
            return {
              warning: "This query references tables that are not in the target set. Please ensure you only use the tables returned by getPublicTablesWithColumns.",
              tables_referenced: tablesInQuery,
              non_target_tables: nonTargetTables,
              tables_available: TARGET_TABLES,
              explain: await getExplainForQuery(query, connectionString)
            };
          }
          
          const explain = await getExplainForQuery(query, connectionString)
          return explain
        },
        parameters: z.object({
          query: z.string().describe('The SQL query to analyze'),
        }),
      }),

      getIndexStatsUsage: tool({
        description: 'Retrieves usage statistics for indexes in the database.',
        execute: async () => {
          const indexStats = await getIndexStatsUsage(connectionString)
          
          // Filter index stats to only include those from target tables
          const filteredIndexStats = Array.isArray(indexStats)
            ? indexStats.filter((stat: any) => TARGET_TABLES.includes(stat.table_name))
            : [];
          
          console.log(`Returning usage statistics for ${filteredIndexStats.length} indexes on target tables`);
          return filteredIndexStats;
        },
        parameters: z.object({}),
      }),

      getIndexes: tool({
        description: 'Retrieves the indexes present in the connected database.',
        execute: async () => {
          const indexes = await getIndexes(connectionString)
          
          // Filter indexes to only include those from target tables
          const filteredIndexes = Array.isArray(indexes)
            ? indexes.filter((index: any) => TARGET_TABLES.includes(index.table_name))
            : [];
          
          console.log(`Returning ${filteredIndexes.length} indexes for target tables`);
          return filteredIndexes;
        },
        parameters: z.object({}),
      }),

      getTableStats: tool({
        description:
          'Retrieves statistics about tables, including row counts and sizes.',
        execute: async () => {
          const stats = await getTableStats(connectionString)
          
          // Filter stats to only include target tables
          const filteredStats = Array.isArray(stats)
            ? stats.filter((stat: any) => TARGET_TABLES.includes(stat.table_name))
            : [];
          
          console.log(`Returning statistics for ${filteredStats.length} target tables`);
          return filteredStats;
        },
        parameters: z.object({}),
      }),

      getForeignKeyConstraints: tool({
        description:
          'Retrieves information about foreign key relationships between tables.',
        execute: async () => {
          const constraints = await getForeignKeyConstraints(connectionString)
          
          // Filter constraints to only include relationships between target tables
          const filteredConstraints = Array.isArray(constraints)
            ? constraints.filter((constraint: any) => 
                TARGET_TABLES.includes(constraint.tableName) && 
                TARGET_TABLES.includes(constraint.foreignTableName)
              )
            : [];
          
          console.log(`Returning ${filteredConstraints.length} foreign key constraints for target tables`);
          return filteredConstraints;
        },
        parameters: z.object({}),
      }),
    },
    onFinish: async ({ response }) => {
      console.log('Stream completed, updating database')
      try {
        console.log('Response messages:', JSON.stringify(response.messages, null, 2))
        
        const lastMessage = response.messages[response.messages.length - 1]
        console.log('Last message:', JSON.stringify(lastMessage, null, 2))
        
        if (lastMessage && typeof lastMessage.content === 'string') {
          const queryMatch = lastMessage.content.match(/```sql\n([\s\S]*?)\n```/)
          console.log('Query match result:', queryMatch)
          
          if (queryMatch) {
            const finalQuery = queryMatch[1]
            console.log('\n=== Final Query ===')
            console.log(finalQuery)

            if (chat) {
              console.log('Updating existing chat:', id)
              await client
                .from('chats')
                .update({
                  messages: JSON.stringify(
                    appendResponseMessages({
                      messages,
                      responseMessages: response.messages,
                    })
                  ),
                })
                .eq('id', id)
            } else {
              console.log('Creating new chat:', id)
              const generatedName = await generateText({
                model: openai('gpt-4o-mini'),
                system: `
                  You are an assistant that generates short, concise, descriptive chat names for a PostgreSQL chatbot. 
                  The name must:
                  • Capture the essence of the conversation in one sentence.
                  • Be relevant to PostgreSQL topics.
                  • Contain no extra words, labels, or prefixes such as "Title:" or "Chat:".
                  • Not include quotation marks or the word "Chat" anywhere.

                  Example of a good name: Counting users
                  Example of a good name: Counting users in the last 30 days

                  Example of a bad name: Chat about PostgreSQL: Counting users
                  Example of a bad name: "Counting users"

                  Your response should be the title text only, nothing else.
                `,
                prompt: `The messages are <MESSAGES>${JSON.stringify(messages)}</MESSAGES>`,
              })

              await client.from('chats').insert({
                id,
                user_id: user.id,
                messages: JSON.stringify(
                  appendResponseMessages({
                    messages,
                    responseMessages: response.messages,
                  })
                ),
                name: generatedName.text,
                created_at: new Date().toISOString(),
              })
            }
          } else {
            console.log('No SQL query found in the response')
          }
        } else {
          console.log('Last message is not a string or is undefined')
        }
        console.log('\n=== Workflow Completed ===')
        console.log('Database update completed successfully')
        revalidatePath('/app')
      } catch (error) {
        console.error('Error in workflow:', error)
        if (error instanceof Error) {
          console.error('Error details:', {
            message: error.message,
            stack: error.stack,
            name: error.name
          })
        }
      }
    },
  })

  console.log(`Total request processing time: ${Date.now() - startTime}ms`);
  console.log('Returning stream response')
  return result.toDataStreamResponse({
    headers: {
      'x-should-update-chats': shouldUpdateChats.toString(),
    },
  })
}
