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
import { runSql } from '@/actions/run-sql'

// Define the list of target tables for vector store
const TARGET_TABLES = [
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
  'users',

  // 🆕 Added based on usage in the queries
  'academic_years',
  'testing_section_student_domain_scores',
  'user_answers',
  'questions',
  'answers'
];

// Define the structured documentation
const DOCUMENTATION: StructuredDocumentation[] = [
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
    "content": "Each diocese name starts with either 'Diocese of ___' or 'Archdiocese of ___'. Use that full prefix in filters. ALWAYS use the exact full diocese name from getDioceseNames tool for exact matching. NEVER use partial names or LIKE operators for diocese filtering.",
    "metadata": {
      "category": "Naming rules",
      "tables": ["dioceses"],
      "columns": ["name"],
      "keywords": ["diocese", "archdiocese", "exact name", "full name"]
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
      "category": "Performance Analytics",
      "tables": ["testing_section_students", "testing_section_student_domain_scores", "domains", "users"],
      "columns": ["knowledge_score", "knowledge_total", "domain_name", "role"],
      "keywords": ["average", "knowledge score", "teacher", "domain"],
      "question_variants": [
        "How are teachers performing in each domain?",
        "What's the teacher performance by knowledge domain?",
        "Show me teacher scores across different domains",
        "Compare teacher knowledge scores by domain"
      ],
      "common_phrasings": [
        "teacher domain performance",
        "teacher knowledge by domain",
        "domain-specific teacher scores",
        "teacher performance breakdown"
      ],
      "context": {
        "report_type": "performance",
        "audience": "diocesan admins",
        "decision_support": "teacher training focus",
        "frequency": "quarterly review"
      }
    }
  },
  {
    "id": "tmpl_02",
    "title": "Template – Eucharist answers by grade",
    "content": "Question: What is the count and percentage of students in each grade level who selected all possible answers to the question \"What is the Eucharist?\" (question_id = 651)\nSQL:\nSELECT\n    tss.grade_level,\n    COUNT(DISTINCT CASE WHEN ua.answer_id = 4081 THEN ua.user_id END) AS symbol_count,\n    COUNT(DISTINCT CASE WHEN ua.answer_id = 4091 THEN ua.user_id END) AS real_body_blood_count,\n    COUNT(DISTINCT CASE WHEN ua.answer_id = 4101 THEN ua.user_id END) AS staff_symbol_count,\n    COUNT(DISTINCT CASE WHEN ua.answer_id = 4111 THEN ua.user_id END) AS ring_count,\n    (COUNT(DISTINCT CASE WHEN ua.answer_id = 4081 THEN ua.user_id END) * 100.0) / NULLIF(COUNT(DISTINCT ua.user_id), 0) AS symbol_pct,\n    (COUNT(DISTINCT CASE WHEN ua.answer_id = 4091 THEN ua.user_id END) * 100.0) / NULLIF(COUNT(DISTINCT ua.user_id), 0) AS real_body_blood_pct,\n    (COUNT(DISTINCT CASE WHEN ua.answer_id = 4101 THEN ua.user_id END) * 100.0) / NULLIF(COUNT(DISTINCT ua.user_id), 0) AS staff_symbol_pct,\n    (COUNT(DISTINCT CASE WHEN ua.answer_id = 4111 THEN ua.user_id END) * 100.0) / NULLIF(COUNT(DISTINCT ua.user_id), 0) AS ring_pct\nFROM user_answers ua\nINNER JOIN testing_section_students tss ON tss.id = ua.testing_section_student_id\nINNER JOIN users u ON u.id = ua.user_id\nWHERE\n    ua.question_id = 651\n    AND u.role = 7\nGROUP BY\n    tss.grade_level;",
    "metadata": {
      "category": "Faith Formation Indicators",
      "tables": ["user_answers", "testing_section_students", "users"],
      "columns": ["grade_level", "answer_id", "question_id", "user_id"],
      "keywords": ["Eucharist", "question 651", "grade‑level breakdown", "belief distribution"],
      "question_variants": [
        "How do students understand the Eucharist by grade?",
        "What do students believe about the Eucharist across grades?",
        "Show Eucharistic belief distribution by grade level",
        "How does understanding of the Eucharist change by grade?"
      ],
      "common_phrasings": [
        "Eucharist understanding",
        "sacramental knowledge",
        "Catholic belief by grade",
        "theological understanding progression"
      ],
      "context": {
        "report_type": "catechetical",
        "audience": "diocesan religious education directors",
        "decision_support": "curriculum development",
        "theological_focus": "sacramental theology"
      }
    }
  },
  {
    "id": "tmpl_03",
    "title": "Template – confess Mortal sins vs knowledge score",
    "content": "Question: What is the average knowledge score for students who believe that we must confess our Mortal sins and should confess venial sins? (question_id = 432)\nSQL:\nSELECT\n    a.body AS answer_name,\n    AVG((CAST(tss.knowledge_score AS FLOAT) / tss.knowledge_total) * 100) AS average_score\nFROM user_answers ua\nINNER JOIN testing_section_students tss ON tss.id = ua.testing_section_student_id\nINNER JOIN users u ON u.id = ua.user_id\nINNER JOIN answers a ON a.id = ua.answer_id\nWHERE\n    ua.question_id = 432\n    AND ua.answer_id IN (1520, 1522, 1523, 1524)\n    AND u.role = 7\nGROUP BY a.body\nORDER BY average_score DESC;",
    "metadata": {
      "category": "Faith Formation Indicators",
      "tables": ["user_answers", "testing_section_students", "users", "answers"],
      "columns": ["knowledge_score", "knowledge_total", "question_id", "answer_id"],
      "keywords": ["confession", "mortal sins", "venial sins", "question 432", "average score"],
      "question_variants": [
        "How does belief about confession affect knowledge scores?",
        "Is there a correlation between confession belief and overall knowledge?",
        "Does understanding sin types correlate with theological knowledge?",
        "What's the relationship between confession attitudes and test scores?"
      ],
      "common_phrasings": [
        "confession belief impact",
        "sacrament of reconciliation understanding",
        "sin categorization knowledge",
        "penance sacrament correlation"
      ],
      "context": {
        "report_type": "sacramental analysis",
        "audience": "diocesan catechetical leaders",
        "decision_support": "sacramental preparation",
        "theological_focus": "confession and reconciliation"
      }
    }
  },
  {
    "id": "tmpl_04",
    "title": "Template – Real Presence belief by grade",
    "content": "Question: What is the count and percentage of students in each grade level who selected all possible answers to the question \"The Eucharist we receive at Mass is truly the Body and Blood of Jesus Christ?\" (question_id = 436)\nSQL:\nSELECT\n    tss.grade_level,\n    COUNT(DISTINCT CASE WHEN ua.answer_id = 1538 THEN ua.user_id END) AS believe_count,\n    COUNT(DISTINCT CASE WHEN ua.answer_id = 1540 THEN ua.user_id END) AS not_believe_count,\n    COUNT(DISTINCT CASE WHEN ua.answer_id = 1539 THEN ua.user_id END) AS struggle_count,\n    COUNT(DISTINCT CASE WHEN ua.answer_id = 1542 THEN ua.user_id END) AS not_know_count,\n    (COUNT(DISTINCT CASE WHEN ua.answer_id = 1538 THEN ua.user_id END) * 100.0) / NULLIF(COUNT(DISTINCT ua.user_id), 0) AS believe,\n    (COUNT(DISTINCT CASE WHEN ua.answer_id = 1540 THEN ua.user_id END) * 100.0) / NULLIF(COUNT(DISTINCT ua.user_id), 0) AS not_believe,\n    (COUNT(DISTINCT CASE WHEN ua.answer_id = 1539 THEN ua.user_id END) * 100.0) / NULLIF(COUNT(DISTINCT ua.user_id), 0) AS struggle,\n    (COUNT(DISTINCT CASE WHEN ua.answer_id = 1542 THEN ua.user_id END) * 100.0) / NULLIF(COUNT(DISTINCT ua.user_id), 0) AS not_know\nFROM user_answers ua\nINNER JOIN testing_section_students tss ON tss.id = ua.testing_section_student_id\nINNER JOIN users u ON u.id = ua.user_id\nWHERE\n    ua.question_id = 436\n    AND u.role = 7\nGROUP BY\n    tss.grade_level;",
    "metadata": {
      "category": "Faith Formation Indicators",
      "tables": ["user_answers", "testing_section_students", "users"],
      "columns": ["grade_level", "answer_id", "question_id"],
      "keywords": ["Real Presence", "Eucharist belief", "question 436", "grade distribution"],
      "question_variants": [
        "How does belief in Real Presence vary across grades?",
        "What percentage of each grade believes in transubstantiation?",
        "Show me grade level breakdown of Eucharistic belief",
        "How many students in each grade believe in Real Presence?"
      ],
      "common_phrasings": [
        "Eucharistic belief progression",
        "Real Presence understanding",
        "Body and Blood belief trends",
        "transubstantiation comprehension"
      ],
      "context": {
        "report_type": "eucharistic revival",
        "audience": "diocesan eucharistic congress planners",
        "decision_support": "grade-appropriate catechesis",
        "theological_focus": "eucharistic theology"
      }
    }
  },
  {
    "id": "tmpl_05",
    "title": "Template – avg score for students w/ practice & belief (AY 2022‑23)",
    "content": "Question: What is the average knowledge score for students who attend Mass, have been baptized, and believe in real presence for the academic year 2022‑2023? (academic_year_id = 3)\nSQL:\nSELECT\n    q.body AS question_name,\n    a.body AS answer_name,\n    (CAST(SUM(CASE WHEN tss.academic_year_id = 3 THEN tss.knowledge_score ELSE 0 END) AS FLOAT) / NULLIF(SUM(CASE WHEN tss.academic_year_id = 3 THEN tss.knowledge_total ELSE 0 END), 0)) * 100 AS average_score_academic_year_3\nFROM user_answers ua\nINNER JOIN testing_section_students tss ON tss.id = ua.testing_section_student_id\nINNER JOIN answers a ON a.id = ua.answer_id\nINNER JOIN questions q ON q.id = ua.question_id\nINNER JOIN users u ON u.id = ua.user_id\nWHERE\n    u.role = 7\n    AND (\n        (ua.question_id = 7121 AND ua.answer_id IN (29901, 29911, 29921))\n        OR (ua.question_id = 7111 AND ua.answer_id IN (29891, 29881, 29871, 29861))\n        OR (ua.question_id = 436 AND ua.answer_id IN (1538, 1540, 1539, 1542))\n    )\nGROUP BY q.body, a.body\nORDER BY q.body, a.body;",
    "metadata": {
      "category": "Faith Formation Indicators",
      "tables": ["user_answers", "testing_section_students", "answers", "questions", "users"],
      "columns": ["knowledge_score", "knowledge_total", "academic_year_id", "question_id", "answer_id"],
      "keywords": ["academic_year_id 3", "practice & belief", "average score", "Mass attendance", "baptism", "Real Presence"],
      "question_variants": [
        "How does religious practice affect knowledge scores?",
        "What's the relationship between sacramental participation and test results?",
        "Do students who practice their faith score better?",
        "How do Mass attendance and belief impact theological knowledge?"
      ],
      "common_phrasings": [
        "faith practice and performance",
        "sacramental participation impact",
        "religious behavior and knowledge",
        "practice-belief-knowledge correlation"
      ],
      "context": {
        "report_type": "faith impact study",
        "audience": "diocesan leadership",
        "decision_support": "pastoral planning",
        "theological_focus": "faith formation effectiveness"
      }
    }
  },
  {
    "id": "tmpl_06",
    "title": "Template – avg student vs teacher knowledge score",
    "content": "Question: What is the average knowledge score for students and teachers?\nSQL:\nSELECT\n    AVG(CASE WHEN u.role = 5 THEN CAST(tss.knowledge_score AS FLOAT) / tss.knowledge_total END) * 100 AS teacher_avg_score,\n    AVG(CASE WHEN u.role = 7 THEN CAST(tss.knowledge_score AS FLOAT) / tss.knowledge_total END) * 100 AS student_avg_score\nFROM testing_section_students tss\nINNER JOIN users u ON u.id = tss.user_id\nWHERE u.role IN (5, 7);",
    "metadata": {
      "category": "Performance Analytics",
      "tables": ["testing_section_students", "users"],
      "columns": ["knowledge_score", "knowledge_total", "role"],
      "keywords": ["average", "student", "teacher", "comparison"],
      "question_variants": [
        "How do teachers compare to students on knowledge tests?",
        "Is there a gap between teacher and student knowledge scores?",
        "Compare teacher vs. student theological knowledge",
        "What's the difference between teacher and student performance?"
      ],
      "common_phrasings": [
        "teacher-student knowledge gap",
        "educator vs learner performance",
        "instructional effectiveness indicator",
        "theological knowledge comparison"
      ],
      "context": {
        "report_type": "educator effectiveness",
        "audience": "diocesan education office",
        "decision_support": "teacher professional development",
        "frequency": "annual assessment"
      }
    }
  },
  {
    "id": "tmpl_07",
    "title": "Template – student score vs teacher practice & belief (AY 2022‑23)",
    "content": "Question: What is the average knowledge score for students with teachers who attend Mass, have been baptized, and believe in real presence for the academic year 2022‑2023? (academic_year_id = 3)\nSQL:\nSELECT\n    ta.question_id AS teacher_question,\n    tq.body AS teacher_question_name,\n    ta.answer_id AS teacher_answer,\n    a.body AS teacher_answer_text,\n    (CAST(SUM(tss.knowledge_score) AS FLOAT) / SUM(tss.knowledge_total)) * 100 AS average_score\nFROM testing_section_students tss\nINNER JOIN users s ON s.id = tss.user_id AND s.role = 7\nINNER JOIN testing_sections ts ON ts.id = tss.testing_section_id\nINNER JOIN users t ON t.id = ts.user_id AND t.role = 5\nINNER JOIN user_answers ta ON ta.user_id = t.id AND ta.question_id IN (7121, 7111, 436)\nINNER JOIN questions tq ON tq.id = ta.question_id\nINNER JOIN answers a ON a.id = ta.answer_id\nWHERE tss.academic_year_id = 3\nGROUP BY ta.question_id, tq.body, ta.answer_id, a.body\nORDER BY ta.question_id, ta.answer_id;",
    "metadata": {
      "category": "Faith Formation Indicators",
      "tables": ["testing_section_students", "users", "testing_sections", "user_answers", "questions", "answers"],
      "columns": ["knowledge_score", "knowledge_total", "academic_year_id", "question_id", "answer_id", "role"],
      "keywords": ["teacher practice", "student score", "academic_year_id 3", "teacher influence", "belief correlation"],
      "question_variants": [
        "How do teacher beliefs affect student performance?",
        "Does teacher religious practice impact student scores?",
        "Is there a correlation between teacher faith commitment and student outcomes?",
        "What impact do teacher religious beliefs have on student knowledge?"
      ],
      "common_phrasings": [
        "teacher witness effect",
        "faith transmission effectiveness",
        "teacher modeling impact",
        "educator belief influence"
      ],
      "context": {
        "report_type": "teacher effectiveness",
        "audience": "diocesan leadership",
        "decision_support": "teacher formation programs",
        "theological_focus": "authenticity in religious education"
      }
    }
  },
  {
    "id": "tmpl_08",
    "title": "Template – total students & teachers (AY 2023‑24)",
    "content": "Question: What is the total number of students and teachers for the academic year 2023‑2024? (academic_year_id = 4)\nSQL:\nSELECT\n    COUNT(DISTINCT CASE WHEN u.role = 7 THEN tss.user_id END) AS total_students,\n    COUNT(DISTINCT CASE WHEN u.role = 5 THEN tss.user_id END) AS total_teachers\nFROM testing_section_students tss\nINNER JOIN users u ON u.id = tss.user_id\nWHERE tss.academic_year_id IN (4);",
    "metadata": {
      "category": "Participation & Engagement Metrics",
      "tables": ["testing_section_students", "users"],
      "columns": ["user_id", "role", "academic_year_id"],
      "keywords": ["count", "students", "teachers", "academic_year_id 4", "total participants"],
      "question_variants": [
        "How many students and teachers are in the system this year?",
        "What is our total participation for 2023-2024?",
        "How large is our diocesan educational community?",
        "What's the current count of teachers and students?"
      ],
      "common_phrasings": [
        "participant totals",
        "system user counts",
        "educational community size",
        "diocesan education statistics"
      ],
      "context": {
        "report_type": "administrative",
        "audience": "diocesan superintendent",
        "decision_support": "resource allocation",
        "frequency": "annual reporting"
      }
    }
  },
  {
    "id": "tmpl_09",
    "title": "Template – completion-rate trend by grade over 3 AYs",
    "content": "Question: What is the trend in student test completion rates over the past three academic years, broken down by grade level?\nSQL:\nSELECT \n    tss.grade_level,\n    ay.id AS academic_year_id,\n    COUNT(tss.id) AS total_tests,\n    COUNT(CASE WHEN tss.status = TRUE THEN tss.id END) AS completed_tests,\n    (COUNT(CASE WHEN tss.status = TRUE THEN tss.id END) * 100.0) / NULLIF(COUNT(tss.id), 0) AS completion_rate\nFROM testing_section_students tss\nJOIN academic_years ay ON tss.academic_year_id = ay.id\nWHERE ay.id IN (3, 4, 5)\nGROUP BY tss.grade_level, ay.id\nORDER BY tss.grade_level, ay.id;",
    "metadata": {
      "category": "Participation & Engagement Metrics",
      "tables": ["testing_section_students", "academic_years"],
      "columns": ["grade_level", "academic_year_id", "status"],
      "keywords": ["completion trend", "grade level", "past 3 years", "completion rate"],
      "question_variants": [
        "How has test completion changed over time by grade?",
        "What grades have the highest test completion rates?",
        "Show me completion trends across academic years by grade",
        "Has test participation improved over the past three years?"
      ],
      "common_phrasings": [
        "completion rate trends",
        "test participation by grade",
        "academic year completion patterns",
        "grade-level participation analysis"
      ],
      "context": {
        "report_type": "participation trends",
        "audience": "diocesan administrators",
        "decision_support": "targeted intervention",
        "frequency": "annual review"
      }
    }
  },
  {
    "id": "tmpl_10",
    "title": "Template – theology completion % per testing center (current AY)",
    "content": "Question: What percentage of students in each testing center completed their theology assessments for the current academic year?\nSQL:\nSELECT \n    tc.name AS testing_center_name,\n    COUNT(DISTINCT CASE WHEN tss.completed_date IS NOT NULL THEN tss.user_id END) * 100.0 / NULLIF(COUNT(DISTINCT tss.user_id), 0) AS completion_percentage\nFROM testing_centers tc\nJOIN testing_sections ts ON ts.testing_center_id = tc.id\nJOIN testing_section_students tss ON tss.testing_section_id = ts.id\nWHERE tss.subject_area_id = 1\n  AND tss.academic_year_id = (SELECT MAX(id) FROM academic_years)\nGROUP BY tc.name;",
    "metadata": {
      "category": "Participation & Engagement Metrics",
      "tables": ["testing_centers", "testing_sections", "testing_section_students", "academic_years"],
      "columns": ["name", "completed_date", "user_id", "subject_area_id", "academic_year_id"],
      "keywords": ["completion percentage", "theology", "current year", "testing center"],
      "question_variants": [
        "Which schools have the highest theology test completion rates?",
        "How do testing centers compare on theology assessment completion?",
        "What's the theology assessment completion rate by school?",
        "Which testing centers need improvement in theology assessment completion?"
      ],
      "common_phrasings": [
        "theology test completion",
        "school participation rates",
        "assessment completion by center",
        "theology participation metrics"
      ],
      "context": {
        "report_type": "administrative",
        "audience": "diocesan administrators",
        "decision_support": "participation incentives",
        "frequency": "quarterly monitoring"
      }
    }
  },
  {
    "id": "tmpl_11",
    "title": "Template – students started but not completed theology (current AY)",
    "content": "Question: How many students have started but not completed their theology assessments this academic year?\nSQL:\nSELECT COUNT(DISTINCT tss.user_id) AS students_started_not_completed\nFROM testing_section_students tss\nJOIN testing_sections ts ON ts.id = tss.testing_section_id\nWHERE tss.academic_year_id = (SELECT MAX(id) FROM academic_years)\n  AND tss.progress IS NOT NULL\n  AND tss.completed_date IS NULL\n  AND ts.active_subject_area_id = (SELECT id FROM subject_areas WHERE name = 'Theology');",
    "metadata": {
      "category": "Participation & Engagement Metrics",
      "tables": ["testing_section_students", "testing_sections", "academic_years", "subject_areas"],
      "columns": ["user_id", "academic_year_id", "progress", "completed_date", "active_subject_area_id"],
      "keywords": ["started", "not completed", "theology", "current year", "incomplete"],
      "question_variants": [
        "How many unfinished theology assessments do we have?",
        "What's our theology test abandonment count?",
        "How many students need to complete their theology tests?",
        "What's the number of in-progress theology assessments?"
      ],
      "common_phrasings": [
        "incomplete assessments",
        "abandoned theology tests",
        "partial participation metrics",
        "test completion gap"
      ],
      "context": {
        "report_type": "participation gaps",
        "audience": "school administrators",
        "decision_support": "completion reminders",
        "frequency": "monthly tracking"
      }
    }
  },
  {
    "id": "tmpl_12",
    "title": "Template – completion-rate leaderboard by testing center",
    "content": "Question: Which testing centers have the highest and lowest assessment completion rates?\nSQL:\nSELECT \n    tc.name AS testing_center_name,\n    COUNT(tss.id) AS total_assessments,\n    COUNT(CASE WHEN tss.completed_date IS NOT NULL THEN 1 END) AS completed_assessments,\n    (COUNT(CASE WHEN tss.completed_date IS NOT NULL THEN 1 END) * 100.0) / NULLIF(COUNT(tss.id), 0) AS completion_rate\nFROM testing_centers tc\nJOIN testing_sections ts ON ts.testing_center_id = tc.id\nJOIN testing_section_students tss ON tss.testing_section_id = ts.id\nGROUP BY tc.name\nORDER BY completion_rate DESC;",
    "metadata": {
      "category": "Participation & Engagement Metrics",
      "tables": ["testing_centers", "testing_sections", "testing_section_students"],
      "columns": ["name", "completed_date"],
      "keywords": ["completion rate", "leaderboard", "testing center", "ranking"],
      "question_variants": [
        "Rank schools by assessment completion rates",
        "Which schools have the best test completion?",
        "Show me a ranking of testing centers by test completion",
        "What schools need help with assessment completion?"
      ],
      "common_phrasings": [
        "school completion ranking",
        "test completion leaderboard",
        "assessment completion comparison",
        "center performance metrics"
      ],
      "context": {
        "report_type": "comparative",
        "audience": "diocesan leadership",
        "decision_support": "recognition and intervention",
        "frequency": "semester review"
      }
    }
  },
  {
    "id": "tmpl_13",
    "title": "Template – monthly theology completion rates",
    "content": "Question: What months/periods show the highest completion rates for theology assessments?\nSQL:\nSELECT\n    TO_CHAR(tss.completed_date, 'YYYY-MM') AS completion_month,\n    COUNT(tss.id) AS completed_assessments,\n    (COUNT(tss.id) * 100.0) / NULLIF(SUM(COUNT(tss.id)) OVER (), 0) AS completion_rate\nFROM testing_section_students tss\nWHERE tss.subject_area_id = 1\n  AND tss.completed_date IS NOT NULL\nGROUP BY TO_CHAR(tss.completed_date, 'YYYY-MM')\nORDER BY completion_rate DESC;",
    "metadata": {
      "category": "Participation & Engagement Metrics",
      "tables": ["testing_section_students"],
      "columns": ["completed_date", "subject_area_id"],
      "keywords": ["monthly", "completion rate", "theology", "seasonal patterns"],
      "question_variants": [
        "When do most students complete their theology assessments?",
        "What are the peak months for theology test completion?",
        "Is there seasonality in theology assessment completion?",
        "When should we schedule theology assessments for best completion?"
      ],
      "common_phrasings": [
        "test completion timing",
        "assessment seasonality",
        "monthly completion patterns",
        "theology test timing"
      ],
      "context": {
        "report_type": "temporal analysis",
        "audience": "scheduling administrators",
        "decision_support": "optimal scheduling",
        "frequency": "annual planning"
      }
    }
  },
  {
    "id": "tmpl_14",
    "title": "Template – performance gap by domain across grade levels",
    "content": "Question: Which theological domain shows the greatest performance gap between different grade levels?\nSQL:\nWITH base AS (\n    SELECT\n        d.name AS domain,\n        tss.grade_level,\n        (tss.knowledge_score::numeric / NULLIF(tss.knowledge_total,0)) * 100 AS pct\n    FROM testing_section_students tss\n    JOIN domains d ON d.subject_area_id = tss.subject_area_id\n    WHERE tss.knowledge_score IS NOT NULL\n)\nSELECT\n    domain,\n    ROUND(AVG(CASE WHEN grade_level = 1  THEN pct END), 2) AS grade_1,\n    ROUND(AVG(CASE WHEN grade_level = 2  THEN pct END), 2) AS grade_2,\n    ROUND(AVG(CASE WHEN grade_level = 3  THEN pct END), 2) AS grade_3,\n    ROUND(AVG(CASE WHEN grade_level = 4  THEN pct END), 2) AS grade_4,\n    ROUND(AVG(CASE WHEN grade_level = 5  THEN pct END), 2) AS grade_5,\n    ROUND(AVG(CASE WHEN grade_level = 6  THEN pct END), 2) AS grade_6,\n    ROUND(AVG(CASE WHEN grade_level = 7  THEN pct END), 2) AS grade_7,\n    ROUND(AVG(CASE WHEN grade_level = 8  THEN pct END), 2) AS grade_8,\n    ROUND(AVG(CASE WHEN grade_level = 9  THEN pct END), 2) AS grade_9,\n    ROUND(AVG(CASE WHEN grade_level = 10 THEN pct END), 2) AS grade_10,\n    ROUND(AVG(CASE WHEN grade_level = 11 THEN pct END), 2) AS grade_11,\n    ROUND(AVG(CASE WHEN grade_level = 12 THEN pct END), 2) AS grade_12\nFROM base\nGROUP BY domain\nORDER BY domain;",
    "metadata": {
      "category": "Performance Analytics",
      "tables": ["testing_section_students", "domains"],
      "columns": ["name", "grade_level", "knowledge_score", "knowledge_total", "subject_area_id"],
      "keywords": ["performance gap", "domain", "grade", "cross-grade comparison"],
      "question_variants": [
        "Which theological concepts have the biggest learning gaps across grades?",
        "How does domain performance vary by grade level?",
        "Where are the largest grade-to-grade performance differences?",
        "What theological areas show uneven development across grades?"
      ],
      "common_phrasings": [
        "domain performance differences",
        "cross-grade knowledge gaps",
        "theological concept progression",
        "curriculum continuity analysis"
      ],
      "context": {
        "report_type": "curriculum development",
        "audience": "curriculum designers",
        "decision_support": "targeted curriculum improvements",
        "frequency": "annual curriculum review"
      }
    }
  },
  {
    "id": "tmpl_15",
    "title": "Template – Sacraments & Liturgy performance distribution by grade",
    "content": "Question: What is the performance distribution across grade levels for the \"Sacraments & Liturgy\" domain?\nSQL:\nSELECT\n    tss.grade_level,\n    COUNT(tsssd.knowledge_score) AS student_count,\n    AVG(CAST(tsssd.knowledge_score AS FLOAT) / NULLIF(tsssd.knowledge_total, 0)) * 100 AS average_knowledge_score,\n    AVG(CAST(tsssd.affinity_score AS FLOAT) / NULLIF(tsssd.affinity_total, 0)) * 100 AS average_affinity_score\nFROM testing_section_students tss\nJOIN testing_section_student_domain_scores tsssd ON tss.id = tsssd.testing_section_student_id\nJOIN domains d ON tsssd.domain_id = d.id\nWHERE d.name = 'Sacraments & Liturgy'\n  AND tss.knowledge_score IS NOT NULL\n  AND tss.knowledge_total IS NOT NULL\n  AND tss.affinity_score IS NOT NULL\n  AND tss.affinity_total IS NOT NULL\nGROUP BY tss.grade_level\nORDER BY tss.grade_level;",
    "metadata": {
      "category": "Faith Formation Indicators",
      "tables": ["testing_section_students", "testing_section_student_domain_scores", "domains"],
      "columns": ["grade_level", "knowledge_score", "knowledge_total", "affinity_score", "affinity_total", "domain_id", "name"],
      "keywords": ["Sacraments & Liturgy", "distribution", "grade", "sacramental understanding"],
      "question_variants": [
        "How does sacramental understanding develop by grade?",
        "What's the progression of liturgical knowledge across grades?",
        "Show me sacramental knowledge and affinity by grade level",
        "How do students' attitudes toward sacraments change by grade?"
      ],
      "common_phrasings": [
        "sacramental formation progress",
        "liturgical understanding development",
        "sacraments knowledge progression",
        "grade-level sacramental literacy"
      ],
      "context": {
        "report_type": "sacramental formation",
        "audience": "religious education directors",
        "decision_support": "sacramental preparation programs",
        "theological_focus": "sacramental theology"
      }
    }
  },
  {
    "id": "tmpl_16",
    "title": "Template – correlation of Creed & Salvation with other domains",
    "content": "Question: Is there a correlation between scores in \"Creed & Salvation History\" and other theological domains?\nSQL:\nSELECT\n    d1.name AS domain_name_1,\n    d2.name AS domain_name_2,\n    CORR(tsssd1.knowledge_score::float / NULLIF(tsssd1.knowledge_total, 0),\n         tsssd2.knowledge_score::float / NULLIF(tsssd2.knowledge_total, 0)) AS correlation\nFROM testing_section_student_domain_scores tsssd1\nJOIN testing_section_student_domain_scores tsssd2 ON tsssd1.testing_section_student_id = tsssd2.testing_section_student_id\nJOIN domains d1 ON tsssd1.domain_id = d1.id\nJOIN domains d2 ON tsssd2.domain_id = d2.id\nWHERE d1.name = 'Creed & Salvation History'\n  AND d2.name IN ('Virtue', 'Sacraments & Liturgy', 'Prayer', 'Morality', 'Living Discipleship')\n  AND tsssd1.knowledge_score IS NOT NULL\n  AND tsssd1.knowledge_total IS NOT NULL\n  AND tsssd2.knowledge_score IS NOT NULL\n  AND tsssd2.knowledge_total IS NOT NULL\nGROUP BY d1.name, d2.name\nORDER BY correlation DESC;",
    "metadata": {
      "category": "Faith Formation Indicators",
      "tables": ["testing_section_student_domain_scores", "domains"],
      "columns": ["domain_id", "name", "knowledge_score", "knowledge_total"],
      "keywords": ["correlation", "Creed & Salvation History", "theological connections"],
      "question_variants": [
        "How does understanding of the Creed relate to other theological areas?",
        "Does knowledge of salvation history correlate with moral understanding?",
        "What theological domains most closely connect with Creed knowledge?",
        "Are there connections between dogmatic and practical theology understanding?"
      ],
      "common_phrasings": [
        "theological knowledge connections",
        "doctrinal understanding relationships",
        "creedal knowledge correlations",
        "faith domain interdependencies"
      ],
      "context": {
        "report_type": "theological integration",
        "audience": "catechetical directors",
        "decision_support": "integrated curriculum design",
        "theological_focus": "doctrinal interconnections"
      }
    }
  },
  {
    "id": "tmpl_17",
    "title": "Template – improvement in theology scores by testing center (YoY)",
    "content": "Question: Which testing centers have shown the most improvement in theological knowledge scores compared to last year?\nSQL:\nWITH current_year_scores AS (\n    SELECT\n        tc.id AS testing_center_id,\n        tc.name AS testing_center_name,\n        AVG(CAST(tss.knowledge_score AS FLOAT) / NULLIF(tss.knowledge_total, 0)) * 100 AS avg_knowledge_score\n    FROM testing_section_students tss\n    JOIN testing_sections ts ON ts.id = tss.testing_section_id\n    JOIN testing_centers tc ON tc.id = ts.testing_center_id\n    WHERE tss.academic_year_id = (SELECT MAX(academic_year_id) FROM testing_section_students)\n      AND tss.knowledge_score IS NOT NULL\n      AND tss.knowledge_total IS NOT NULL\n    GROUP BY tc.id, tc.name\n),\nprevious_year_scores AS (\n    SELECT\n        tc.id AS testing_center_id,\n        AVG(CAST(tss.knowledge_score AS FLOAT) / NULLIF(tss.knowledge_total, 0)) * 100 AS avg_knowledge_score\n    FROM testing_section_students tss\n    JOIN testing_sections ts ON ts.id = tss.testing_section_id\n    JOIN testing_centers tc ON tc.id = ts.testing_center_id\n    WHERE tss.academic_year_id = (SELECT MAX(academic_year_id) - 1 FROM testing_section_students)\n      AND tss.knowledge_score IS NOT NULL\n      AND tss.knowledge_total IS NOT NULL\n    GROUP BY tc.id\n)\nSELECT\n    cys.testing_center_name,\n    cys.avg_knowledge_score AS current_year_score,\n    pys.avg_knowledge_score AS previous_year_score,\n    (cys.avg_knowledge_score - pys.avg_knowledge_score) AS improvement\nFROM current_year_scores cys\nJOIN previous_year_scores pys ON cys.testing_center_id = pys.testing_center_id\nORDER BY improvement DESC;",
    "metadata": {
      "category": "Performance Analytics",
      "tables": ["testing_section_students", "testing_sections", "testing_centers"],
      "columns": ["knowledge_score", "knowledge_total", "academic_year_id", "name"],
      "keywords": ["improvement", "year over year", "testing center", "comparison"],
      "question_variants": [
        "Which schools have improved the most in theology?",
        "Where do we see the biggest gains in theological knowledge?",
        "What testing centers show positive theological growth?",
        "Which schools have declining theology scores?"
      ],
      "common_phrasings": [
        "theological improvement metrics",
        "year-over-year knowledge growth",
        "school performance trends",
        "theology score progression"
      ],
      "context": {
        "report_type": "improvement analysis",
        "audience": "diocesan leadership",
        "decision_support": "resource allocation",
        "frequency": "annual comparison"
      }
    }
  },
  {
    "id": "tmpl_18",
    "title": "Template – affinity vs knowledge scores by domain",
    "content": "Question: How do affinity scores compare to knowledge scores across different domains?\nSQL:\nSELECT\n    d.name AS domain_name,\n    AVG(CAST(tsssd.knowledge_score AS FLOAT) / NULLIF(tsssd.knowledge_total, 0)) * 100 AS average_knowledge_score,\n    AVG(CAST(tsssd.affinity_score AS FLOAT) / NULLIF(tsssd.affinity_total, 0)) * 100 AS average_affinity_score\nFROM testing_section_student_domain_scores tsssd\nJOIN domains d ON tsssd.domain_id = d.id\nWHERE tsssd.knowledge_score IS NOT NULL\n  AND tsssd.knowledge_total IS NOT NULL\n  AND tsssd.affinity_score IS NOT NULL\n  AND tsssd.affinity_total IS NOT NULL\nGROUP BY d.name\nORDER BY d.name;",
    "metadata": {
      "category": "Faith Formation Indicators",
      "tables": ["testing_section_student_domain_scores", "domains"],
      "columns": ["name", "knowledge_score", "knowledge_total", "affinity_score", "affinity_total"],
      "keywords": ["affinity", "knowledge", "domain", "comparison"],
      "question_variants": [
        "Where do students know more than they practice?",
        "Which theological areas show gaps between knowledge and affinity?",
        "How does what students know compare to what they value?",
        "Are there domains where affinity exceeds knowledge?"
      ],
      "common_phrasings": [
        "knowledge-practice gap",
        "head-heart comparison",
        "theological integration measure",
        "formation effectiveness indicator"
      ],
      "context": {
        "report_type": "formation integration",
        "audience": "catechetical leaders",
        "decision_support": "holistic formation approach",
        "theological_focus": "faith integration"
      }
    }
  },
  {
    "id": "tmpl_19",
    "title": "Template – prayer frequency vs Real Presence belief",
    "content": "Question: What percentage of students who report regular prayer also report believing in the Real Presence?\nSQL:\nSELECT\n    (COUNT(DISTINCT CASE WHEN ua_prayer.answer_id IN (29901, 29911, 29921) AND ua_real_presence.answer_id = 1538 THEN ua_prayer.user_id END) * 100.0) / NULLIF(COUNT(DISTINCT ua_prayer.user_id), 0) AS percentage_believe_real_presence_with_prayer\nFROM user_answers ua_prayer\nINNER JOIN user_answers ua_real_presence ON ua_prayer.user_id = ua_real_presence.user_id\nINNER JOIN testing_section_students tss ON tss.id = ua_prayer.testing_section_student_id\nINNER JOIN users u ON u.id = ua_prayer.user_id\nWHERE ua_prayer.question_id = 7121\n  AND ua_real_presence.question_id = 436\n  AND u.role = 7;",
    "metadata": {
      "category": "Faith Formation Indicators",
      "tables": ["user_answers", "testing_section_students", "users"],
      "columns": ["answer_id", "question_id", "user_id", "role"],
      "keywords": ["prayer", "Real Presence", "percentage", "correlation", "Eucharistic belief"],
      "question_variants": [
        "Does regular prayer correlate with Eucharistic belief?",
        "What's the relationship between prayer habits and Real Presence belief?",
        "Are students who pray more likely to believe in transubstantiation?",
        "How does prayer practice impact Eucharistic faith?"
      ],
      "common_phrasings": [
        "prayer-belief connection",
        "spiritual practice correlation",
        "devotional impact on doctrine",
        "Eucharistic faith formation"
      ],
      "context": {
        "report_type": "faith integration",
        "audience": "spiritual directors",
        "decision_support": "eucharistic revival planning",
        "theological_focus": "eucharistic devotion"
      }
    }
  },
  {
    "id": "tmpl_20",
    "title": "Template – belief in Church authority vs knowledge score",
    "content": "Question: Is there a correlation between students' belief in Church teaching authority and their overall knowledge scores?\nSQL:\nSELECT\n    a.body AS affinity_answer,\n    AVG(CAST(tss.knowledge_score AS FLOAT) / NULLIF(tss.knowledge_total, 0)) * 100 AS average_knowledge_score\nFROM user_answers ua\nINNER JOIN testing_section_students tss ON tss.id = ua.testing_section_student_id\nINNER JOIN answers a ON a.id = ua.answer_id\nINNER JOIN users u ON u.id = ua.user_id\nWHERE a.body IN (\n        'I believe this',\n        'I know the Church teaches this, but I struggle to believe it',\n        'I know the Church teaches this, but I do not believe it',\n        'I did not know the Church teaches this'\n    )\n  AND u.role = 7\nGROUP BY a.body\nORDER BY average_knowledge_score DESC;",
    "metadata": {
      "category": "Faith Formation Indicators",
      "tables": ["user_answers", "testing_section_students", "answers", "users"],
      "columns": ["body", "knowledge_score", "knowledge_total", "role"],
      "keywords": ["Church authority", "knowledge score", "correlation", "teaching authority"],
      "question_variants": [
        "Does acceptance of Church teaching correlate with knowledge?",
        "How does belief in Church authority affect test scores?",
        "Is there a relationship between doctrinal acceptance and knowledge?",
        "Do students who accept Church teaching know more theology?"
      ],
      "common_phrasings": [
        "magisterial acceptance correlation",
        "doctrinal assent impact",
        "teaching authority metrics",
        "knowledge-belief relationship"
      ],
      "context": {
        "report_type": "doctrinal analysis",
        "audience": "theological educators",
        "decision_support": "faith formation strategy",
        "theological_focus": "magisterial authority"
      }
    }
  },
  
  {
    "id": "tmpl_21",
    "title": "Template – confession practices vs morality understanding",
    "content": "Question: How do students' responses about confession practices correlate with their understanding of morality?\nSQL:\nSELECT\n    a.body AS answer_name,\n    AVG((CAST(tss.knowledge_score AS FLOAT) / tss.knowledge_total) * 100) AS average_score\nFROM user_answers ua\nINNER JOIN testing_section_students tss ON tss.id = ua.testing_section_student_id\nINNER JOIN users u ON u.id = ua.user_id\nINNER JOIN answers a ON a.id = ua.answer_id\nWHERE ua.question_id = 432\n  AND ua.answer_id IN (1520, 1522, 1523, 1524)\n  AND u.role = 7\nGROUP BY a.body\nORDER BY average_score DESC;",
    "metadata": {
      "category": "Faith Formation Indicators",
      "tables": ["user_answers", "testing_section_students", "users", "answers"],
      "columns": ["body", "knowledge_score", "knowledge_total", "question_id", "answer_id", "role"],
      "keywords": ["confession", "morality", "correlation", "sacramental practice"],
      "question_variants": [
        "Does confession frequency relate to moral understanding?",
        "How does sacramental reconciliation impact moral knowledge?",
        "Is there a connection between confession practice and ethics knowledge?",
        "Do students who confess regularly understand morality better?"
      ],
      "common_phrasings": [
        "reconciliation-morality connection",
        "confession practice impact",
        "sacramental-moral integration",
        "penance and ethical formation"
      ],
      "context": {
        "report_type": "sacramental-moral integration",
        "audience": "confessors and moral educators",
        "decision_support": "confession preparation",
        "theological_focus": "moral theology and reconciliation"
      }
    }
  },
  
  {
    "id": "tmpl_22",
    "title": "Template – sacramental participation vs knowledge score",
    "content": "Question: What is the relationship between students' reported sacramental participation and their theological knowledge scores?\nSQL:\nSELECT\n    ua.question_id AS sacramental_question_id,\n    q.body AS sacramental_question,\n    a.body AS sacramental_answer,\n    AVG((CAST(tss.knowledge_score AS FLOAT) / NULLIF(tss.knowledge_total, 0)) * 100) AS average_knowledge_score\nFROM user_answers ua\nINNER JOIN testing_section_students tss ON tss.id = ua.testing_section_student_id\nINNER JOIN questions q ON q.id = ua.question_id\nINNER JOIN answers a ON a.id = ua.answer_id\nINNER JOIN users u ON u.id = ua.user_id\nWHERE u.role = 7\n  AND ua.question_id IN (7121, 7111, 436)\nGROUP BY ua.question_id, q.body, a.body\nORDER BY ua.question_id, a.body;",
    "metadata": {
      "category": "Faith Formation Indicators",
      "tables": ["user_answers", "testing_section_students", "questions", "answers", "users"],
      "columns": ["question_id", "body", "answer_id", "knowledge_score", "knowledge_total", "role"],
      "keywords": ["sacramental participation", "knowledge score", "correlation"],
      "question_variants": [
        "How does sacramental participation affect theological knowledge?",
        "Does regular Mass attendance improve theological understanding?",
        "What's the impact of receiving sacraments on faith knowledge?",
        "Is there a connection between sacramental life and test scores?"
      ],
      "common_phrasings": [
        "sacramental practice effect",
        "liturgical participation impact",
        "sacramental life correlation",
        "lex orandi, lex credendi metric"
      ],
      "context": {
        "report_type": "liturgical-catechetical connection",
        "audience": "liturgical and catechetical leaders",
        "decision_support": "integrated formation approach",
        "theological_focus": "sacramental participation"
      }
    }
  },
  
  {
    "id": "tmpl_23",
    "title": "Template – % teachers completing theology assessments",
    "content": "Question: What percentage of teachers have fully completed their theology assessments?\nSQL:\nSELECT\n    (COUNT(DISTINCT CASE WHEN tss.completed_date IS NOT NULL AND tss.subject_area_id = 1 AND u.role = 5 THEN tss.user_id END) * 100.0) / NULLIF(COUNT(DISTINCT CASE WHEN u.role = 5 THEN tss.user_id END), 0) AS percentage_completed\nFROM testing_section_students tss\nINNER JOIN users u ON u.id = tss.user_id\nWHERE tss.subject_area_id = 1\n  AND u.role = 5;",
    "metadata": {
      "category": "Participation & Engagement Metrics",
      "tables": ["testing_section_students", "users"],
      "columns": ["completed_date", "subject_area_id", "role", "user_id"],
      "keywords": ["teachers", "completion percentage", "theology", "assessment completion"],
      "question_variants": [
        "How many teachers have finished their theology assessments?",
        "What's the teacher completion rate for theology testing?",
        "Have our teachers completed their theology assessments?",
        "What percentage of teachers still need to complete theology tests?"
      ],
      "common_phrasings": [
        "teacher assessment completion",
        "faculty participation rate",
        "educator testing status",
        "teacher compliance metric"
      ],
      "context": {
        "report_type": "administrative",
        "audience": "school principals and diocesan officials",
        "decision_support": "faculty accountability",
        "frequency": "quarterly monitoring"
      }
    }
  },
  
  {
    "id": "tmpl_24",
    "title": "Template – average class size per testing center",
    "content": "Question: What is the average class size per testing center based on student assessment data?\nSQL:\nSELECT \n    tc.name AS testing_center_name,\n    AVG(class_size) AS average_class_size\nFROM (\n    SELECT \n        ts.testing_center_id,\n        ts.id AS testing_section_id,\n        COUNT(tss.id) AS class_size\n    FROM testing_sections ts\n    JOIN testing_section_students tss ON ts.id = tss.testing_section_id\n    GROUP BY ts.testing_center_id, ts.id\n) AS class_sizes\nJOIN testing_centers tc ON class_sizes.testing_center_id = tc.id\nGROUP BY tc.name\nORDER BY tc.name;",
    "metadata": {
      "category": "Demographic & Structural Analysis",
      "tables": ["testing_sections", "testing_section_students", "testing_centers"],
      "columns": ["testing_center_id", "name"],
      "keywords": ["class size", "testing center", "average", "student distribution"],
      "question_variants": [
        "What are the typical class sizes at each school?",
        "How large are the classes at different testing centers?",
        "Which schools have the largest and smallest classes?",
        "What's the average number of students per class by school?"
      ],
      "common_phrasings": [
        "class size metrics",
        "student-to-class ratio",
        "school enrollment distribution",
        "classroom capacity utilization"
      ],
      "context": {
        "report_type": "resource planning",
        "audience": "school administrators",
        "decision_support": "staffing decisions",
        "frequency": "annual planning"
      }
    }
  },
  
  {
    "id": "tmpl_25",
    "title": "Template – completed assessments by subject & center",
    "content": "Question: How many assessments have been completed for each subject area (Theology, Reading, Math) by testing center?\nSQL:\nSELECT \n    tc.name AS testing_center_name,\n    sa.name AS subject_area_name,\n    COUNT(tss.id) AS completed_assessments_count\nFROM testing_section_students tss\nJOIN testing_sections ts ON tss.testing_section_id = ts.id\nJOIN testing_centers tc ON ts.testing_center_id = tc.id\nJOIN subject_areas sa ON tss.subject_area_id = sa.id\nWHERE tss.completed_date IS NOT NULL\n  AND sa.id IN (1, 2, 3)\nGROUP BY tc.name, sa.name\nORDER BY tc.name, sa.name;",
    "metadata": {
      "category": "Participation & Engagement Metrics",
      "tables": ["testing_section_students", "testing_sections", "testing_centers", "subject_areas"],
      "columns": ["name", "completed_date", "subject_area_id"],
      "keywords": ["completed assessments", "subject area", "testing center", "distribution"],
      "question_variants": [
        "Which subjects have the highest completion rates by school?",
        "How are assessments distributed across different subjects by center?",
        "What's the breakdown of completed assessments by subject and school?",
        "Which schools complete more theology vs. math assessments?"
      ],
      "common_phrasings": [
        "subject area completion metrics",
        "cross-subject participation patterns",
        "school-subject completion matrix",
        "assessment distribution by discipline"
      ],
      "context": {
        "report_type": "participation analysis",
        "audience": "curriculum directors",
        "decision_support": "subject emphasis planning",
        "frequency": "semester review"
      }
    }
  },
  
  {
    "id": "tmpl_26",
    "title": "Template – knowledge scores by grade within a center",
    "content": "Question: How do knowledge scores compare between different grade levels within a specific testing center?\nSQL:\n-- Replace <testing_center_id> with an actual ID\nSELECT \n    tss.grade_level,\n    AVG(CAST(tss.knowledge_score AS FLOAT) / NULLIF(tss.knowledge_total, 0)) * 100 AS average_knowledge_score\nFROM testing_section_students tss\nJOIN testing_sections ts ON tss.testing_section_id = ts.id\nJOIN testing_centers tc ON ts.testing_center_id = tc.id\nWHERE tc.id = <testing_center_id>\n  AND tss.knowledge_score IS NOT NULL\n  AND tss.knowledge_total IS NOT NULL\nGROUP BY tss.grade_level\nORDER BY tss.grade_level;",
    "metadata": {
      "category": "Performance Analytics",
      "tables": ["testing_section_students", "testing_sections", "testing_centers"],
      "columns": ["grade_level", "knowledge_score", "knowledge_total", "testing_center_id"],
      "keywords": ["knowledge score", "grade level", "single center", "grade comparison"],
      "question_variants": [
        "How do different grades perform at a specific school?",
        "Which grade levels excel at a particular testing center?",
        "Show me grade-by-grade performance at one school",
        "What's the performance trajectory across grades at a center?"
      ],
      "common_phrasings": [
        "grade-level progression",
        "single-school grade comparison",
        "internal grade benchmarking",
        "vertical curriculum effectiveness"
      ],
      "context": {
        "report_type": "single-center analysis",
        "audience": "school principals",
        "decision_support": "grade-specific interventions",
        "frequency": "annual grade review"
      }
    }
  },
  
  {
    "id": "tmpl_27",
    "title": "Template – top-quartile theology students by grade",
    "content": "Question: What is the age/grade distribution of students who score in the top quartile for theological knowledge?\nSQL:\nWITH ranked_students AS (\n    SELECT\n        tss.grade_level,\n        tss.user_id,\n        (CAST(tss.knowledge_score AS FLOAT) / NULLIF(tss.knowledge_total, 0)) * 100 AS knowledge_percentage,\n        NTILE(4) OVER (ORDER BY (CAST(tss.knowledge_score AS FLOAT) / NULLIF(tss.knowledge_total, 0)) * 100 DESC) AS quartile\n    FROM testing_section_students tss\n    WHERE tss.knowledge_score IS NOT NULL\n      AND tss.knowledge_total IS NOT NULL\n)\nSELECT grade_level, COUNT(user_id) AS student_count\nFROM ranked_students\nWHERE quartile = 1\nGROUP BY grade_level\nORDER BY grade_level;",
    "metadata": {
      "category": "Performance Analytics",
      "tables": ["testing_section_students"],
      "columns": ["grade_level", "user_id", "knowledge_score", "knowledge_total"],
      "keywords": ["top quartile", "distribution", "grade", "high performers"],
      "question_variants": [
        "Which grades have the most theology high-achievers?",
        "What's the grade distribution of our top theology students?",
        "Where are our theological high-performers concentrated?",
        "Do older students dominate the top theology quartile?"
      ],
      "common_phrasings": [
        "academic excellence distribution",
        "top performer demographics",
        "theological aptitude patterns",
        "high-achievement grade analysis"
      ],
      "context": {
        "report_type": "excellence identification",
        "audience": "academic leadership",
        "decision_support": "gifted student programming",
        "frequency": "annual talent assessment"
      }
    }
  },
  
  {
    "id": "tmpl_28",
    "title": "Template – grade level vs Eucharist belief",
    "content": "Question: Is there a correlation between grade level and belief in key theological concepts (example: Eucharist belief)?\nSQL:\nSELECT\n    tss.grade_level,\n    COUNT(DISTINCT CASE WHEN ua.answer_id = 1538 THEN ua.user_id END) AS believe_count,\n    COUNT(DISTINCT CASE WHEN ua.answer_id = 1540 THEN ua.user_id END) AS not_believe_count,\n    COUNT(DISTINCT CASE WHEN ua.answer_id = 1539 THEN ua.user_id END) AS struggle_count,\n    COUNT(DISTINCT CASE WHEN ua.answer_id = 1542 THEN ua.user_id END) AS not_know_count,\n    (COUNT(DISTINCT CASE WHEN ua.answer_id = 1538 THEN ua.user_id END) * 100.0) / NULLIF(COUNT(DISTINCT ua.user_id), 0) AS believe_percentage,\n    (COUNT(DISTINCT CASE WHEN ua.answer_id = 1540 THEN ua.user_id END) * 100.0) / NULLIF(COUNT(DISTINCT ua.user_id), 0) AS not_believe_percentage,\n    (COUNT(DISTINCT CASE WHEN ua.answer_id = 1539 THEN ua.user_id END) * 100.0) / NULLIF(COUNT(DISTINCT ua.user_id), 0) AS struggle_percentage,\n    (COUNT(DISTINCT CASE WHEN ua.answer_id = 1542 THEN ua.user_id END) * 100.0) / NULLIF(COUNT(DISTINCT ua.user_id), 0) AS not_know_percentage\nFROM user_answers ua\nINNER JOIN testing_section_students tss ON tss.id = ua.testing_section_student_id\nINNER JOIN users u ON u.id = ua.user_id\nWHERE ua.question_id = 436\n  AND u.role = 7\nGROUP BY tss.grade_level;",
    "metadata": {
      "category": "Faith Formation Indicators",
      "tables": ["user_answers", "testing_section_students", "users"],
      "columns": ["grade_level", "answer_id", "question_id", "user_id", "role"],
      "keywords": ["Eucharist belief", "grade level", "correlation", "theological understanding"],
      "question_variants": [
        "How does Eucharistic belief change across grade levels?",
        "At what age do students start believing in the Real Presence?",
        "Is there a pattern in how eucharistic faith develops by grade?",
        "Which grades show most doubt about transubstantiation?"
      ],
      "common_phrasings": [
        "developmental eucharistic faith",
        "grade-level belief patterns",
        "eucharistic understanding progression",
        "age-related theological development"
      ],
      "context": {
        "report_type": "developmental faith analysis",
        "audience": "religious educators",
        "decision_support": "age-appropriate catechesis",
        "theological_focus": "eucharistic theology"
      }
    }
  },
  
  {
    "id": "tmpl_29",
    "title": "Template – knowledge scores by center & academic year",
    "content": "Question: How do scores vary by academic year across testing centers?\nSQL:\nSELECT \n    tc.name AS testing_center_name,\n    ts.academic_year_id,\n    AVG(CAST(tss.knowledge_score AS FLOAT) / NULLIF(tss.knowledge_total, 0)) * 100 AS average_score\nFROM testing_centers tc\nJOIN testing_sections ts ON ts.testing_center_id = tc.id\nJOIN testing_section_students tss ON tss.testing_section_id = ts.id\nGROUP BY tc.name, ts.academic_year_id\nORDER BY tc.name, ts.academic_year_id;",
    "metadata": {
      "category": "Performance Analytics",
      "tables": ["testing_centers", "testing_sections", "testing_section_students"],
      "columns": ["name", "academic_year_id", "knowledge_score", "knowledge_total"],
      "keywords": ["academic year", "testing center", "average score", "trends"],
      "question_variants": [
        "How have different schools performed over time?",
        "Which testing centers show consistent improvement year over year?",
        "What's the performance trend by center across academic years?",
        "Are there schools with declining scores over time?"
      ],
      "common_phrasings": [
        "longitudinal center performance",
        "multi-year school comparison",
        "academic year progression by center",
        "year-to-year center trends"
      ],
      "context": {
        "report_type": "longitudinal analysis",
        "audience": "diocesan administrators",
        "decision_support": "long-term planning",
        "frequency": "multi-year review"
      }
    }
  },
  
  {
    "id": "tmpl_30",
    "title": "Template – domain scores distribution by grade (all centers)",
    "content": "Question: What is the distribution of theological domain scores by grade level across all testing centers?\nSQL:\nSELECT \n    tss.grade_level,\n    AVG(CASE WHEN d.name = 'Virtue' THEN CAST(tsssd.knowledge_score AS FLOAT) / NULLIF(tsssd.knowledge_total, 0) END) * 100 AS virtue_score,\n    AVG(CASE WHEN d.name = 'Sacraments & Liturgy' THEN CAST(tsssd.knowledge_score AS FLOAT) / NULLIF(tsssd.knowledge_total, 0) END) * 100 AS sacraments_liturgy_score,\n    AVG(CASE WHEN d.name = 'Prayer' THEN CAST(tsssd.knowledge_score AS FLOAT) / NULLIF(tsssd.knowledge_total, 0) END) * 100 AS prayer_score,\n    AVG(CASE WHEN d.name = 'Morality' THEN CAST(tsssd.knowledge_score AS FLOAT) / NULLIF(tsssd.knowledge_total, 0) END) * 100 AS morality_score,\n    AVG(CASE WHEN d.name = 'Living Discipleship' THEN CAST(tsssd.knowledge_score AS FLOAT) / NULLIF(tsssd.knowledge_total, 0) END) * 100 AS living_discipleship_score,\n    AVG(CASE WHEN d.name = 'Creed & Salvation History' THEN CAST(tsssd.knowledge_score AS FLOAT) / NULLIF(tsssd.knowledge_total, 0) END) * 100 AS creed_salvation_history_score\nFROM testing_section_students tss\nJOIN testing_section_student_domain_scores tsssd ON tss.id = tsssd.testing_section_student_id\nJOIN domains d ON tsssd.domain_id = d.id\nJOIN testing_sections ts ON ts.id = tss.testing_section_id\nJOIN testing_centers tc ON tc.id = ts.testing_center_id\nWHERE tss.knowledge_score IS NOT NULL AND tss.knowledge_total IS NOT NULL\nGROUP BY tss.grade_level\nORDER BY tss.grade_level;",
    "metadata": {
      "category": "Performance Analytics",
      "tables": ["testing_section_students", "testing_section_student_domain_scores", "domains", "testing_sections", "testing_centers"],
      "columns": ["grade_level", "name", "knowledge_score", "knowledge_total"],
      "keywords": ["domain distribution", "grade level", "cross-domain comparison"],
      "question_variants": [
        "How do theological domains develop across grade levels?",
        "Which theological areas show strongest growth by grade?",
        "What's the grade-level progression of theological domains?",
        "Are there theological domains with unusual development patterns?"
      ],
      "common_phrasings": [
        "cross-domain developmental analysis",
        "theological domain progression",
        "grade-level domain comparisons",
        "theological knowledge trajectory"
      ],
      "context": {
        "report_type": "curriculum development",
        "audience": "catechetical program directors",
        "decision_support": "developmental catechesis",
        "theological_focus": "comprehensive theological formation"
      }
    }
  },
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

