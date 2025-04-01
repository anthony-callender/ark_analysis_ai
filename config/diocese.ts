export type UserRole = 'diocese_manager' | 'school_manager' | 'super_admin'

export const DIOCESE_CONFIG = {
  name: 'Tucson',
  id: 5,
  testingCenterId: 51,
  role: 'super_admin' as UserRole, // default role
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