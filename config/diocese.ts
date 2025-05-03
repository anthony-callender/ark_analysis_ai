export type UserRole = 'diocese_manager' | 'school_manager' | 'super_admin'

export const DIOCESE_CONFIG = {
  name: 'Tucson',
  fullName: 'Diocese of Tucson',
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