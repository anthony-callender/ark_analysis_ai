export type UserRole = 'super_admin' | 'diocese_manager' | 'school_manager';

export type Database = {
  public: {
    Tables: {
      dioceses: {
        Row: {
          id: number;
          name: string;
          full_name: string;
          created_at?: string;
        };
        Insert: {
          id?: number;
          name: string;
          full_name: string;
          created_at?: string;
        };
        Update: {
          id?: number;
          name?: string;
          full_name?: string;
          created_at?: string;
        };
      };
      users: {
        Row: {
          id: string;
          username: string;
          password_hash: string;
          email: string;
          role: UserRole;
          diocese_id: number | null;
          testing_center_id: number | null;
          created_at: string;
          last_login: string | null;
        };
        Insert: {
          id?: string;
          username: string;
          password_hash: string;
          email: string;
          role?: UserRole;
          diocese_id?: number | null;
          testing_center_id?: number | null;
          created_at?: string;
          last_login?: string | null;
        };
        Update: {
          id?: string;
          username?: string;
          password_hash?: string;
          email?: string;
          role?: UserRole;
          diocese_id?: number | null;
          testing_center_id?: number | null;
          created_at?: string;
          last_login?: string | null;
        };
      };
      testing_centers: {
        Row: {
          id: number;
          name: string;
          diocese_id: number;
          created_at?: string;
        };
        Insert: {
          id?: number;
          name: string;
          diocese_id: number;
          created_at?: string;
        };
        Update: {
          id?: number;
          name?: string;
          diocese_id?: number;
          created_at?: string;
        };
      };
    };
  };
}; 