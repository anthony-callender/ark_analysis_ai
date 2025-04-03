export const QUESTION_REFERENCES = {
  eucharist: {
    id: 436,
    text: "The Eucharist we receive at Mass is truly the Body and Blood of Jesus Christ.",
    answers: {
      1538: "I believe this",
      1539: "I know the Church teaches this, but I struggle to believe it",
      1540: "I know the Church teaches this, but I do not believe it",
      1542: "I did not know the Church teaches this",
      1927: "Blank"
    }
  },
  mass_attendance: {
    id: 7111,
    text: "I attend Mass",
    answers: {
      1927: "Blank",
      29861: "Weekly or more often",
      29871: "Sometimes",
      29881: "Only at school",
      29891: "No"
    }
  },
  baptism: {
    id: 7121,
    text: "I have been baptized",
    answers: {
      1927: "Blank",
      29901: "Yes",
      29911: "No",
      29921: "Not sure"
    }
  }
};

export const NULL_HANDLING_PATTERNS = {
  numeric: "COALESCE(column_name, 0)",
  text: "COALESCE(column_name, '')",
  date: "COALESCE(column_name, CURRENT_DATE)",
  boolean: "COALESCE(column_name, false)",
  division: "NULLIF(denominator, 0)"
};

export const TABLE_RELATIONSHIPS = {
  core: {
    testing_section_students: "testing results for all users - MUST filter by user role",
    testing_sections: "testing sections of a school",
    testing_centers: "schools",
    subject_areas: "subject categorization"
  },
  user: {
    users: "user information",
    user_answers: "user responses to questions",
    questions: "question content and context"
  },
  organizational: {
    dioceses: "diocese information",
    school_classes: "class information",
    academic_years: "academic year context",
    domains: "domain categorization",
    ark_admin_dashes: "admin dashboard data"
  }
};

export const ROLE_TYPES = {
  teachers: 5,
  students: 7
};

export const SCORE_CALCULATION = {
  formula: `WHERE knowledge_score IS NOT NULL 
           AND knowledge_total IS NOT NULL 
           AND knowledge_total > 0
           AND knowledge_score > 0
           AND (COALESCE(knowledge_score::float, 0) / NULLIF(COALESCE(knowledge_total::float, 0), 0)) * 100`,
  common_subjects: ["Math", "Reading", "Theology"]
}; 