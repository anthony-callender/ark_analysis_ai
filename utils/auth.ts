import { Client } from 'pg'
import { cookies } from 'next/headers'
import { v4 as uuidv4 } from 'uuid'

const SALT_ROUNDS = 10
const SESSION_EXPIRY_DAYS = 7

// Web Crypto API helper functions
async function generateSalt(): Promise<string> {
  const array = new Uint8Array(16)
  crypto.getRandomValues(array)
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('')
}

async function hashPassword(password: string, salt: string): Promise<string> {
  const encoder = new TextEncoder()
  const passwordData = encoder.encode(password)
  const saltData = encoder.encode(salt)
  
  const key = await crypto.subtle.importKey(
    'raw',
    passwordData,
    'PBKDF2',
    false,
    ['deriveBits']
  )
  
  const hash = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltData,
      iterations: 100000,
      hash: 'SHA-512'
    },
    key,
    512
  )
  
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')
}

export interface User {
  id: number
  username: string
  email: string
  created_at: Date
  last_login: Date | null
}

export interface Session {
  id: number
  user_id: number
  token: string
  expires_at: Date
  created_at: Date
}

export async function createUser(
  client: Client,
  username: string,
  email: string,
  password: string
): Promise<User> {
  const salt = await generateSalt()
  const passwordHash = await hashPassword(password, salt)
  
  const result = await client.query(
    `INSERT INTO users (username, email, password_hash, salt)
     VALUES ($1, $2, $3, $4)
     RETURNING id, username, email, created_at, last_login`,
    [username, email, passwordHash, salt]
  )
  
  return result.rows[0]
}

export async function validateUser(
  client: Client,
  username: string,
  password: string
): Promise<User | null> {
  const result = await client.query(
    `SELECT id, username, email, password_hash, salt, created_at, last_login
     FROM users
     WHERE username = $1`,
    [username]
  )
  
  const user = result.rows[0]
  if (!user) return null
  
  const passwordHash = await hashPassword(password, user.salt)
  if (passwordHash !== user.password_hash) return null
  
  // Update last login
  await client.query(
    `UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1`,
    [user.id]
  )
  
  delete user.password_hash
  delete user.salt
  return user
}

export async function createSession(
  client: Client,
  userId: number
): Promise<Session> {
  const token = uuidv4()
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + SESSION_EXPIRY_DAYS)
  
  const result = await client.query(
    `INSERT INTO sessions (user_id, token, expires_at)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [userId, token, expiresAt]
  )
  
  return result.rows[0]
}

export async function validateSession(
  client: Client,
  token: string
): Promise<User | null> {
  const result = await client.query(
    `SELECT u.id, u.username, u.email, u.created_at, u.last_login
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token = $1 AND s.expires_at > CURRENT_TIMESTAMP`,
    [token]
  )
  
  if (result.rows.length === 0) return null
  
  return result.rows[0]
}

export async function deleteSession(
  client: Client,
  token: string
): Promise<void> {
  await client.query(
    `DELETE FROM sessions WHERE token = $1`,
    [token]
  )
}

export async function setSessionCookie(token: string) {
  const cookieStore = await cookies()
  cookieStore.set('session', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_EXPIRY_DAYS * 24 * 60 * 60 // Convert days to seconds
  })
}

export async function getSessionCookie(): Promise<string | undefined> {
  const cookieStore = await cookies()
  return cookieStore.get('session')?.value
}

export async function deleteSessionCookie() {
  const cookieStore = await cookies()
  cookieStore.delete('session')
} 