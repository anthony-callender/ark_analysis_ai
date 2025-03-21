export type UserRole = 'diocese_manager' | 'school_manager'

export const DIOCESE_CONFIG = {
  name: 'Tucson',
  id: 5,
  testingCenterId: 51,
  role: 'diocese_manager' as UserRole, // default role
  protectedTables: [
    'testing_centers',
    'testing_sections',
    'testing_section_students',
    'users',
    'students',
    'test_results',
    'scores'
  ]
} 