// Helper function to extract SQL from messages
function extractSqlFromMessage(message: string): string | null {
  const sqlMatch = message.match(/```sql\n([\s\S]*?)\n```/)
  return sqlMatch ? sqlMatch[1] : null
}

// Helper function to validate SQL and get corrected SQL if needed
async function validateAndCorrectSql(
  sql: string,
  connectionString: string,
  openai: any,
  maxRetries = 3
): Promise<{ sql: string; isValid: boolean; result: any }> {
  let currentSql = sql
  let isValid = false
  let result: any = null
  let errorMessage = ''
  let retryCount = 0

  console.log('Starting SQL validation for query:', currentSql.substring(0, 100) + '...')

  while (!isValid && retryCount < maxRetries) {
    try {
      // Add retry delay to avoid hammering the database with sequential failed queries
      if (retryCount > 0) {
        await new Promise(resolve => setTimeout(resolve, 500 * retryCount))
      }
      
      // Execute the SQL query
      const sqlResult = await runSql(currentSql, connectionString)
      
      try {
        // Parse the result
        result = JSON.parse(sqlResult)
        isValid = true
        console.log('SQL validated successfully on attempt', retryCount + 1)
      } catch {
        // If we can't parse it as JSON, it's likely an error message
        errorMessage = sqlResult
        
        // Generate improved SQL based on the error
        console.log(`SQL execution error (attempt ${retryCount + 1}): ${errorMessage}`)
        
        const correctionResponse = await generateText({
          model: openai('gpt-4.1-mini'),
          system: `
          You are a SQL correction expert. You will be given a SQL query that produced an error.
          Your task is to fix the SQL query to make it work. Only return the corrected SQL query, nothing else.
          Return the entire corrected query, not just the part that needed correction.
          
          Common issues to watch for:
          1. Missing or incorrect table names
          2. Incorrect column references
          3. Syntax errors in JOINs or WHERE clauses
          4. Issues with NULLIF or casting
          5. Missing GROUP BY clauses for aggregate functions
          `,
          prompt: `
          Original SQL query:
          \`\`\`sql
          ${currentSql}
          \`\`\`
          
          Error message:
          ${errorMessage}
          
          Please correct the SQL query. Return only the corrected SQL query, nothing else.
          `,
        })
        
        currentSql = correctionResponse.text.trim()
        // Remove any markdown formatting if present
        currentSql = currentSql.replace(/```sql\n([\s\S]*?)\n```/g, '$1').trim()
        
        console.log(`Corrected SQL (attempt ${retryCount + 1}):`, currentSql.substring(0, 100) + '...')
      }
    } catch (error) {
      console.error('Error during SQL validation:', error)
      errorMessage = error instanceof Error ? error.message : 'Unknown error'
    }
    
    retryCount++
  }

  return {
    sql: currentSql,
    isValid,
    result: isValid ? result : errorMessage
  }
}

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
    model: openai('gpt-4.1-mini'),
    messages: convertToCoreMessages(messages),
    system: `
     You are a PostgreSQL Query Generator Agent. Your primary responsibility is to generate accurate and efficient SQL queries based on user requests.
     
     IMPORTANT: This application uses a focused set of tables specifically selected for key analytical questions. 
     
     The tools available to you serve the following purposes:
     - getPublicTablesWithColumns: Returns ALL tables and their structure available for querying
     - getRelevantDocumentation: Returns documentation relevant to the specific query, including schema guidance, table usage details, and query patterns
     - getDioceseNames: Returns the exact diocese names as they appear in the database. ALWAYS use this tool when a query involves dioceses.

      When generating queries:
     1. First call getPublicTablesWithColumns to see all available tables
     2. Then call getRelevantDocumentation to get documentation relevant to your specific query
     3. If the query involves dioceses, ALWAYS call getDioceseNames to get the exact diocese name
     4. Only use tables from the returned list - never reference tables not in this list
     5. Include all required filters and joins as specified in the documentation
     6. Use proper score calculations with NULLIF and type casting
     7. Follow the guidance provided by getRelevantDocumentation
     8. Present the final SQL query in a code block
     
     IMPORTANT: For diocese filtering, ALWAYS use the complete diocese name as returned by getDioceseNames. 
     
     Example:
     User request: "What is the average theology score for Dallas?"
     Incorrect: WHERE d.name LIKE '%Dallas%'
     Correct: First call getDioceseNames with "Dallas" to get "Diocese of Dallas", then use: WHERE d.name = 'Diocese of Dallas'
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
            
            // Log the original query for debugging
            console.log(`Original query: "${query}"`);
            
            // Search for relevant information with optimized parameters
            const relevantInfo = await vectorStore.searchSchemaInfo(query, 20);
            
            // Format the results
            console.log(`Found ${relevantInfo.length} relevant documentation entries`);
            
            // Log retrieved template IDs for debugging
            const templateIds = relevantInfo
              .filter((info: any) => info.id && info.id.startsWith('tmpl_'))
              .map((info: any) => info.id);
            console.log(`Retrieved template IDs: ${templateIds.join(', ')}`);
            
            if (relevantInfo.length === 0) {
              return 'No relevant documentation found for this query. Please try a different query or ask about specific tables or columns.';
            }
            
            // Format documentation for better readability
            const formattedDocs = relevantInfo.map((info: any) => {
              if (info.title) {
                // New structured format
                return `==== ${info.title} ====\n${info.content}\n`;
              } else {
                // Legacy format - just return content
                return info.content;
              }
            }).join('\n\n');
            
            console.timeEnd(infoTimerId);
            return formattedDocs;
          } catch (error) {
            console.error('Error retrieving documentation:', error);
            return 'Error retrieving documentation. Please try again with a different query.';
          }
        },
      }),

      getDioceseNames: tool({
        description: `Retrieves a list of all diocese names in their correct format. Use this when you need to reference a specific diocese in a query. Always use the exact diocese name string in queries, never a partial name.`,
        parameters: z.object({
          namePattern: z.string().optional().describe('Optional partial name to filter the list (e.g., "Dallas" to find "Diocese of Dallas")'),
        }),
        execute: async ({ namePattern }) => {
          // List of all dioceses with their exact names as stored in the database
          const dioceseList = [
            "Diocese of Tucson",
            "Diocese of Dallas",
            "Diocese of Phoenix",
            "Diocese of Atlanta", 
            "Diocese of San Diego",
            "Archdiocese of Los Angeles",
            "Archdiocese of Chicago",
            "Archdiocese of New York",
            "Diocese of Sacramento",
            "Diocese of Miami",
            "Diocese of Boston",
            "Diocese of San Francisco",
            "Diocese of St. Petersburg",
            "Diocese of Orlando",
            "Diocese of Washington",
            "Diocese of Fort Worth",
            "Archdiocese of St. Louis"
          ];
          
          // If a pattern is provided, filter the list
          if (namePattern) {
            const pattern = namePattern.toLowerCase();
            const matches = dioceseList.filter(name => 
              name.toLowerCase().includes(pattern)
            );
            
            if (matches.length === 0) {
              return `No dioceses found matching "${namePattern}". Please use one of these dioceses: ${dioceseList.join(", ")}`;
            }
            
            return `Found ${matches.length} diocese(s) matching "${namePattern}":\n${matches.join("\n")}`;
          }
          
          // Return all dioceses if no pattern is provided
          return `List of all dioceses in their correct format (always use the exact name in queries):\n${dioceseList.join("\n")}`;
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
          const targetTablesLower = TARGET_TABLES.map(t => 
            typeof t === 'string' ? t.toLowerCase() : t
          );
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
          }
        }
        
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

  // Intercept the response to validate SQL before streaming
  const interceptStream = async (input: ReadableStream) => {
    const reader = input.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let sqlValidated = false
    let modifiedContent = ''
    let loadingMessageSent = false
    
    // Create a new stream for the filtered content
    const { readable, writable } = new TransformStream()
    const writer = writable.getWriter()

    // Process function that handles the validation and streaming
    const process = async () => {
      try {
        let done = false
        
        while (!done) {
          const { value, done: doneReading } = await reader.read()
          done = doneReading
          
          if (done) {
            // Ensure any remaining buffer is written out
            if (buffer.length > 0) {
              await writer.write(new TextEncoder().encode(buffer))
            }
            if (writer) await writer.close()
            return
          }
          
          if (value) {
            const chunk = decoder.decode(value, { stream: true })
            buffer += chunk
            
            // Show loading message if validating is taking a while
            if (!sqlValidated && buffer.includes('```sql') && !loadingMessageSent && buffer.length > 500) {
              loadingMessageSent = true
              const loadingMessage = "\n\n_(Validating SQL query, this may take a moment...)_\n\n"
              await writer.write(new TextEncoder().encode(loadingMessage))
            }
            
            // Check if we can extract SQL code from the buffer
            if (!sqlValidated && buffer.includes('```sql') && buffer.includes('```', buffer.indexOf('```sql') + 6)) {
              sqlValidated = true
              const sql = extractSqlFromMessage(buffer)
              
              if (sql) {
                console.log('Found SQL in response, validating before streaming')
                
                if (loadingMessageSent) {
                  // Clean up the loading message with a backspace sequence
                  await writer.write(new TextEncoder().encode("\r\n"))
                }
                
                try {
                  // Validate and potentially correct the SQL with a timeout
                  const validationPromise = validateAndCorrectSql(
                    sql,
                    connectionString,
                    openai
                  )
                  
                  // Add a timeout to prevent validation from taking too long
                  const timeoutPromise = new Promise<{ sql: string; isValid: boolean; result: any }>(
                    (_, reject) => setTimeout(() => reject(new Error('SQL validation timeout')), 10000)
                  )
                  
                  const { sql: validatedSql, isValid } = await Promise.race([
                    validationPromise,
                    timeoutPromise
                  ])
                  
                  if (isValid) {
                    // Replace the original SQL with the validated (possibly corrected) SQL
                    console.log('SQL is valid, proceeding with streaming')
                    modifiedContent = buffer.replace(
                      /```sql\n([\s\S]*?)\n```/,
                      `\`\`\`sql\n${validatedSql}\n\`\`\``
                    )
                  } else {
                    console.log('SQL still has issues after correction attempts, streaming original response')
                    modifiedContent = buffer
                  }
                } catch (error) {
                  console.error('Error during SQL validation:', error)
                  modifiedContent = buffer
                }
                
                await writer.write(new TextEncoder().encode(modifiedContent))
                buffer = '' // Clear buffer as we've handled this content
              } else {
                // No SQL found, just write the buffer
                await writer.write(new TextEncoder().encode(buffer))
                buffer = ''
              }
            } else if (sqlValidated) {
              // SQL already validated, just stream the content
              await writer.write(new TextEncoder().encode(chunk))
            } else {
              // Continue buffering until we find SQL or confirm there is none
              if (!buffer.includes('```sql') && buffer.length > 1000) {
                // If buffer is getting large and no SQL detected, start streaming
                await writer.write(new TextEncoder().encode(buffer))
                buffer = ''
                sqlValidated = true // Mark as validated to stop buffering
              }
            }
          }
        }
      } catch (error) {
        console.error('Error in stream processing:', error)
        if (writer) await writer.abort(error instanceof Error ? error : new Error('Stream processing error'))
      }
    }
    
    // Start processing the stream
    process()
    
    return readable
  }

  console.log(`Total request processing time: ${Date.now() - startTime}ms`);
  console.log('Returning stream response')
  const originalStream = result.toDataStreamResponse({
    headers: {
      'x-should-update-chats': shouldUpdateChats.toString(),
    },
  }).body
  
  if (!originalStream) {
    return new Response('Failed to create stream', { status: 500 })
  }
  
  const interceptedStream = await interceptStream(originalStream)
  
  return new Response(interceptedStream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'x-should-update-chats': shouldUpdateChats.toString(),
    },
  })
}
